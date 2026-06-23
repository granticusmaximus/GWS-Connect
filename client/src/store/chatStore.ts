import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'
import axios from 'axios'
import { API_URL, SOCKET_URL } from '../config/runtime'
import { getSharedKey, decryptMessage, encryptMessage, generateGroupKey, getGroupKey, wrapGroupKeyForMember, cacheGroupKey } from '../utils/e2ee'
import type { MessageMention } from '../utils/mentions'
import { useAuthStore } from './authStore'
import { useNotificationStore, type InAppNotification } from './notificationStore'
const ACTIVE_CHAT_STORAGE_KEY = 'gws-connect.active-chat'
const TYPING_INDICATOR_TIMEOUT_MS = 3200

const typingIndicatorTimeouts = new Map<string, number>()
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
    timestamp: Date
    editedAt?: string | null
    isDeleted?: number | boolean
    deletedAt?: string | null
    fileUrl?: string | null
    fileName?: string | null
    fileType?: string | null
    mentions?: MessageMention[]
    replyToMessageId?: string | null
    threadRootMessageId?: string | null
    replyContext?: ReplyContext | null
    poll?: Poll
    reactions?: ReactionSummary[]
    isPinned?: boolean
    pinnedAt?: string | null
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
    status?: string
    unreadCount: number
    lastMessageAt: string | null
}

export interface DirectMessage {
    id: string
    userId: string
    username: string
    avatar?: string | null
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
}

export interface TypingUser {
    userId: string
    username: string
    avatar?: string | null
}

interface SharedFileItem {
    id: string
    fileUrl: string
    fileName: string
    fileType: string
    timestamp: string
    senderName: string
    senderAvatar?: string
}

interface ChatState {
    socket: Socket | null
    channels: Channel[]
    directMessages: DirectMessage[]
    groupChats: GroupChat[]
    messages: { [key: string]: Message[] }
    filesByChatId: { [key: string]: SharedFileItem[] }
    activeChannel: string | null
    activeDM: string | null
    activeGroupChat: string | null
    messageFocusTarget: MessageFocusTarget | null
    latestMessageRequest: LatestMessageRequest | null
    onlineUsers: string[]
    presenceByUserId: { [userId: string]: 'online' | 'idle' }
    typingUsersByChatId: { [key: string]: TypingUser[] }
    initSocket: (token: string) => void
    disconnectSocket: () => void
    joinChannel: (channelId: string) => void
    leaveChannel: (channelId: string) => void
    emitTypingStart: (channelId?: string, recipientId?: string, groupChatId?: string) => void
    emitTypingStop: (channelId?: string, recipientId?: string, groupChatId?: string) => void
    sendMessage: (content: string, channelId?: string, recipientId?: string, file?: File, replyToMessageId?: string | null, groupChatId?: string) => Promise<boolean>
    sendGif: (gifUrl: string, title: string, channelId?: string, recipientId?: string, replyToMessageId?: string | null, groupChatId?: string) => Promise<boolean>
    createPoll: (question: string, options: string[], channelId?: string, recipientId?: string, durationMinutes?: number, replyToMessageId?: string | null, groupChatId?: string) => Promise<boolean>
    voteOnPoll: (pollId: string, optionId: string) => Promise<boolean>
    toggleReaction: (messageId: string, reaction: string) => Promise<boolean>
    editMessage: (messageId: string, content: string) => Promise<boolean>
    deleteMessage: (messageId: string) => Promise<boolean>
    archiveMessage: (messageId: string) => Promise<boolean>
    togglePinMessage: (messageId: string) => Promise<boolean>
    loadPinnedMessages: (chatType: 'channel' | 'dm' | 'group', chatId: string) => Promise<Message[]>
    searchMessages: (chatType: 'channel' | 'dm' | 'group', chatId: string, query: string) => Promise<Message[]>
    setActiveChannel: (channelId: string | null) => void
    setActiveDM: (dmId: string | null) => void
    setActiveGroupChat: (groupChatId: string | null) => void
    loadGroupChats: () => Promise<void>
    createGroupChat: (name: string, memberIds: string[]) => Promise<GroupChat | null>
    loadGroupChatMessages: (groupChatId: string) => Promise<void>
    leaveGroupChat: (groupChatId: string) => Promise<boolean>
    setMessageFocusTarget: (target: MessageFocusTarget | null) => void
    clearMessageFocusTarget: () => void
    requestLatestMessageView: (chatType: 'channel' | 'dm' | 'group', chatId: string) => void
    clearLatestMessageRequest: () => void
    restoreActiveChat: (userId: string) => void
    loadChannels: () => Promise<void>
    loadDirectConversations: () => Promise<void>
    loadChannelMessages: (channelId: string) => Promise<void>
    loadDirectMessages: (userId: string) => Promise<void>
    loadMessageById: (messageId: string) => Promise<Message | null>
    loadChannelFiles: (channelId: string) => Promise<void>
    loadDirectFiles: (userId: string) => Promise<void>
    upsertDirectConversation: (conversation: Partial<DirectMessage> & { id: string }) => void
    markConversationVisited: (chatType: 'channel' | 'dm' | 'group', chatId: string) => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
    socket: null,
    channels: [],
    directMessages: [],
    groupChats: [],
    messages: {},
    filesByChatId: {},
    activeChannel: null,
    activeDM: null,
    activeGroupChat: null,
    messageFocusTarget: null,
    latestMessageRequest: null,
    onlineUsers: [],
    presenceByUserId: {},
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

        socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error)
        })

        socket.on('disconnect', (reason) => {
            console.warn('Socket disconnected:', reason)
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
                const formData = new FormData()
                formData.append('file', file)
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

            if (recipientId) {
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

    searchMessages: async (chatType, chatId, query) => {
        try {
            const token = localStorage.getItem('token')
            const param = chatType === 'channel'
                ? `channelId=${chatId}`
                : chatType === 'group'
                    ? `groupChatId=${chatId}`
                    : `recipientId=${chatId}`
            const response = await axios.get(`${API_URL}/messages/search?q=${encodeURIComponent(query)}&${param}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            return await Promise.all(
                response.data.map((message: Message) => processIncomingMessage(message))
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
            const response = await axios.get(`${API_URL}/channels`)
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
                return
            }

            set({ channels: normalized })
        } catch (error) {
            console.error('Error loading channels:', error)
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

    loadGroupChats: async () => {
        try {
            const response = await axios.get(`${API_URL}/group-chats`)
            set({ groupChats: response.data.map(normalizeGroupChat) })
        } catch (error) {
            console.error('Error loading group chats:', error)
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
            cacheGroupKey(groupChat.id, groupKey)

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
            const groupKey = await getGroupKey(String(normalizedMessage.groupChatId), e2eePrivateKey)
            const content = await decryptMessage(normalizedMessage.cipherText, normalizedMessage.cipherIv, groupKey)
            return { ...normalizedMessage, content }
        } catch (error) {
            console.error('E2EE group decrypt failed:', error)
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

const normalizeDirectConversation = (
    conversation: Partial<DirectMessage> & { id: string },
): DirectMessage => {
    const id = String(conversation.id ?? conversation.userId)

    return {
        id,
        userId: String(conversation.userId ?? id),
        username: conversation.username || 'Direct Message',
        avatar: conversation.avatar || null,
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
