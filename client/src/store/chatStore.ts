import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'
import axios from 'axios'
import { API_URL, SOCKET_URL } from '../config/runtime'
import { getSharedKey, decryptMessage, encryptMessage, encryptBytes, decryptBytes, generateGroupKey, getGroupKey, wrapGroupKeyForMember, cacheGroupKey, getChannelKey, cacheChannelKey } from '../utils/e2ee'
import type { MessageMention } from '../utils/mentions'
import { useAuthStore } from './authStore'
import { useNotificationStore, type InAppNotification } from './notificationStore'
const ACTIVE_CHAT_STORAGE_KEY = 'gws-connect.active-chat'
const TYPING_INDICATOR_TIMEOUT_MS = 3200

const typingIndicatorTimeouts = new Map<string, number>()

// Fetches a member's wrapped channel key, bootstrapping a brand-new key if the
// channel has never had one (e.g. a pre-existing channel from before E2EE was
// made mandatory for every channel), or asking online peers to grant it if a
// key exists but this member doesn't have their copy yet. `generation` omitted
// means "current" (used when sending); passed explicitly when decrypting a
// message tagged with a specific (possibly historical) generation.
const ensureChannelKey = async (
    channelId: string,
    privateKey: CryptoKey,
    userId: string,
    socket: Socket | null,
    generation?: number,
) => {
    try {
        return await getChannelKey(channelId, privateKey, generation)
    } catch (error) {
        const axiosError = error as { response?: { status?: number; data?: { hasAnyKey?: boolean } } }
        if (axiosError.response?.status !== 404) {
            throw error
        }

        if (axiosError.response.data?.hasAnyKey) {
            socket?.emit('request-channel-key', channelId)
            throw new Error('Encryption key requested - please try sending again shortly.')
        }

        const channelKey = await generateGroupKey()
        const wrapped = await wrapGroupKeyForMember(channelKey, privateKey, userId)
        await axios.post(`${API_URL}/channels/${channelId}/keys`, {
            userId,
            wrappedKey: wrapped.wrappedKey,
            wrappedIv: wrapped.wrappedIv,
        })
        // No generation has ever existed for this channel, so this bootstrap
        // is always generation 1 (channels.currentKeyGeneration defaults to 1).
        cacheChannelKey(channelId, 1, channelKey)
        return channelKey
    }
}

// Generates a fresh key, wraps it for every current member, and submits the
// rotation. Used both when the server signals a removal-triggered rotation
// and when a client opportunistically notices the current generation is
// stale. A 409 (someone else already rotated to this generation) is treated
// as a no-op, not an error - the next key fetch picks up their result.
const performChannelKeyRotation = async (channelId: string, targetGeneration: number) => {
    const { e2eePrivateKey } = useAuthStore.getState()
    if (!e2eePrivateKey) {
        return
    }

    const membersResponse = await axios.get(`${API_URL}/channels/${channelId}/members`)
    const members: { id: string | number }[] = membersResponse.data
    const newChannelKey = await generateGroupKey()
    const wraps = await Promise.all(
        members.map(async (member) => {
            const { wrappedKey, wrappedIv } = await wrapGroupKeyForMember(newChannelKey, e2eePrivateKey, String(member.id))
            return { userId: member.id, wrappedKey, wrappedIv }
        }),
    )

    const response = await axios.post(`${API_URL}/channels/${channelId}/keys/rotate`, {
        generation: targetGeneration,
        wraps,
    })
    cacheChannelKey(channelId, response.data.generation, newChannelKey)
}

const performGroupKeyRotation = async (groupChatId: string, targetGeneration: number) => {
    const { e2eePrivateKey } = useAuthStore.getState()
    if (!e2eePrivateKey) {
        return
    }

    const groupChat = useChatStore.getState().groupChats.find((group) => group.id === groupChatId)
    const members = groupChat?.members || []
    const newGroupKey = await generateGroupKey()
    const wraps = await Promise.all(
        members.map(async (member) => {
            const { wrappedKey, wrappedIv } = await wrapGroupKeyForMember(newGroupKey, e2eePrivateKey, String(member.id))
            return { userId: member.id, wrappedKey, wrappedIv }
        }),
    )

    const response = await axios.post(`${API_URL}/group-chats/${groupChatId}/keys/rotate`, {
        generation: targetGeneration,
        wraps,
    })
    cacheGroupKey(groupChatId, response.data.generation, newGroupKey)
}

const KEY_ROTATION_STALE_MS = 24 * 60 * 60 * 1000

// Opportunistically rotates a stale key when a channel/group becomes active.
// Safe to call repeatedly/from multiple online members - the server's CAS
// check on /keys/rotate means only one rotation per generation ever lands.
const rotateIfStale = (kind: 'channel' | 'group', id: string, rotatedAt: string | undefined, currentGeneration: number | undefined) => {
    const lastRotated = rotatedAt ? new Date(rotatedAt).getTime() : 0
    if (Date.now() - lastRotated < KEY_ROTATION_STALE_MS) {
        return
    }

    const targetGeneration = (currentGeneration || 1) + 1
    const rotate = kind === 'channel' ? performChannelKeyRotation(id, targetGeneration) : performGroupKeyRotation(id, targetGeneration)
    rotate.catch((error) => {
        console.error(`Failed to opportunistically rotate ${kind} key:`, error)
    })
}

export interface ResolvedAttachment {
    url: string
    name: string
    type: string
}

interface AttachmentLike {
    id: string
    fileUrl?: string | null
    fileName?: string | null
    fileType?: string | null
    fileIv?: string | null
    cipherIv?: string | null
    isEncrypted?: number | boolean
    keyGeneration?: number | null
}

interface AttachmentContext {
    channelId?: string | null
    recipientId?: string | null
    groupChatId?: string | null
}

const attachmentCache = new Map<string, ResolvedAttachment>()

const buildLegacyFileUrl = (fileUrl: string) => {
    if (!fileUrl.startsWith('/api/messages/file/')) return fileUrl
    const token = useAuthStore.getState().token
    if (!token) return fileUrl
    const joiner = fileUrl.includes('?') ? '&' : '?'
    return `${fileUrl}${joiner}token=${encodeURIComponent(token)}`
}

// Fetches an encrypted attachment's ciphertext, decrypts its metadata
// (filename/mimetype) and body using the same per-conversation key text
// messages already use, and returns a Blob object URL ready to render.
// Legacy (pre-mandatory-encryption) attachments pass through unchanged.
export const resolveAttachment = async (
    item: AttachmentLike,
    context: AttachmentContext = {},
): Promise<ResolvedAttachment> => {
    if (!item.fileUrl) {
        throw new Error('Attachment has no file')
    }

    if (!item.isEncrypted) {
        return {
            url: buildLegacyFileUrl(item.fileUrl),
            name: item.fileName || 'File',
            type: item.fileType || '',
        }
    }

    const cached = attachmentCache.get(item.id)
    if (cached) {
        return cached
    }

    const { e2eePrivateKey, user } = useAuthStore.getState()
    if (!e2eePrivateKey || !user) {
        throw new Error('End-to-end encryption is not ready yet')
    }

    const channelId = context.channelId
    const groupChatId = context.groupChatId
    const recipientId = context.recipientId

    const generation = item.keyGeneration ?? undefined

    let key: CryptoKey
    if (channelId) {
        key = await ensureChannelKey(String(channelId), e2eePrivateKey, String(user.id), useChatStore.getState().socket, generation)
    } else if (groupChatId) {
        key = await getGroupKey(String(groupChatId), e2eePrivateKey, generation)
    } else if (recipientId) {
        key = await getSharedKey(e2eePrivateKey, String(recipientId))
    } else {
        throw new Error('Unable to determine encryption key for this attachment')
    }

    if (!item.fileIv || !item.cipherIv || !item.fileName) {
        throw new Error('Attachment is missing encryption metadata')
    }

    const metaJson = await decryptMessage(item.fileName, item.cipherIv, key)
    const meta = JSON.parse(metaJson) as { name: string; type: string }

    const response = await axios.get(item.fileUrl, { responseType: 'arraybuffer' })
    const plaintext = await decryptBytes(response.data as ArrayBuffer, item.fileIv, key)

    const blob = new Blob([plaintext], { type: meta.type || 'application/octet-stream' })
    const resolved: ResolvedAttachment = {
        url: URL.createObjectURL(blob),
        name: meta.name,
        type: meta.type,
    }
    attachmentCache.set(item.id, resolved)
    return resolved
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000

let idleTimer: number | null = null
let idleActivityCleanup: (() => void) | null = null

interface PersistedActiveChat {
    type: 'channel' | 'dm' | 'group'
    id: string
    userId: string
}

export interface ReplyContext {
    id: string
    senderId: string
    senderName: string
    senderAvatar?: string | null
    content: string
    fileUrl?: string | null
    fileName?: string | null
    fileType?: string | null
    pollQuestion?: string | null
    isEncrypted?: number | boolean
    isDeleted?: number | boolean
    timestamp?: string | Date
}

export interface MessageFocusTarget {
    chatType: 'channel' | 'dm' | 'group'
    chatId: string
    messageId: string
}

export interface LatestMessageRequest {
    chatType: 'channel' | 'dm' | 'group'
    chatId: string
    nonce: number
}

export interface Message {
    id: string
    content: string
    senderId: string
    senderName: string
    senderAvatar?: string
    channelId?: string
    recipientId?: string
    groupChatId?: string
    cipherText?: string | null
    cipherIv?: string | null
    isEncrypted?: number | boolean
    keyGeneration?: number | null
    timestamp: Date
    editedAt?: string | null
    isDeleted?: number | boolean
    deletedAt?: string | null
    fileUrl?: string | null
    fileName?: string | null
    fileType?: string | null
    fileIv?: string | null
    mentions?: MessageMention[]
    replyToMessageId?: string | null
    threadRootMessageId?: string | null
    replyContext?: ReplyContext | null
    poll?: Poll
    reactions?: ReactionSummary[]
    isPinned?: boolean
    pinnedAt?: string | null
    isBookmarked?: boolean
    expiresAt?: string | null
}

interface ReactionSummary {
    type: string
    emoji: string
    count: number
    reacted?: boolean
}

interface PollOption {
    id: string
    text: string
    count: number
    voters?: Array<{ id: number; username: string; avatar?: string }>
}

interface Poll {
    id: string
    question: string
    createdBy: number
    expiresAt?: string | null
    createdAt?: string
    options: PollOption[]
    userVoteOptionId?: string | null
}

export interface Channel {
    id: string
    name: string
    description: string
    members: string[]
    isPrivate?: number | boolean
    announcementOnly?: number | boolean
    status?: string
    unreadCount: number
    lastMessageAt: string | null
    slowModeSeconds?: number
    disappearingMessagesSeconds?: number
    currentKeyGeneration?: number
    keyGenerationRotatedAt?: string
    workspaceId?: string | null
}

export interface Workspace {
    id: string
    name: string
    slug: string
    iconUrl?: string
    memberRole?: string
}

export interface DirectMessage {
    id: string
    userId: string
    username: string
    avatar?: string | null
    statusEmoji?: string | null
    statusText?: string | null
    statusClearsAt?: string | null
    lastMessageAt: string | null
    unreadCount: number
}

export interface GroupChatMember {
    id: string
    username: string
    avatar?: string | null
}

export interface GroupChat {
    id: string
    name: string
    members: GroupChatMember[]
    lastMessageAt: string | null
    unreadCount: number
    disappearingMessagesSeconds?: number
    currentKeyGeneration?: number
    keyGenerationRotatedAt?: string
}

export interface WorkspaceEmoji {
    id: string
    name: string
    imageUrl: string
    createdAt?: string
}

export interface VoiceChannelParticipant {
    userId: string
    username: string
    avatar?: string | null
}

export interface VoiceChannel {
    id: string
    channelId: string
    name: string
    description?: string
    isPrivate?: boolean
    participants: VoiceChannelParticipant[]
}

export interface TypingUser {
    userId: string
    username: string
    avatar?: string | null
}

export interface InviteLink {
    id: string
    code: string
    targetType: 'channel' | 'group'
    targetId: string
    maxUses: number | null
    useCount: number
    expiresAt: string | null
}

export interface InvitePreview {
    targetType: 'channel' | 'group'
    targetId: string
    name: string
}

interface SharedFileItem {
    id: string
    fileUrl: string
    fileName: string
    fileType: string
    fileIv?: string | null
    cipherIv?: string | null
    isEncrypted?: number | boolean
    keyGeneration?: number | null
    timestamp: string
    senderName: string
    senderAvatar?: string
}

interface ChatState {
    socket: Socket | null
    channels: Channel[]
    workspaces: Workspace[]
    activeWorkspaceId: string | null
    directMessages: DirectMessage[]
    groupChats: GroupChat[]
    voiceChannels: VoiceChannel[]
    workspaceEmoji: WorkspaceEmoji[]
    messages: { [key: string]: Message[] }
    filesByChatId: { [key: string]: SharedFileItem[] }
    activeChannel: string | null
    activeDM: string | null
    activeGroupChat: string | null
    messageFocusTarget: MessageFocusTarget | null
    latestMessageRequest: LatestMessageRequest | null
    onlineUsers: string[]
    presenceByUserId: { [userId: string]: 'online' | 'idle' }
    readReceiptsByChatId: { [chatId: string]: { [userId: string]: string } }
    dmDisappearingSecondsByPeerId: { [peerId: string]: number }
    typingUsersByChatId: { [key: string]: TypingUser[] }
    initSocket: (token: string) => void
    disconnectSocket: () => void
    joinChannel: (channelId: string) => void
    leaveChannel: (channelId: string) => void
    emitTypingStart: (channelId?: string, recipientId?: string, groupChatId?: string) => void
    emitTypingStop: (channelId?: string, recipientId?: string, groupChatId?: string) => void
    sendMessage: (content: string, channelId?: string, recipientId?: string, file?: File, replyToMessageId?: string | null, groupChatId?: string) => Promise<boolean>
    scheduleMessage: (content: string, deliverAt: string, channelId?: string, recipientId?: string, replyToMessageId?: string | null, groupChatId?: string) => Promise<boolean>
    sendGif: (gifUrl: string, title: string, channelId?: string, recipientId?: string, replyToMessageId?: string | null, groupChatId?: string) => Promise<boolean>
    createPoll: (question: string, options: string[], channelId?: string, recipientId?: string, durationMinutes?: number, replyToMessageId?: string | null, groupChatId?: string) => Promise<boolean>
    voteOnPoll: (pollId: string, optionId: string) => Promise<boolean>
    toggleReaction: (messageId: string, reaction: string) => Promise<boolean>
    editMessage: (messageId: string, content: string) => Promise<boolean>
    deleteMessage: (messageId: string) => Promise<boolean>
    archiveMessage: (messageId: string) => Promise<boolean>
    togglePinMessage: (messageId: string) => Promise<boolean>
    toggleBookmarkMessage: (messageId: string) => Promise<boolean>
    loadPinnedMessages: (chatType: 'channel' | 'dm' | 'group', chatId: string) => Promise<Message[]>
    loadBookmarkedMessages: () => Promise<Message[]>
    loadThreadMessages: (messageId: string) => Promise<{ threadRootMessageId: string; messages: Message[] } | null>
    searchMessages: (chatType: 'channel' | 'dm' | 'group', chatId: string, query: string) => Promise<Message[]>
    setActiveChannel: (channelId: string | null) => void
    setActiveDM: (dmId: string | null) => void
    setActiveGroupChat: (groupChatId: string | null) => void
    loadGroupChats: () => Promise<void>
    loadVoiceChannels: () => Promise<void>
    loadWorkspaceEmoji: () => Promise<void>
    createGroupChat: (name: string, memberIds: string[]) => Promise<GroupChat | null>
    loadGroupChatMessages: (groupChatId: string) => Promise<void>
    leaveGroupChat: (groupChatId: string) => Promise<boolean>
    createInviteLink: (targetType: 'channel' | 'group', targetId: string, options?: { maxUses?: number; expiresInHours?: number }) => Promise<InviteLink | null>
    listInviteLinks: (targetType: 'channel' | 'group', targetId: string) => Promise<InviteLink[]>
    revokeInviteLink: (inviteId: string) => Promise<boolean>
    previewInvite: (code: string) => Promise<InvitePreview | null>
    redeemInvite: (code: string) => Promise<InvitePreview | null>
    setGroupChatDisappearing: (groupChatId: string, seconds: number) => Promise<boolean>
    loadDmDisappearingSeconds: (peerId: string) => Promise<void>
    setDmDisappearing: (peerId: string, seconds: number) => Promise<boolean>
    setMessageFocusTarget: (target: MessageFocusTarget | null) => void
    clearMessageFocusTarget: () => void
    requestLatestMessageView: (chatType: 'channel' | 'dm' | 'group', chatId: string) => void
    clearLatestMessageRequest: () => void
    restoreActiveChat: (userId: string) => void
    loadChannels: () => Promise<void>
    createChannel: (name: string, description: string, isPrivate: boolean) => Promise<{ ok: boolean; message?: string }>
    loadWorkspaces: () => Promise<void>
    switchWorkspace: (workspaceId: string) => Promise<void>
    createWorkspace: (name: string) => Promise<{ ok: boolean; message?: string }>
    loadDirectConversations: () => Promise<void>
    loadChannelMessages: (channelId: string) => Promise<void>
    loadDirectMessages: (userId: string) => Promise<void>
    loadMessageById: (messageId: string) => Promise<Message | null>
    loadChannelFiles: (channelId: string) => Promise<void>
    loadDirectFiles: (userId: string) => Promise<void>
    upsertDirectConversation: (conversation: Partial<DirectMessage> & { id: string }) => void
    markConversationVisited: (chatType: 'channel' | 'dm' | 'group', chatId: string) => Promise<void>
    markAllConversationsRead: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
    socket: null,
    channels: [],
    workspaces: [],
    activeWorkspaceId: null,
    directMessages: [],
    groupChats: [],
    voiceChannels: [],
    workspaceEmoji: [],
    messages: {},
    filesByChatId: {},
    activeChannel: null,
    activeDM: null,
    activeGroupChat: null,
    messageFocusTarget: null,
    latestMessageRequest: null,
    onlineUsers: [],
    presenceByUserId: {},
    readReceiptsByChatId: {},
    dmDisappearingSecondsByPeerId: {},
    typingUsersByChatId: {},

    initSocket: (token: string) => {
        get().socket?.disconnect()

        const socket = io(SOCKET_URL, {
            auth: { token }
        })

        socket.on('connect', () => {
            console.log('Socket connected')

            const resetIdleTimer = () => {
                socket.emit('presence-set', 'online')
                if (idleTimer !== null) {
                    window.clearTimeout(idleTimer)
                }
                idleTimer = window.setTimeout(() => {
                    socket.emit('presence-set', 'idle')
                }, IDLE_THRESHOLD_MS)
            }

            idleActivityCleanup?.()
            const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'visibilitychange']
            activityEvents.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer))
            idleActivityCleanup = () => {
                activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer))
            }
            resetIdleTimer()

            const { activeChannel, activeDM, activeGroupChat } = get()
            if (activeChannel) {
                socket.emit('join-channel', activeChannel)
                void get().loadChannelMessages(activeChannel)
            }
            if (activeDM) {
                void get().loadDirectMessages(activeDM)
            }
            if (activeGroupChat) {
                void get().loadGroupChatMessages(activeGroupChat)
            }
            void get().loadChannels()
            void get().loadDirectConversations()
            void get().loadGroupChats()
            void get().loadVoiceChannels()
            void get().loadWorkspaceEmoji()
        })

        socket.on('group-chats', (groupChats: GroupChat[]) => {
            set({ groupChats: groupChats.map(normalizeGroupChat) })
        })

        socket.on('group-chat-created', (rawGroupChat: GroupChat) => {
            const groupChat = normalizeGroupChat(rawGroupChat)
            set((state) => ({
                groupChats: state.groupChats.some((group) => group.id === groupChat.id)
                    ? state.groupChats
                    : [groupChat, ...state.groupChats],
            }))
        })

        socket.on('group-chat-key-needed', async (payload: { groupChatId: string; userId: string }) => {
            const { e2eePrivateKey, user: currentUser } = useAuthStore.getState()
            if (!e2eePrivateKey || !currentUser || String(currentUser.id) === payload.userId) {
                return
            }

            try {
                const groupKey = await getGroupKey(payload.groupChatId, e2eePrivateKey)
                const { wrappedKey, wrappedIv } = await wrapGroupKeyForMember(groupKey, e2eePrivateKey, payload.userId)
                await axios.post(`${API_URL}/group-chats/${payload.groupChatId}/keys`, {
                    userId: payload.userId,
                    wrappedKey,
                    wrappedIv,
                })
            } catch (error) {
                console.error('Failed to grant group key to new member:', error)
            }
        })

        socket.on('channel-key-rotation-needed', async (payload: { channelId: string; generation: number }) => {
            const { e2eePrivateKey, user: currentUser } = useAuthStore.getState()
            if (!e2eePrivateKey || !currentUser) {
                return
            }

            try {
                await performChannelKeyRotation(payload.channelId, payload.generation)
            } catch (error) {
                // A 409 just means another online member already won the rotation
                // race - nothing to do, the next /keys/me fetch picks up their result.
                console.error('Failed to rotate channel key:', error)
            }
        })

        socket.on('group-key-rotation-needed', async (payload: { groupChatId: string; generation: number }) => {
            const { e2eePrivateKey, user: currentUser } = useAuthStore.getState()
            if (!e2eePrivateKey || !currentUser) {
                return
            }

            try {
                await performGroupKeyRotation(payload.groupChatId, payload.generation)
            } catch (error) {
                console.error('Failed to rotate group key:', error)
            }
        })

        socket.on('channel-key-needed', async (payload: { channelId: string; userId: string }) => {
            const { e2eePrivateKey, user: currentUser } = useAuthStore.getState()
            if (!e2eePrivateKey || !currentUser || String(currentUser.id) === payload.userId) {
                return
            }

            try {
                const channelKey = await getChannelKey(payload.channelId, e2eePrivateKey)
                const { wrappedKey, wrappedIv } = await wrapGroupKeyForMember(channelKey, e2eePrivateKey, payload.userId)
                await axios.post(`${API_URL}/channels/${payload.channelId}/keys`, {
                    userId: payload.userId,
                    wrappedKey,
                    wrappedIv,
                })
            } catch (error) {
                console.error('Failed to grant channel key to new member:', error)
            }
        })

        socket.on('group-settings-updated', (payload: { groupChatId: string; disappearingMessagesSeconds: number }) => {
            set((state) => ({
                groupChats: state.groupChats.map((group) =>
                    group.id === payload.groupChatId
                        ? { ...group, disappearingMessagesSeconds: payload.disappearingMessagesSeconds }
                        : group,
                ),
            }))
        })

        socket.on('dm-settings-updated', (payload: { peerId: string; disappearingMessagesSeconds: number }) => {
            set((state) => ({
                dmDisappearingSecondsByPeerId: {
                    ...state.dmDisappearingSecondsByPeerId,
                    [payload.peerId]: payload.disappearingMessagesSeconds,
                },
            }))
        })

        socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error)
        })

        socket.on('disconnect', (reason) => {
            console.warn('Socket disconnected:', reason)
        })

        socket.on('workspaces', (payload: { workspaces: Workspace[]; activeWorkspaceId: string | null }) => {
            set({ workspaces: payload.workspaces, activeWorkspaceId: payload.activeWorkspaceId })
        })

        socket.on('channels', (channels: Channel[]) => {
            const normalized = channels.map((channel) => normalizeChannel(channel))
            const { activeChannel } = get()
            const hasActiveChannelAccess = activeChannel
                ? normalized.some((channel: Channel) => channel.id === activeChannel)
                : true

            if (!hasActiveChannelAccess && activeChannel) {
                clearPersistedActiveChat()
                socket.emit('leave-channel', activeChannel)
                set((state) => ({
                    channels: normalized,
                    activeChannel: null,
                    messages: omitRecordKey(state.messages, activeChannel),
                    filesByChatId: omitRecordKey(state.filesByChatId, activeChannel),
                    typingUsersByChatId: omitRecordKey(state.typingUsersByChatId, activeChannel),
                }))
                return
            }

            set({ channels: normalized })
            void get().loadVoiceChannels()
        })

        socket.on('channel-access-removed', (payload: { channelId?: string; message?: string }) => {
            const removedChannelId = normalizeOptionalId(payload.channelId)
            if (!removedChannelId) {
                return
            }

            const { activeChannel } = get()
            if (activeChannel === removedChannelId) {
                clearPersistedActiveChat()
            }
            socket.emit('leave-channel', removedChannelId)

            set((state) => ({
                channels: state.channels.filter((channel) => channel.id !== removedChannelId),
                activeChannel:
                    state.activeChannel === removedChannelId ? null : state.activeChannel,
                messages: omitRecordKey(state.messages, removedChannelId),
                filesByChatId: omitRecordKey(state.filesByChatId, removedChannelId),
                typingUsersByChatId: omitRecordKey(
                    state.typingUsersByChatId,
                    removedChannelId,
                ),
            }))

            void get().loadChannels()
            void get().loadVoiceChannels()
        })

        socket.on('voice-channel-presence', (payload: { voiceChannelId: string; participants: VoiceChannelParticipant[] }) => {
            set((state) => ({
                voiceChannels: state.voiceChannels.map((voiceChannel) =>
                    voiceChannel.id === String(payload.voiceChannelId)
                        ? {
                            ...voiceChannel,
                            participants: (payload.participants || []).map((participant) => ({
                                ...participant,
                                userId: String(participant.userId),
                                avatar: participant.avatar || null,
                            })),
                        }
                        : voiceChannel,
                ),
            }))
        })

        socket.on('notification:new', (notification: InAppNotification) => {
            useNotificationStore.getState().upsertNotification(notification)
        })

        socket.on('message', async (message: Message) => {
            const processed = await processIncomingMessage(message)
            const currentUserId = useAuthStore.getState().user?.id
            const key = getConversationKey(processed, currentUserId)
            const normalizedCurrentUserId =
                currentUserId === null || currentUserId === undefined ? null : String(currentUserId)
            if (!key) {
                return
            }
            const {
                messages,
                activeChannel,
                activeDM,
                activeGroupChat,
                channels,
            } = get()
            const existingMessages = messages[key] || []

            if (existingMessages.find((existingMessage) => existingMessage.id === processed.id)) {
                return
            }

            const isActive = processed.channelId
                ? processed.channelId === activeChannel
                : processed.groupChatId
                    ? processed.groupChatId === activeGroupChat
                    : key === activeDM
            const isFocused = typeof document === 'undefined' ? true : document.hasFocus()
            const isOwnMessage = normalizedCurrentUserId
                ? processed.senderId === normalizedCurrentUserId
                : false
            const shouldIncrementUnread = !isOwnMessage && (!isActive || !isFocused)

            set((state) => {
                const nextMessages = {
                    ...state.messages,
                    [key]: mergeConversationMessages(state.messages[key] || [], [processed]),
                }

                const nextChannels = processed.channelId
                    ? state.channels.map((channel) => {
                        if (channel.id !== processed.channelId) {
                            return channel
                        }

                        return {
                            ...channel,
                            lastMessageAt: normalizeTimestamp(processed.timestamp),
                            unreadCount: shouldIncrementUnread
                                ? channel.unreadCount + 1
                                : 0,
                        }
                    })
                    : state.channels

                const nextDirectMessages = processed.channelId || processed.groupChatId
                    ? state.directMessages
                    : upsertDirectConversationInList(state.directMessages, {
                        id: key,
                        userId: key,
                        username: resolveDirectConversationUsername(
                            state.directMessages,
                            key,
                            processed,
                            normalizedCurrentUserId,
                        ),
                        avatar: resolveDirectConversationAvatar(
                            state.directMessages,
                            key,
                            processed,
                            normalizedCurrentUserId,
                        ),
                        lastMessageAt: normalizeTimestamp(processed.timestamp),
                        unreadCount: shouldIncrementUnread
                            ? getUnreadCountForConversation(state.directMessages, key) + 1
                            : 0,
                    })

                const nextGroupChats = processed.groupChatId
                    ? state.groupChats.map((group) => {
                        if (group.id !== processed.groupChatId) {
                            return group
                        }

                        return {
                            ...group,
                            lastMessageAt: normalizeTimestamp(processed.timestamp),
                            unreadCount: shouldIncrementUnread
                                ? group.unreadCount + 1
                                : 0,
                        }
                    })
                    : state.groupChats

                const nextTypingUsersByChatId = key
                    ? removeTypingUserFromConversation(
                        state.typingUsersByChatId,
                        key,
                        processed.senderId,
                    )
                    : state.typingUsersByChatId

                return {
                    messages: nextMessages,
                    channels: nextChannels,
                    directMessages: nextDirectMessages,
                    groupChats: nextGroupChats,
                    typingUsersByChatId: nextTypingUsersByChatId,
                }
            })

            if (processed.channelId && isActive && isFocused) {
                void get().markConversationVisited('channel', processed.channelId)
            }

            if (processed.groupChatId && isActive && isFocused) {
                void get().markConversationVisited('group', processed.groupChatId)
            }

            if (!processed.channelId && !processed.groupChatId && isActive && isFocused) {
                void get().markConversationVisited('dm', key)
            }

            if (!isOwnMessage && (!isActive || !isFocused)) {
                const channelName = processed.channelId
                    ? channels.find((channel) => channel.id === processed.channelId)?.name || 'channel'
                    : null
                const groupChatName = processed.groupChatId
                    ? get().groupChats.find((group) => group.id === processed.groupChatId)?.name || 'group chat'
                    : null
                useNotificationStore.getState().addToast({
                    id: `${processed.id}-${Date.now()}`,
                    title: processed.senderName,
                    body: channelName
                        ? `New message in #${channelName}`
                        : groupChatName
                            ? `New message in ${groupChatName}`
                            : 'New direct message',
                    target: processed.channelId
                        ? { type: 'channel', id: processed.channelId }
                        : processed.groupChatId
                            ? { type: 'group', id: processed.groupChatId }
                            : { type: 'dm', id: processed.senderId },
                })
            }
        })

        socket.on('poll-update', (payload: { pollId: string; options: PollOption[]; expiresAt?: string | null }) => {
            set((state) => ({
                messages: updatePollInMessages(state.messages, payload.pollId, (poll) => ({
                    ...poll,
                    options: payload.options.map((option) => {
                        const existing = poll.options.find((opt) => opt.id === option.id)
                        return {
                            ...option,
                            voters: existing?.voters || [],
                        }
                    }),
                    expiresAt: payload.expiresAt ?? poll.expiresAt,
                }))
            }))
        })

        socket.on('reaction-update', (payload: { messageId: string; reactions: ReactionSummary[] }) => {
            set((state) => ({
                messages: updateReactionsInMessages(state.messages, payload.messageId, payload.reactions)
            }))
        })

        socket.on('message-updated', (payload: { id: string; content?: string; editedAt?: string; isDeleted?: number | boolean; deletedAt?: string | null; fileUrl?: string | null; fileName?: string | null; fileType?: string | null; mentions?: MessageMention[] }) => {
            set((state) => ({
                messages: updateMessageFields(state.messages, payload.id, payload)
            }))
        })

        socket.on('message-archived', (payload: { messageId: string }) => {
            set((state) => ({
                messages: removeMessage(state.messages, payload.messageId)
            }))
        })

        socket.on('message-pin-update', (payload: { messageId: string; isPinned: boolean; pinnedAt: string | null }) => {
            set((state) => {
                const nextMessages = { ...state.messages }
                for (const chatId of Object.keys(nextMessages)) {
                    nextMessages[chatId] = nextMessages[chatId].map((message) =>
                        message.id === payload.messageId
                            ? { ...message, isPinned: payload.isPinned, pinnedAt: payload.pinnedAt }
                            : message
                    )
                }
                return { messages: nextMessages }
            })
        })

        socket.on('online-users', (users: string[]) => {
            set({ onlineUsers: users })
        })

        socket.on('presence-update', (presence: { [userId: string]: 'online' | 'idle' }) => {
            set({ presenceByUserId: presence })
        })

        socket.on('user-status-updated', (payload: {
            userId: string
            statusEmoji?: string | null
            statusText?: string | null
            statusClearsAt?: string | null
        }) => {
            set((state) => ({
                directMessages: state.directMessages.map((conversation) =>
                    conversation.userId === payload.userId
                        ? {
                            ...conversation,
                            statusEmoji: payload.statusEmoji || null,
                            statusText: payload.statusText || null,
                            statusClearsAt: payload.statusClearsAt || null,
                        }
                        : conversation,
                ),
            }))
        })

        socket.on('dm-read', (payload: { readerId: string; peerId: string; lastVisitedAt: string }) => {
            set((state) => ({
                readReceiptsByChatId: {
                    ...state.readReceiptsByChatId,
                    [payload.readerId]: {
                        ...state.readReceiptsByChatId[payload.readerId],
                        [payload.readerId]: payload.lastVisitedAt,
                    },
                },
            }))
        })

        socket.on('group-read', (payload: { readerId: string; groupChatId: string; lastVisitedAt: string }) => {
            set((state) => ({
                readReceiptsByChatId: {
                    ...state.readReceiptsByChatId,
                    [payload.groupChatId]: {
                        ...state.readReceiptsByChatId[payload.groupChatId],
                        [payload.readerId]: payload.lastVisitedAt,
                    },
                },
            }))
        })

        socket.on('typing-start', (payload: { chatId?: string; userId: string; username: string; avatar?: string | null }) => {
            const normalizedChatId = normalizeOptionalId(payload.chatId)
            if (!normalizedChatId) {
                return
            }

            const currentUserId = useAuthStore.getState().user?.id
            if (currentUserId !== null && currentUserId !== undefined && String(currentUserId) === String(payload.userId)) {
                return
            }

            const timeoutKey = getTypingTimeoutKey(normalizedChatId, payload.userId)
            const existingTimeout = typingIndicatorTimeouts.get(timeoutKey)
            if (existingTimeout) {
                window.clearTimeout(existingTimeout)
            }

            const nextTimeout = window.setTimeout(() => {
                set((state) => ({
                    typingUsersByChatId: removeTypingUserFromConversation(
                        state.typingUsersByChatId,
                        normalizedChatId,
                        payload.userId,
                    ),
                }))
                typingIndicatorTimeouts.delete(timeoutKey)
            }, TYPING_INDICATOR_TIMEOUT_MS)

            typingIndicatorTimeouts.set(timeoutKey, nextTimeout)

            set((state) => ({
                typingUsersByChatId: upsertTypingUserInConversation(
                    state.typingUsersByChatId,
                    normalizedChatId,
                    {
                        userId: String(payload.userId),
                        username: payload.username,
                        avatar: payload.avatar || null,
                    },
                ),
            }))
        })

        socket.on('typing-stop', (payload: { chatId?: string; userId: string }) => {
            const normalizedChatId = normalizeOptionalId(payload.chatId)
            if (!normalizedChatId) {
                return
            }

            const timeoutKey = getTypingTimeoutKey(normalizedChatId, payload.userId)
            const existingTimeout = typingIndicatorTimeouts.get(timeoutKey)
            if (existingTimeout) {
                window.clearTimeout(existingTimeout)
                typingIndicatorTimeouts.delete(timeoutKey)
            }

            set((state) => ({
                typingUsersByChatId: removeTypingUserFromConversation(
                    state.typingUsersByChatId,
                    normalizedChatId,
                    payload.userId,
                ),
            }))
        })

        set({ socket })
    },

    disconnectSocket: () => {
        const { socket } = get()
        if (socket) {
            socket.disconnect()
        }

        typingIndicatorTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
        typingIndicatorTimeouts.clear()
        if (idleTimer !== null) {
            window.clearTimeout(idleTimer)
            idleTimer = null
        }
        idleActivityCleanup?.()
        idleActivityCleanup = null
        set({ socket: null, typingUsersByChatId: {}, presenceByUserId: {} })
    },

    joinChannel: (channelId: string) => {
        const { socket } = get()
        socket?.emit('join-channel', channelId)
    },

    leaveChannel: (channelId: string) => {
        const { socket } = get()
        socket?.emit('leave-channel', channelId)
    },

    emitTypingStart: (channelId?: string, recipientId?: string, groupChatId?: string) => {
        const { socket } = get()
        if (!socket || !socket.connected) return

        socket.emit('typing-start', {
            channelId: channelId ? String(channelId) : undefined,
            recipientId: recipientId ? String(recipientId) : undefined,
            groupChatId: groupChatId ? String(groupChatId) : undefined,
        })
    },

    emitTypingStop: (channelId?: string, recipientId?: string, groupChatId?: string) => {
        const { socket } = get()
        if (!socket || !socket.connected) return

        socket.emit('typing-stop', {
            channelId: channelId ? String(channelId) : undefined,
            recipientId: recipientId ? String(recipientId) : undefined,
            groupChatId: groupChatId ? String(groupChatId) : undefined,
        })
    },

    sendMessage: async (content: string, channelId?: string, recipientId?: string, file?: File, replyToMessageId?: string | null, groupChatId?: string) => {
        const { socket } = get()

        if (file) {
            try {
                const { e2eePrivateKey, user } = useAuthStore.getState()
                if (!e2eePrivateKey || !user) {
                    useNotificationStore.getState().addToast({
                        id: `e2ee-error-${Date.now()}`,
                        title: 'File not sent',
                        body: 'End-to-end encryption is not ready yet. Please try again in a moment.',
                    })
                    return false
                }

                let fileKey: CryptoKey
                if (channelId) {
                    fileKey = await ensureChannelKey(String(channelId), e2eePrivateKey, String(user.id), socket)
                } else if (groupChatId) {
                    fileKey = await getGroupKey(String(groupChatId), e2eePrivateKey)
                } else if (recipientId) {
                    fileKey = await getSharedKey(e2eePrivateKey, String(recipientId))
                } else {
                    return false
                }

                const fileBytes = await file.arrayBuffer()
                const encryptedBody = await encryptBytes(fileBytes, fileKey)
                const encryptedMeta = await encryptMessage(
                    JSON.stringify({ name: file.name, type: file.type }),
                    fileKey,
                )

                const formData = new FormData()
                formData.append('file', new Blob([encryptedBody.cipher], { type: 'application/octet-stream' }), 'encrypted.bin')
                formData.append('fileIv', encryptedBody.iv)
                formData.append('encryptedFileMeta', encryptedMeta.cipherText)
                formData.append('fileMetaIv', encryptedMeta.iv)
                formData.append('isEncrypted', 'true')
                if (content) formData.append('content', content)
                if (channelId) formData.append('channelId', channelId)
                if (recipientId) formData.append('recipientId', recipientId)
                if (groupChatId) formData.append('groupChatId', groupChatId)
                if (replyToMessageId) formData.append('replyToMessageId', replyToMessageId)

                await axios.post(`${API_URL}/messages/upload`, formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                })
                return true
            } catch (error) {
                console.error('File upload failed:', error)
                useNotificationStore.getState().addToast({
                    id: `e2ee-error-${Date.now()}`,
                    title: 'File not sent',
                    body: 'Failed to encrypt and upload this file. Please try again.',
                })
                return false
            }
        } else {
            let payload: {
                content: string
                channelId?: string
                recipientId?: string
                groupChatId?: string
                replyToMessageId?: string | null
                cipherText?: string
                cipherIv?: string
                isEncrypted?: boolean
            } = {
                content,
                channelId,
                recipientId,
                groupChatId,
                replyToMessageId,
            }

            if (channelId) {
                const { e2eePrivateKey, user } = useAuthStore.getState()

                if (!e2eePrivateKey || !user) {
                    useNotificationStore.getState().addToast({
                        id: `e2ee-error-${Date.now()}`,
                        title: 'Message not sent',
                        body: 'End-to-end encryption is not ready yet. Please try again in a moment.',
                    })
                    return false
                }

                try {
                    const channelKey = await ensureChannelKey(String(channelId), e2eePrivateKey, String(user.id), get().socket)
                    const encrypted = await encryptMessage(content, channelKey)

                    payload = {
                        content: '',
                        channelId,
                        replyToMessageId,
                        cipherText: encrypted.cipherText,
                        cipherIv: encrypted.iv,
                        isEncrypted: true,
                    }
                } catch (error) {
                    console.error('Channel encryption failed:', error)
                    const message = error instanceof Error ? error.message : ''
                    useNotificationStore.getState().addToast({
                        id: `e2ee-error-${Date.now()}`,
                        title: 'Message not sent',
                        body: message.includes('Encryption key requested')
                            ? message
                            : 'Failed to encrypt this message. Please try again.',
                    })
                    return false
                }
            } else if (recipientId) {
                const { e2eePrivateKey, user } = useAuthStore.getState()

                if (!e2eePrivateKey || !user) {
                    useNotificationStore.getState().addToast({
                        id: `e2ee-error-${Date.now()}`,
                        title: 'Message not sent',
                        body: 'End-to-end encryption is not ready yet. Please try again in a moment.',
                    })
                    return false
                }

                try {
                    const peerId = String(recipientId)
                    const sharedKey = await getSharedKey(e2eePrivateKey, peerId)
                    const encrypted = await encryptMessage(content, sharedKey)

                    payload = {
                        content: '',
                        channelId,
                        recipientId,
                        replyToMessageId,
                        cipherText: encrypted.cipherText,
                        cipherIv: encrypted.iv,
                        isEncrypted: true,
                    }
                } catch (error) {
                    console.error('DM encryption failed:', error)
                    useNotificationStore.getState().addToast({
                        id: `e2ee-error-${Date.now()}`,
                        title: 'Message not sent',
                        body: 'Failed to encrypt this message. Please try again.',
                    })
                    return false
                }
            } else if (groupChatId) {
                const { e2eePrivateKey, user } = useAuthStore.getState()

                if (!e2eePrivateKey || !user) {
                    useNotificationStore.getState().addToast({
                        id: `e2ee-error-${Date.now()}`,
                        title: 'Message not sent',
                        body: 'End-to-end encryption is not ready yet. Please try again in a moment.',
                    })
                    return false
                }

                try {
                    const groupKey = await getGroupKey(String(groupChatId), e2eePrivateKey)
                    const encrypted = await encryptMessage(content, groupKey)

                    payload = {
                        content: '',
                        groupChatId,
                        replyToMessageId,
                        cipherText: encrypted.cipherText,
                        cipherIv: encrypted.iv,
                        isEncrypted: true,
                    }
                } catch (error) {
                    console.error('Group chat encryption failed:', error)
                    useNotificationStore.getState().addToast({
                        id: `e2ee-error-${Date.now()}`,
                        title: 'Message not sent',
                        body: 'Failed to encrypt this message. Please try again.',
                    })
                    return false
                }
            }

            const sendMessageViaHttp = async () => {
                if (groupChatId) {
                    console.error('Group chat messages require an active connection')
                    return false
                }

                try {
                    await axios.post(`${API_URL}/messages`, payload)

                    if (channelId) {
                        await get().loadChannelMessages(String(channelId))
                    } else if (recipientId) {
                        await get().loadDirectMessages(String(recipientId))
                    }

                    return true
                } catch (error) {
                    console.error('HTTP message send failed:', error)
                    return false
                }
            }

            if (!socket || !socket.connected) {
                console.warn('Socket not connected, sending message through HTTP fallback')
                return sendMessageViaHttp()
            }

            // Auto-join channel before sending if not already joined
            if (channelId) {
                socket.emit('join-channel', channelId)
            }

            return new Promise((resolve) => {
                socket.emit(
                    'message',
                    payload,
                    async (response: { ok: boolean; message?: string }) => {
                        if (!response?.ok) {
                            console.error('Message send failed:', response?.message)
                            useNotificationStore.getState().addToast({
                                id: `message-send-error-${Date.now()}`,
                                title: 'Message not sent',
                                body: response?.message || 'Failed to send message. Please try again.',
                            })
                            resolve(false)
                            return
                        }

                        if (channelId) {
                            await get().loadChannelMessages(String(channelId))
                        } else if (recipientId) {
                            await get().loadDirectMessages(String(recipientId))
                        } else if (groupChatId) {
                            await get().loadGroupChatMessages(String(groupChatId))
                        }

                        resolve(true)
                    },
                )
            })
        }
    },

    scheduleMessage: async (content, deliverAt, channelId, recipientId, replyToMessageId, groupChatId) => {
        let payload: {
            content: string
            channelId?: string
            recipientId?: string
            groupChatId?: string
            replyToMessageId?: string | null
            cipherText?: string
            cipherIv?: string
            isEncrypted?: boolean
            deliverAt: string
        } = {
            content,
            channelId,
            recipientId,
            groupChatId,
            replyToMessageId,
            deliverAt,
        }

        if (channelId) {
            const { e2eePrivateKey, user } = useAuthStore.getState()

            if (!e2eePrivateKey || !user) {
                useNotificationStore.getState().addToast({
                    id: `schedule-error-${Date.now()}`,
                    title: 'Message not scheduled',
                    body: 'End-to-end encryption is not ready yet. Please try again in a moment.',
                })
                return false
            }

            try {
                const channelKey = await ensureChannelKey(String(channelId), e2eePrivateKey, String(user.id), get().socket)
                const encrypted = await encryptMessage(content, channelKey)
                payload = {
                    content: '',
                    channelId,
                    replyToMessageId,
                    cipherText: encrypted.cipherText,
                    cipherIv: encrypted.iv,
                    isEncrypted: true,
                    deliverAt,
                }
            } catch (error) {
                console.error('Channel schedule encryption failed:', error)
                return false
            }
        } else if (recipientId) {
            const { e2eePrivateKey, user } = useAuthStore.getState()

            if (!e2eePrivateKey || !user) {
                useNotificationStore.getState().addToast({
                    id: `schedule-error-${Date.now()}`,
                    title: 'Message not scheduled',
                    body: 'End-to-end encryption is not ready yet. Please try again in a moment.',
                })
                return false
            }

            try {
                const sharedKey = await getSharedKey(e2eePrivateKey, String(recipientId))
                const encrypted = await encryptMessage(content, sharedKey)
                payload = {
                    content: '',
                    recipientId,
                    replyToMessageId,
                    cipherText: encrypted.cipherText,
                    cipherIv: encrypted.iv,
                    isEncrypted: true,
                    deliverAt,
                }
            } catch (error) {
                console.error('DM schedule encryption failed:', error)
                return false
            }
        } else if (groupChatId) {
            const { e2eePrivateKey, user } = useAuthStore.getState()

            if (!e2eePrivateKey || !user) {
                useNotificationStore.getState().addToast({
                    id: `schedule-error-${Date.now()}`,
                    title: 'Message not scheduled',
                    body: 'End-to-end encryption is not ready yet. Please try again in a moment.',
                })
                return false
            }

            try {
                const groupKey = await getGroupKey(String(groupChatId), e2eePrivateKey)
                const encrypted = await encryptMessage(content, groupKey)
                payload = {
                    content: '',
                    groupChatId,
                    replyToMessageId,
                    cipherText: encrypted.cipherText,
                    cipherIv: encrypted.iv,
                    isEncrypted: true,
                    deliverAt,
                }
            } catch (error) {
                console.error('Group schedule encryption failed:', error)
                return false
            }
        }

        try {
            await axios.post(`${API_URL}/messages/scheduled`, payload)
            return true
        } catch (error) {
            console.error('Error scheduling message:', error)
            return false
        }
    },

    sendGif: async (gifUrl: string, title: string, channelId?: string, recipientId?: string, replyToMessageId?: string | null, groupChatId?: string) => {
        const { socket } = get()

        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return false
        }

        return new Promise((resolve) => {
            socket.emit(
                'gif-message',
                { gifUrl, title, channelId, recipientId, groupChatId, replyToMessageId },
                (response: { ok: boolean; message?: string }) => {
                    if (!response?.ok) {
                        console.error('GIF send failed:', response?.message)
                        resolve(false)
                        return
                    }
                    resolve(true)
                },
            )
        })
    },

    createPoll: async (question, options, channelId, recipientId, durationMinutes, replyToMessageId, groupChatId) => {
        const { socket } = get()

        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return false
        }

        return new Promise((resolve) => {
            socket.emit(
                'poll-create',
                { question, options, channelId, recipientId, groupChatId, durationMinutes, replyToMessageId },
                (response: { ok: boolean; message?: string }) => {
                    if (!response?.ok) {
                        console.error('Poll create failed:', response?.message)
                    }
                    resolve(!!response?.ok)
                }
            )
        })
    },

    voteOnPoll: async (pollId, optionId) => {
        const { socket } = get()

        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return false
        }

        const previousMessages = get().messages
        set((state) => ({
            messages: updatePollInMessages(state.messages, pollId, (poll) => ({
                ...poll,
                userVoteOptionId: optionId,
            }))
        }))

        return new Promise((resolve) => {
            socket.emit(
                'poll-vote',
                { pollId, optionId },
                (response: { ok: boolean; message?: string }) => {
                    if (!response?.ok) {
                        console.error('Poll vote failed:', response?.message)
                        set({ messages: previousMessages })
                    }
                    resolve(!!response?.ok)
                }
            )
        })
    },

    toggleReaction: async (messageId, reaction) => {
        const { socket } = get()

        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return false
        }

        return new Promise((resolve) => {
            socket.emit(
                'reaction-toggle',
                { messageId, reaction },
                (response: { ok: boolean; reactions?: ReactionSummary[]; message?: string }) => {
                    if (!response?.ok) {
                        console.error('Reaction update failed:', response?.message)
                        resolve(false)
                        return
                    }
                    if (response.reactions) {
                        set((state) => ({
                            messages: updateReactionsInMessages(state.messages, messageId, response.reactions || [])
                        }))
                    }
                    resolve(true)
                }
            )
        })
    },

    editMessage: async (messageId, content) => {
        const { socket } = get()

        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return false
        }

        return new Promise((resolve) => {
            socket.emit(
                'message-edit',
                { messageId, content },
                (response: { ok: boolean; message?: { id: string; content: string; editedAt?: string; mentions?: MessageMention[] } }) => {
                    if (!response?.ok) {
                        console.error('Message edit failed:', response?.message)
                        resolve(false)
                        return
                    }
                    const updated = response.message
                    if (updated?.id) {
                        set((state) => ({
                            messages: updateMessageFields(state.messages, updated.id, updated)
                        }))
                    }
                    resolve(true)
                },
            )
        })
    },

    deleteMessage: async (messageId) => {
        const { socket } = get()

        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return false
        }

        return new Promise((resolve) => {
            socket.emit(
                'message-delete',
                { messageId },
                (response: { ok: boolean; message?: string }) => {
                    if (!response?.ok) {
                        console.error('Message delete failed:', response?.message)
                        resolve(false)
                        return
                    }
                    resolve(true)
                },
            )
        })
    },

    archiveMessage: async (messageId) => {
        const { socket } = get()

        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return false
        }

        return new Promise((resolve) => {
            socket.emit(
                'message-archive',
                { messageId },
                (response: { ok: boolean; message?: string }) => {
                    if (!response?.ok) {
                        console.error('Message archive failed:', response?.message)
                        resolve(false)
                        return
                    }
                    resolve(true)
                },
            )
        })
    },

    togglePinMessage: async (messageId) => {
        const { socket } = get()

        if (!socket || !socket.connected) {
            console.error('Socket not connected')
            return false
        }

        return new Promise((resolve) => {
            socket.emit(
                'message-pin-toggle',
                { messageId },
                (response: { ok: boolean; message?: string }) => {
                    if (!response?.ok) {
                        console.error('Pin toggle failed:', response?.message)
                        resolve(false)
                        return
                    }
                    resolve(true)
                },
            )
        })
    },

    toggleBookmarkMessage: async (messageId) => {
        try {
            const response = await axios.post(`${API_URL}/messages/${messageId}/bookmark`)
            const isBookmarked = Boolean(response.data?.isBookmarked)
            set((state) => ({
                messages: updateMessageFields(state.messages, messageId, {
                    isBookmarked,
                }),
            }))
            return true
        } catch (error) {
            console.error('Bookmark toggle failed:', error)
            return false
        }
    },

    loadPinnedMessages: async (chatType, chatId) => {
        try {
            const token = localStorage.getItem('token')
            const path = chatType === 'channel'
                ? `${API_URL}/messages/channel/${chatId}/pinned`
                : chatType === 'group'
                    ? `${API_URL}/messages/group/${chatId}/pinned`
                    : `${API_URL}/messages/direct/${chatId}/pinned`
            const response = await axios.get(path, {
                headers: { Authorization: `Bearer ${token}` }
            })
            return await Promise.all(
                response.data.map((message: Message) => processIncomingMessage(message))
            )
        } catch (error) {
            console.error('Error loading pinned messages:', error)
            return []
        }
    },

    loadBookmarkedMessages: async () => {
        try {
            const response = await axios.get(`${API_URL}/messages/bookmarks`)
            return await Promise.all(
                response.data.map((message: Message) => processIncomingMessage(message)),
            )
        } catch (error) {
            console.error('Error loading bookmarked messages:', error)
            return []
        }
    },

    loadThreadMessages: async (messageId) => {
        try {
            const response = await axios.get(`${API_URL}/messages/${messageId}/replies`)
            const processed = await Promise.all(
                (response.data?.messages || []).map((message: Message) =>
                    processIncomingMessage(message),
                ),
            )

            set((state) => {
                const nextMessages = { ...state.messages }
                const currentUserId = useAuthStore.getState().user?.id

                processed.forEach((message) => {
                    const key = getConversationKey(message, currentUserId)
                    if (!key) return
                    nextMessages[key] = mergeConversationMessages(
                        nextMessages[key] || [],
                        [message],
                    )
                })

                return { messages: nextMessages }
            })

            return {
                threadRootMessageId: String(response.data?.threadRootMessageId || messageId),
                messages: processed,
            }
        } catch (error) {
            console.error('Error loading thread messages:', error)
            return null
        }
    },

    searchMessages: async (_chatType, chatId, query) => {
        try {
            const response = await axios.get(`${API_URL}/search`, {
                params: {
                    chatType: _chatType,
                    chatId,
                    q: query,
                },
            })
            const processed = await Promise.all(
                (response.data?.messages || []).map((message: Message) => processIncomingMessage(message)),
            )
            const lower = String(response.data?.query || '').toLowerCase()

            return processed
                .filter((message) => {
                    if (message.isDeleted) {
                        return false
                    }

                    if (!lower) {
                        return true
                    }

                    return typeof message.content === 'string' && message.content.toLowerCase().includes(lower)
                })
                .sort(
                    (left, right) =>
                        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
                )
        } catch (error) {
            console.error('Error searching messages:', error)
            return []
        }
    },

    setActiveChannel: (channelId: string | null) => {
        const normalizedChannelId = channelId ? String(channelId) : null
        const { socket, activeChannel: previousChannelId } = get()

        if (previousChannelId && previousChannelId !== normalizedChannelId) {
            socket?.emit('leave-channel', previousChannelId)
        }

        if (normalizedChannelId) {
            socket?.emit('join-channel', normalizedChannelId)
            persistActiveChat({ type: 'channel', id: normalizedChannelId })
        } else {
            clearPersistedActiveChat()
        }

        set((state) => ({
            activeChannel: normalizedChannelId,
            activeDM: null,
            activeGroupChat: null,
            channels: normalizedChannelId
                ? state.channels.map((channel) =>
                    channel.id === normalizedChannelId
                        ? { ...channel, unreadCount: 0 }
                        : channel,
                )
                : state.channels,
        }))

        if (normalizedChannelId) {
            void get().markConversationVisited('channel', normalizedChannelId)
        }
    },

    setActiveDM: (dmId: string | null) => {
        const normalizedDmId = dmId ? String(dmId) : null
        const { socket, activeChannel } = get()

        if (activeChannel) {
            socket?.emit('leave-channel', activeChannel)
        }

        if (normalizedDmId) {
            persistActiveChat({ type: 'dm', id: normalizedDmId })
        } else {
            clearPersistedActiveChat()
        }

        set((state) => ({
            activeDM: normalizedDmId,
            activeChannel: null,
            activeGroupChat: null,
            directMessages: normalizedDmId
                ? upsertDirectConversationInList(state.directMessages, {
                    id: normalizedDmId,
                    userId: normalizedDmId,
                    unreadCount: 0,
                })
                : state.directMessages,
        }))

        if (normalizedDmId) {
            void get().markConversationVisited('dm', normalizedDmId)
        }
    },

    setActiveGroupChat: (groupChatId: string | null) => {
        const normalizedGroupChatId = groupChatId ? String(groupChatId) : null
        const { socket, activeChannel } = get()

        if (activeChannel) {
            socket?.emit('leave-channel', activeChannel)
        }

        if (normalizedGroupChatId) {
            persistActiveChat({ type: 'group', id: normalizedGroupChatId })
        } else {
            clearPersistedActiveChat()
        }

        set((state) => ({
            activeGroupChat: normalizedGroupChatId,
            activeChannel: null,
            activeDM: null,
            groupChats: normalizedGroupChatId
                ? state.groupChats.map((group) =>
                    group.id === normalizedGroupChatId
                        ? { ...group, unreadCount: 0 }
                        : group,
                )
                : state.groupChats,
        }))

        if (normalizedGroupChatId) {
            void get().markConversationVisited('group', normalizedGroupChatId)
        }
    },

    setMessageFocusTarget: (target) => {
        set({ messageFocusTarget: target })
    },

    clearMessageFocusTarget: () => {
        set({ messageFocusTarget: null })
    },

    requestLatestMessageView: (chatType, chatId) => {
        set({
            latestMessageRequest: {
                chatType,
                chatId: String(chatId),
                nonce: Date.now(),
            },
        })
    },

    clearLatestMessageRequest: () => {
        set({ latestMessageRequest: null })
    },

    restoreActiveChat: (userId: string) => {
        const persisted = readPersistedActiveChat()
        const normalizedUserId = String(userId)

        if (!persisted || persisted.userId !== normalizedUserId) {
            clearPersistedActiveChat()
            set({ activeChannel: null, activeDM: null, activeGroupChat: null })
            return
        }

        if (persisted.type === 'channel') {
            get().setActiveChannel(persisted.id)
            return
        }

        if (persisted.type === 'group') {
            get().setActiveGroupChat(persisted.id)
            return
        }

        get().setActiveDM(persisted.id)
    },

    loadChannels: async () => {
        try {
            const { activeWorkspaceId } = get()
            const response = await axios.get(`${API_URL}/channels`, {
                params: activeWorkspaceId ? { workspaceId: activeWorkspaceId } : undefined,
            })
            const normalized = response.data.map((channel: Channel) => normalizeChannel(channel))
            const { activeChannel, socket } = get()
            const hasActiveChannelAccess = activeChannel
                ? normalized.some((channel: Channel) => channel.id === activeChannel)
                : true

            if (!hasActiveChannelAccess && activeChannel) {
                clearPersistedActiveChat()
                socket?.emit('leave-channel', activeChannel)
                set((state) => ({
                    channels: normalized,
                    activeChannel: null,
                    messages: omitRecordKey(state.messages, activeChannel),
                    filesByChatId: omitRecordKey(state.filesByChatId, activeChannel),
                    typingUsersByChatId: omitRecordKey(
                        state.typingUsersByChatId,
                        activeChannel,
                    ),
                }))
                void get().loadVoiceChannels()
                return
            }

            set({ channels: normalized })
            void get().loadVoiceChannels()
        } catch (error) {
            console.error('Error loading channels:', error)
        }
    },

    createChannel: async (name, description, isPrivate) => {
        try {
            // Every channel is E2EE regardless of public/private visibility - the
            // creator always wraps a fresh channel key for themselves.
            const { e2eePrivateKey, user } = useAuthStore.getState()
            if (!e2eePrivateKey || !user) {
                return { ok: false, message: 'End-to-end encryption is not ready yet. Please try again in a moment.' }
            }

            const channelKey = await generateGroupKey()
            const { wrappedKey, wrappedIv } = await wrapGroupKeyForMember(channelKey, e2eePrivateKey, String(user.id))

            const response = await axios.post(`${API_URL}/channels`, {
                name,
                description,
                isPrivate,
                wrappedKey,
                wrappedIv,
            })
            cacheChannelKey(String(response.data.channel.id), 1, channelKey)
            return { ok: true }
        } catch (error) {
            console.error('Error creating channel:', error)
            const axiosError = error as { response?: { data?: { message?: string } } }
            return { ok: false, message: axiosError.response?.data?.message || 'Failed to create channel' }
        }
    },

    loadWorkspaces: async () => {
        try {
            const response = await axios.get(`${API_URL}/workspaces`)
            const workspaces: Workspace[] = response.data
            const { activeWorkspaceId } = get()
            const stillValid = activeWorkspaceId
                ? workspaces.some((workspace) => workspace.id === activeWorkspaceId)
                : false

            set({
                workspaces,
                activeWorkspaceId: stillValid ? activeWorkspaceId : workspaces[0]?.id ?? null,
            })
        } catch (error) {
            console.error('Error loading workspaces:', error)
        }
    },

    switchWorkspace: async (workspaceId) => {
        if (get().activeWorkspaceId === workspaceId) {
            return
        }
        set({ activeWorkspaceId: workspaceId, activeChannel: null })
        clearPersistedActiveChat()
        await get().loadChannels()
    },

    createWorkspace: async (name) => {
        try {
            const response = await axios.post(`${API_URL}/workspaces`, { name })
            await get().loadWorkspaces()
            await get().switchWorkspace(response.data.id)
            return { ok: true }
        } catch (error) {
            console.error('Error creating workspace:', error)
            const axiosError = error as { response?: { data?: { message?: string } } }
            return { ok: false, message: axiosError.response?.data?.message || 'Failed to create workspace' }
        }
    },

    loadDirectConversations: async () => {
        try {
            const response = await axios.get(`${API_URL}/messages/direct-conversations`)
            const normalized = response.data.map((conversation: DirectMessage) =>
                normalizeDirectConversation(conversation),
            )
            set({ directMessages: sortDirectConversations(normalized) })
        } catch (error) {
            console.error('Error loading direct conversations:', error)
        }
    },

    loadChannelMessages: async (channelId: string) => {
        try {
            const token = localStorage.getItem('token')
            const response = await axios.get(`${API_URL}/messages/channel/${channelId}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            const processed = await Promise.all(
                response.data.map((message: Message) => processIncomingMessage(message))
            )
            set((state) => ({
                messages: {
                    ...state.messages,
                    [channelId]: mergeConversationMessages([], processed)
                },
                channels: state.channels.map((channel) =>
                    channel.id === String(channelId)
                        ? { ...channel, unreadCount: 0 }
                        : channel,
                ),
            }))

            const channel = get().channels.find((c) => c.id === String(channelId))
            rotateIfStale('channel', String(channelId), channel?.keyGenerationRotatedAt, channel?.currentKeyGeneration)
        } catch (error) {
            console.error('Error loading channel messages:', error)
        }
    },

    loadDirectMessages: async (userId: string) => {
        try {
            const token = localStorage.getItem('token')
            const response = await axios.get(`${API_URL}/messages/direct/${userId}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            const processed = await Promise.all(
                response.data.map((message: Message) => processIncomingMessage(message))
            )
            set((state) => ({
                messages: {
                    ...state.messages,
                    [String(userId)]: mergeConversationMessages([], processed)
                },
                directMessages: upsertDirectConversationInList(state.directMessages, {
                    id: String(userId),
                    userId: String(userId),
                    unreadCount: 0,
                    lastMessageAt: getLastMessageTimestamp(processed) || null,
                }),
            }))

            try {
                const readStateResponse = await axios.get(`${API_URL}/messages/direct/${userId}/read-state`)
                if (readStateResponse.data.lastVisitedAt) {
                    set((state) => ({
                        readReceiptsByChatId: {
                            ...state.readReceiptsByChatId,
                            [String(userId)]: {
                                ...state.readReceiptsByChatId[String(userId)],
                                [String(userId)]: readStateResponse.data.lastVisitedAt,
                            },
                        },
                    }))
                }
            } catch (error) {
                console.error('Error loading DM read state:', error)
            }
        } catch (error) {
            console.error('Error loading direct messages:', error)
        }
    },

    loadMessageById: async (messageId: string) => {
        try {
            const token = localStorage.getItem('token')
            const response = await axios.get(`${API_URL}/messages/${messageId}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            const processed = await processIncomingMessage(response.data)
            const currentUserId = useAuthStore.getState().user?.id
            const key = getConversationKey(processed, currentUserId)

            if (!key) {
                return processed
            }

            set((state) => ({
                messages: {
                    ...state.messages,
                    [key]: mergeConversationMessages(state.messages[key] || [], [processed]),
                }
            }))

            return processed
        } catch (error) {
            console.error('Error loading message by id:', error)
            return null
        }
    },

    loadChannelFiles: async (channelId: string) => {
        try {
            const response = await axios.get(`${API_URL}/messages/channel/${channelId}/files`)
            set((state) => ({
                filesByChatId: {
                    ...state.filesByChatId,
                    [channelId]: response.data
                }
            }))
        } catch (error) {
            console.error('Error loading channel files:', error)
        }
    },

    loadDirectFiles: async (userId: string) => {
        try {
            const response = await axios.get(`${API_URL}/messages/direct/${userId}/files`)
            set((state) => ({
                filesByChatId: {
                    ...state.filesByChatId,
                    [userId]: response.data
                }
            }))
        } catch (error) {
            console.error('Error loading direct files:', error)
        }
    },

    upsertDirectConversation: (conversation) => {
        set((state) => ({
            directMessages: upsertDirectConversationInList(state.directMessages, conversation),
        }))
    },

    markConversationVisited: async (chatType, chatId) => {
        const normalizedChatId = String(chatId)

        set((state) => ({
            channels: chatType === 'channel'
                ? state.channels.map((channel) =>
                    channel.id === normalizedChatId
                        ? { ...channel, unreadCount: 0 }
                        : channel,
                )
                : state.channels,
            directMessages: chatType === 'dm'
                ? upsertDirectConversationInList(state.directMessages, {
                    id: normalizedChatId,
                    userId: normalizedChatId,
                    unreadCount: 0,
                })
                : state.directMessages,
            groupChats: chatType === 'group'
                ? state.groupChats.map((group) =>
                    group.id === normalizedChatId
                        ? { ...group, unreadCount: 0 }
                        : group,
                )
                : state.groupChats,
        }))

        try {
            if (chatType === 'channel') {
                await axios.post(`${API_URL}/messages/channel/${normalizedChatId}/visit`)
                return
            }

            if (chatType === 'group') {
                await axios.post(`${API_URL}/group-chats/${normalizedChatId}/visit`)
                return
            }

            await axios.post(`${API_URL}/messages/direct/${normalizedChatId}/visit`)
        } catch (error) {
            console.error(`Error marking ${chatType} visited:`, error)
        }
    },

    markAllConversationsRead: async () => {
        set((state) => ({
            channels: state.channels.map((ch) => ({ ...ch, unreadCount: 0 })),
            directMessages: state.directMessages.map((dm) => ({ ...dm, unreadCount: 0 })),
            groupChats: state.groupChats.map((g) => ({ ...g, unreadCount: 0 })),
        }))
        try {
            await axios.post(`${API_URL}/users/me/mark-all-read`)
        } catch (error) {
            console.error('Error marking all conversations as read:', error)
        }
    },

    loadGroupChats: async () => {
        try {
            const response = await axios.get(`${API_URL}/group-chats`)
            set({ groupChats: response.data.map(normalizeGroupChat) })
        } catch (error) {
            console.error('Error loading group chats:', error)
        }
    },

    loadVoiceChannels: async () => {
        try {
            const response = await axios.get(`${API_URL}/voice-channels`)
            set({
                voiceChannels: Array.isArray(response.data)
                    ? response.data.map(normalizeVoiceChannel)
                    : [],
            })
        } catch (error) {
            console.error('Error loading voice channels:', error)
        }
    },

    loadWorkspaceEmoji: async () => {
        try {
            const response = await axios.get(`${API_URL}/workspace-emoji`)
            set({
                workspaceEmoji: Array.isArray(response.data)
                    ? response.data.map(normalizeWorkspaceEmoji)
                    : [],
            })
        } catch (error) {
            console.error('Error loading workspace emoji:', error)
        }
    },

    createGroupChat: async (name: string, memberIds: string[]) => {
        const { e2eePrivateKey, user } = useAuthStore.getState()

        if (!e2eePrivateKey || !user) {
            console.error('End-to-end encryption is not ready yet')
            return null
        }

        try {
            const groupKey = await generateGroupKey()
            const allMemberIds = [...new Set([String(user.id), ...memberIds.map(String)])]
            const keys = await Promise.all(
                allMemberIds.map(async (memberId) => {
                    const { wrappedKey, wrappedIv } = await wrapGroupKeyForMember(groupKey, e2eePrivateKey, memberId)
                    return { userId: memberId, wrappedKey, wrappedIv }
                })
            )

            const response = await axios.post(`${API_URL}/group-chats`, { name, memberIds, keys })
            const groupChat = normalizeGroupChat(response.data)
            cacheGroupKey(groupChat.id, 1, groupKey)

            set((state) => ({ groupChats: [groupChat, ...state.groupChats] }))
            return groupChat
        } catch (error) {
            console.error('Error creating group chat:', error)
            return null
        }
    },

    loadGroupChatMessages: async (groupChatId: string) => {
        try {
            const token = localStorage.getItem('token')
            const response = await axios.get(`${API_URL}/messages/group/${groupChatId}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            const processed = await Promise.all(
                response.data.map((message: Message) => processIncomingMessage(message))
            )
            set((state) => ({
                messages: {
                    ...state.messages,
                    [groupChatId]: mergeConversationMessages([], processed)
                },
                groupChats: state.groupChats.map((group) =>
                    group.id === String(groupChatId)
                        ? { ...group, unreadCount: 0 }
                        : group,
                ),
            }))

            const groupChat = get().groupChats.find((g) => g.id === String(groupChatId))
            rotateIfStale('group', String(groupChatId), groupChat?.keyGenerationRotatedAt, groupChat?.currentKeyGeneration)

            try {
                const readStateResponse = await axios.get(`${API_URL}/group-chats/${groupChatId}/read-state`)
                set((state) => ({
                    readReceiptsByChatId: {
                        ...state.readReceiptsByChatId,
                        [String(groupChatId)]: {
                            ...state.readReceiptsByChatId[String(groupChatId)],
                            ...readStateResponse.data,
                        },
                    },
                }))
            } catch (error) {
                console.error('Error loading group read state:', error)
            }
        } catch (error) {
            console.error('Error loading group chat messages:', error)
        }
    },

    leaveGroupChat: async (groupChatId: string) => {
        try {
            await axios.post(`${API_URL}/group-chats/${groupChatId}/leave`)
            set((state) => ({
                groupChats: state.groupChats.filter((group) => group.id !== String(groupChatId)),
                activeGroupChat: state.activeGroupChat === String(groupChatId) ? null : state.activeGroupChat,
            }))
            return true
        } catch (error) {
            console.error('Error leaving group chat:', error)
            return false
        }
    },

    createInviteLink: async (targetType, targetId, options) => {
        try {
            const response = await axios.post(`${API_URL}/invites`, {
                targetType,
                targetId,
                maxUses: options?.maxUses,
                expiresInHours: options?.expiresInHours,
            })
            return { ...response.data, id: String(response.data.id), targetId: String(response.data.targetId) }
        } catch (error) {
            console.error('Error creating invite link:', error)
            return null
        }
    },

    listInviteLinks: async (targetType, targetId) => {
        try {
            const response = await axios.get(`${API_URL}/invites/target/${targetType}/${targetId}`)
            return response.data.map((invite: InviteLink) => ({
                ...invite,
                id: String(invite.id),
                targetId: String(invite.targetId),
            }))
        } catch (error) {
            console.error('Error listing invite links:', error)
            return []
        }
    },

    revokeInviteLink: async (inviteId) => {
        try {
            await axios.delete(`${API_URL}/invites/${inviteId}`)
            return true
        } catch (error) {
            console.error('Error revoking invite link:', error)
            return false
        }
    },

    previewInvite: async (code) => {
        try {
            const response = await axios.get(`${API_URL}/invites/${code}`)
            return response.data
        } catch (error) {
            console.error('Error previewing invite:', error)
            return null
        }
    },

    redeemInvite: async (code) => {
        try {
            const response = await axios.post(`${API_URL}/invites/${code}/redeem`)
            if (response.data.targetType === 'channel') {
                await get().loadChannels()
            } else {
                await get().loadGroupChats()
            }
            return response.data
        } catch (error) {
            console.error('Error redeeming invite:', error)
            return null
        }
    },

    setGroupChatDisappearing: async (groupChatId, seconds) => {
        try {
            await axios.put(`${API_URL}/group-chats/${groupChatId}/settings`, {
                disappearingMessagesSeconds: seconds,
            })
            set((state) => ({
                groupChats: state.groupChats.map((group) =>
                    group.id === String(groupChatId)
                        ? { ...group, disappearingMessagesSeconds: seconds }
                        : group,
                ),
            }))
            return true
        } catch (error) {
            console.error('Error updating group disappearing messages:', error)
            return false
        }
    },

    loadDmDisappearingSeconds: async (peerId) => {
        try {
            const response = await axios.get(`${API_URL}/messages/direct/${peerId}/settings`)
            set((state) => ({
                dmDisappearingSecondsByPeerId: {
                    ...state.dmDisappearingSecondsByPeerId,
                    [String(peerId)]: response.data.disappearingMessagesSeconds || 0,
                },
            }))
        } catch (error) {
            console.error('Error loading DM disappearing messages setting:', error)
        }
    },

    setDmDisappearing: async (peerId, seconds) => {
        try {
            await axios.put(`${API_URL}/messages/direct/${peerId}/settings`, {
                disappearingMessagesSeconds: seconds,
            })
            set((state) => ({
                dmDisappearingSecondsByPeerId: {
                    ...state.dmDisappearingSecondsByPeerId,
                    [String(peerId)]: seconds,
                },
            }))
            return true
        } catch (error) {
            console.error('Error updating DM disappearing messages:', error)
            return false
        }
    },
}))

const updatePollInMessages = (
    messageMap: { [key: string]: Message[] },
    pollId: string,
    updater: (poll: Poll) => Poll,
) => {
    const updated = { ...messageMap }

    Object.keys(updated).forEach((key) => {
        updated[key] = updated[key].map((message) => {
            if (message.poll && message.poll.id === pollId) {
                return { ...message, poll: updater(message.poll) }
            }
            return message
        })
    })

    return updated
}

const mergeConversationMessages = (
    existingMessages: Message[],
    incomingMessages: Message[],
) => {
    const byId = new Map<string, Message>()

    existingMessages.forEach((message) => {
        byId.set(message.id, message)
    })

    incomingMessages.forEach((message) => {
        const existing = byId.get(message.id)
        byId.set(message.id, existing ? { ...existing, ...message } : message)
    })

    return Array.from(byId.values()).sort(
        (left, right) =>
            new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    )
}

const updateReactionsInMessages = (
    messageMap: { [key: string]: Message[] },
    messageId: string,
    reactions: ReactionSummary[],
) => {
    const updated = { ...messageMap }

    Object.keys(updated).forEach((key) => {
        updated[key] = updated[key].map((message) => {
            if (message.id === messageId) {
                const existing = message.reactions || []
                const merged = reactions.map((incoming) => {
                    const previous = existing.find((item) => item.type === incoming.type)
                    return {
                        ...incoming,
                        reacted: incoming.reacted ?? previous?.reacted,
                    }
                })
                return { ...message, reactions: merged }
            }
            return message
        })
    })

    return updated
}

const updateMessageFields = (
    messageMap: { [key: string]: Message[] },
    messageId: string,
    fields: Partial<Message>,
) => {
    const updated = { ...messageMap }

    Object.keys(updated).forEach((key) => {
        updated[key] = updated[key].map((message) => {
            if (message.id === messageId) {
                return { ...message, ...fields }
            }
            return message
        })
    })

    return updated
}

const removeMessage = (
    messageMap: { [key: string]: Message[] },
    messageId: string,
) => {
    const updated = { ...messageMap }

    Object.keys(updated).forEach((key) => {
        updated[key] = updated[key].filter((message) => message.id !== messageId)
    })

    return updated
}

const processIncomingMessage = async (message: Message) => {
    const normalizedMessage = normalizeMessage(message)
    const isEncrypted = normalizedMessage.isEncrypted === 1 || normalizedMessage.isEncrypted === true
    if (!isEncrypted || !normalizedMessage.cipherText || !normalizedMessage.cipherIv) {
        return normalizedMessage
    }

    const { e2eePrivateKey, user } = useAuthStore.getState()
    if (!e2eePrivateKey || !user) {
        return { ...normalizedMessage, content: '[Encrypted message]' }
    }

    if (normalizedMessage.groupChatId) {
        try {
            const groupKey = await getGroupKey(String(normalizedMessage.groupChatId), e2eePrivateKey, normalizedMessage.keyGeneration ?? undefined)
            const content = await decryptMessage(normalizedMessage.cipherText, normalizedMessage.cipherIv, groupKey)
            return { ...normalizedMessage, content }
        } catch (error) {
            console.error('E2EE group decrypt failed:', error)
            return { ...normalizedMessage, content: '[Encrypted message]' }
        }
    }

    if (normalizedMessage.channelId) {
        try {
            const channelKey = await ensureChannelKey(
                String(normalizedMessage.channelId),
                e2eePrivateKey,
                String(user.id),
                useChatStore.getState().socket,
                normalizedMessage.keyGeneration ?? undefined,
            )
            const content = await decryptMessage(normalizedMessage.cipherText, normalizedMessage.cipherIv, channelKey)
            return { ...normalizedMessage, content }
        } catch (error) {
            console.error('E2EE channel decrypt failed:', error)
            return { ...normalizedMessage, content: '[Encrypted message]' }
        }
    }

    const peerId = normalizedMessage.senderId === String(user.id)
        ? normalizedMessage.recipientId
        : normalizedMessage.senderId
    if (!peerId) {
        return { ...normalizedMessage, content: '[Encrypted message]' }
    }

    try {
        const sharedKey = await getSharedKey(e2eePrivateKey, String(peerId))
        const content = await decryptMessage(normalizedMessage.cipherText, normalizedMessage.cipherIv, sharedKey)
        return { ...normalizedMessage, content }
    } catch (error) {
        console.error('E2EE decrypt failed:', error)
        return { ...normalizedMessage, content: '[Encrypted message]' }
    }
}

const normalizeOptionalId = (value: string | number | null | undefined) =>
    value === null || value === undefined ? undefined : String(value)

const omitRecordKey = <T>(record: Record<string, T>, key: string) => {
    const nextRecord = { ...record }
    delete nextRecord[key]
    return nextRecord
}

const normalizeReplyContext = (replyContext?: ReplyContext | null): ReplyContext | null => {
    if (!replyContext) return null

    return {
        ...replyContext,
        id: String(replyContext.id),
        senderId: String(replyContext.senderId),
    }
}

const normalizeTimestamp = (timestamp?: string | Date | null) => {
    if (!timestamp) return null
    return timestamp instanceof Date ? timestamp.toISOString() : String(timestamp)
}

const normalizeChannel = (channel: Channel): Channel => ({
    ...channel,
    id: String(channel.id),
    unreadCount: Number(channel.unreadCount || 0),
    lastMessageAt: channel.lastMessageAt || null,
})

const normalizeGroupChat = (group: GroupChat): GroupChat => ({
    ...group,
    id: String(group.id),
    members: (group.members || []).map((member) => ({ ...member, id: String(member.id) })),
    unreadCount: Number(group.unreadCount || 0),
    lastMessageAt: group.lastMessageAt || null,
})

const normalizeVoiceChannel = (voiceChannel: VoiceChannel): VoiceChannel => ({
    ...voiceChannel,
    id: String(voiceChannel.id),
    channelId: String(voiceChannel.channelId),
    description: voiceChannel.description || '',
    isPrivate: Boolean(voiceChannel.isPrivate),
    participants: Array.isArray(voiceChannel.participants)
        ? voiceChannel.participants.map((participant) => ({
            ...participant,
            userId: String(participant.userId),
            avatar: participant.avatar || null,
        }))
        : [],
})

const normalizeWorkspaceEmoji = (emoji: WorkspaceEmoji): WorkspaceEmoji => ({
    ...emoji,
    id: String(emoji.id),
    name: String(emoji.name),
    imageUrl: String(emoji.imageUrl),
})

const normalizeDirectConversation = (
    conversation: Partial<DirectMessage> & { id: string },
): DirectMessage => {
    const id = String(conversation.id ?? conversation.userId)

    return {
        id,
        userId: String(conversation.userId ?? id),
        username: conversation.username || 'Direct Message',
        avatar: conversation.avatar || null,
        statusEmoji: conversation.statusEmoji || null,
        statusText: conversation.statusText || null,
        statusClearsAt: conversation.statusClearsAt || null,
        lastMessageAt: conversation.lastMessageAt || null,
        unreadCount: Number(conversation.unreadCount || 0),
    }
}

const sortDirectConversations = (conversations: DirectMessage[]) =>
    [...conversations].sort((left, right) => {
        const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0
        const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0

        if (rightTime !== leftTime) {
            return rightTime - leftTime
        }

        return left.username.localeCompare(right.username)
    })

const upsertDirectConversationInList = (
    conversations: DirectMessage[],
    conversation: Partial<DirectMessage> & { id: string },
) => {
    const normalizedConversation = normalizeDirectConversation(conversation)
    const existingConversation = conversations.find(
        (currentConversation) => currentConversation.id === normalizedConversation.id,
    )

    const nextConversation = existingConversation
        ? {
            ...existingConversation,
            ...normalizedConversation,
            username:
                conversation.username || existingConversation.username || normalizedConversation.username,
            avatar:
                conversation.avatar !== undefined
                    ? conversation.avatar
                    : existingConversation.avatar ?? normalizedConversation.avatar ?? null,
            lastMessageAt:
                conversation.lastMessageAt !== undefined
                    ? conversation.lastMessageAt || null
                    : existingConversation.lastMessageAt || normalizedConversation.lastMessageAt || null,
        }
        : normalizedConversation

    const nextConversations = conversations.filter(
        (currentConversation) => currentConversation.id !== normalizedConversation.id,
    )
    nextConversations.push(nextConversation)

    return sortDirectConversations(nextConversations)
}

const resolveDirectConversationUsername = (
    conversations: DirectMessage[],
    conversationId: string,
    message: Message,
    currentUserId: string | null,
) => {
    const existingConversation = conversations.find(
        (conversation) => conversation.id === conversationId,
    )

    if (existingConversation?.username) {
        return existingConversation.username
    }

    if (!currentUserId || message.senderId !== currentUserId) {
        return message.senderName || 'Direct Message'
    }

    return 'Direct Message'
}

const resolveDirectConversationAvatar = (
    conversations: DirectMessage[],
    conversationId: string,
    message: Message,
    currentUserId: string | null,
) => {
    const existingConversation = conversations.find(
        (conversation) => conversation.id === conversationId,
    )

    if (existingConversation?.avatar) {
        return existingConversation.avatar
    }

    if (!currentUserId || message.senderId !== currentUserId) {
        return message.senderAvatar || null
    }

    return null
}

const getUnreadCountForConversation = (
    conversations: DirectMessage[],
    conversationId: string,
) =>
    conversations.find((conversation) => conversation.id === conversationId)?.unreadCount || 0

const getLastMessageTimestamp = (messages: Message[]) => {
    if (messages.length === 0) return null
    return normalizeTimestamp(messages[messages.length - 1].timestamp)
}

const normalizeMessage = (message: Message): Message => ({
    ...message,
    id: String(message.id),
    senderId: String(message.senderId),
    channelId: normalizeOptionalId(message.channelId),
    recipientId: normalizeOptionalId(message.recipientId),
    groupChatId: normalizeOptionalId(message.groupChatId),
    replyToMessageId: normalizeOptionalId(message.replyToMessageId),
    threadRootMessageId: normalizeOptionalId(message.threadRootMessageId),
    replyContext: normalizeReplyContext(message.replyContext),
})

const getConversationKey = (
    message: Pick<Message, 'channelId' | 'recipientId' | 'senderId' | 'groupChatId'>,
    currentUserId?: string | number | null,
) => {
    if (message.channelId) {
        return String(message.channelId)
    }

    if (message.groupChatId) {
        return String(message.groupChatId)
    }

    const normalizedCurrentUserId =
        currentUserId === null || currentUserId === undefined ? null : String(currentUserId)
    const senderId = String(message.senderId)
    const recipientId = normalizeOptionalId(message.recipientId)

    if (normalizedCurrentUserId && senderId !== normalizedCurrentUserId) {
        return senderId
    }

    return recipientId || senderId
}

const getTypingTimeoutKey = (chatId: string, userId: string | number) =>
    `${chatId}:${String(userId)}`

const upsertTypingUserInConversation = (
    typingUsersByChatId: { [key: string]: TypingUser[] },
    chatId: string,
    typingUser: TypingUser,
) => {
    const existingUsers = typingUsersByChatId[chatId] || []
    const nextUsers = existingUsers.some((user) => user.userId === typingUser.userId)
        ? existingUsers.map((user) =>
            user.userId === typingUser.userId
                ? { ...user, ...typingUser }
                : user,
        )
        : [...existingUsers, typingUser]

    return {
        ...typingUsersByChatId,
        [chatId]: nextUsers,
    }
}

const removeTypingUserFromConversation = (
    typingUsersByChatId: { [key: string]: TypingUser[] },
    chatId: string,
    userId: string | number,
) => {
    const existingUsers = typingUsersByChatId[chatId] || []
    const nextUsers = existingUsers.filter((user) => user.userId !== String(userId))

    if (nextUsers.length === existingUsers.length) {
        return typingUsersByChatId
    }

    if (nextUsers.length === 0) {
        const nextTypingUsersByChatId = { ...typingUsersByChatId }
        delete nextTypingUsersByChatId[chatId]
        return nextTypingUsersByChatId
    }

    return {
        ...typingUsersByChatId,
        [chatId]: nextUsers,
    }
}

const readPersistedActiveChat = (): PersistedActiveChat | null => {
    if (typeof window === 'undefined') return null

    const rawValue = sessionStorage.getItem(ACTIVE_CHAT_STORAGE_KEY)
    if (!rawValue) return null

    try {
        const parsed = JSON.parse(rawValue) as PersistedActiveChat
        if (!parsed?.id || !parsed?.type || !parsed?.userId) {
            return null
        }
        if (parsed.type !== 'channel' && parsed.type !== 'dm') {
            return null
        }
        return parsed
    } catch {
        return null
    }
}

const persistActiveChat = ({ type, id }: Omit<PersistedActiveChat, 'userId'>) => {
    if (typeof window === 'undefined') return

    const activeUserId = useAuthStore.getState().user?.id
    if (!activeUserId) return

    sessionStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, JSON.stringify({
        type,
        id,
        userId: String(activeUserId),
    }))
}

const clearPersistedActiveChat = () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY)
}
