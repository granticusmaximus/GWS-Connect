import { useEffect, useLayoutEffect, useRef, useMemo, useState, Fragment, useCallback, type ComponentType, type MouseEvent, type SVGProps } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useChatStore, type Message as ChatMessage, type ReplyContext } from '../store/chatStore'
import { useCallStore } from '../store/callStore'
import { usePreferencesStore } from '../store/preferencesStore'
import { API_URL } from '../config/runtime'
import { formatDate, formatTime } from '../utils/dateFormat'
import { parseMentions, type MessageMention } from '../utils/mentions'
import { getReplyPreviewText, getThreadKey } from '../utils/replies'
import { useAuthStore } from '../store/authStore'
import MessageInput from './MessageInput'
import ChannelModal from './ChannelModal'
import InviteModal from './InviteModal'
import PollCard from './PollCard'
import ChatFilesPanel from './ChatFilesPanel'
import DocumentPreview from './DocumentPreview'
import { 
  ClockIcon,
  ExclamationTriangleIcon,
  FaceFrownIcon,
  FaceSmileIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
  HeartIcon,
  PaperClipIcon,
  HashtagIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  PhoneIcon,
  VideoCameraIcon,
  UserGroupIcon,
  UserPlusIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'

type OutlineIcon = ComponentType<SVGProps<SVGSVGElement>>

interface HoverProfileCard {
  userId: string
  username: string
  avatar?: string
  top: number
  left: number
}

interface MentionLinkTarget {
  userId?: string
  username: string
  avatar?: string | null
}

interface ChannelMember {
  id: string
  username: string
  avatar?: string | null
  email?: string
  role?: string
}

type ReplyPreviewData = ChatMessage | ReplyContext

const PROFILE_CARD_WIDTH = 256
const PROFILE_CARD_ESTIMATED_HEIGHT = 216
const PROFILE_CARD_OPEN_DELAY_MS = 450
const PROFILE_CARD_CLOSE_DELAY_MS = 140

const reactionIconMap: Record<string, OutlineIcon> = {
  like: HandThumbUpIcon,
  love: HeartIcon,
  dislike: HandThumbDownIcon,
  happy: FaceSmileIcon,
  sad: FaceFrownIcon,
  mad: ExclamationTriangleIcon,
}

const normalizeChannelMember = (member: ChannelMember): ChannelMember => ({
  ...member,
  id: String(member.id),
  avatar: member.avatar || null,
})

const getRequestErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || error.message || fallback
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

// Component to render message with mentions as links
function RenderMessage({
  content,
  isOwn,
  mentions = [],
  onMentionClick,
  onMentionHoverStart,
  onMentionHoverEnd,
}: {
  content: string
  isOwn: boolean
  mentions?: MessageMention[]
  onMentionClick: (mention: MentionLinkTarget) => void
  onMentionHoverStart?: (event: MouseEvent<HTMLButtonElement>, mention: MentionLinkTarget) => void
  onMentionHoverEnd?: () => void
}) {
  const parts = parseMentions(content, mentions)
  
  return (
    <span>
      {parts.map((part, index) => {
        if (part.type === 'mention') {
          const mentionUsername = part.username || part.content.replace(/^@/, '')

          return (
            <button
              type="button"
              key={index}
              onClick={() =>
                onMentionClick({
                  userId: part.userId,
                  username: mentionUsername,
                  avatar: part.avatar,
                })
              }
              onMouseEnter={
                part.userId && onMentionHoverStart
                  ? (event) =>
                    onMentionHoverStart(event, {
                      userId: part.userId,
                      username: mentionUsername,
                      avatar: part.avatar,
                    })
                  : undefined
              }
              onMouseLeave={part.userId && onMentionHoverEnd ? onMentionHoverEnd : undefined}
              className={`font-semibold hover:underline cursor-pointer ${
                isOwn ? 'text-blue-200 hover:text-blue-100' : 'text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300'
              }`}
            >
              {part.content}
            </button>
          )
        }
        return <span key={index}>{part.content}</span>
      })}
    </span>
  )
}

function ReplyPreviewCard({
  reply,
  isOwn,
  onClick,
}: {
  reply: ReplyPreviewData
  isOwn: boolean
  onClick?: () => void
}) {
  const labelStyles = isOwn
    ? 'text-blue-100'
    : 'text-primary-700 dark:text-primary-300'
  const previewStyles = isOwn
    ? 'text-blue-50/90'
    : 'text-gray-600 dark:text-gray-300'
  const containerStyles = isOwn
    ? 'border-l-blue-200/80 bg-white/10 hover:bg-white/15'
    : 'border-l-primary-400/80 bg-primary-50/80 hover:bg-primary-100 dark:bg-gray-900/50 dark:hover:bg-gray-900/70'

  const content = (
    <div className={`mb-3 rounded-lg border-l-2 px-3 py-2 text-left transition-colors ${containerStyles}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${labelStyles}`}>
        Replying to {reply.senderName}
      </div>
      <div className={`mt-1 truncate text-xs ${previewStyles}`}>
        {getReplyPreviewText(reply)}
      </div>
    </div>
  )

  if (!onClick) {
    return content
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full"
    >
      {content}
    </button>
  )
}

export default function ChatWindow() {
  const navigate = useNavigate()
  const { 
    socket,
    activeChannel,
    channels,
    directMessages,
    groupChats,
    messages,
    activeDM,
    activeGroupChat,
    readReceiptsByChatId,
    dmDisappearingSecondsByPeerId,
    loadDmDisappearingSeconds,
    setDmDisappearing,
    setGroupChatDisappearing,
    messageFocusTarget,
    latestMessageRequest,
    clearMessageFocusTarget,
    clearLatestMessageRequest,
    loadChannels,
    loadChannelMessages,
    loadDirectMessages,
    loadGroupChatMessages,
    leaveGroupChat,
    loadChannelFiles,
    loadDirectFiles,
    filesByChatId,
    sendMessage,
    toggleReaction,
    editMessage,
    deleteMessage,
    archiveMessage,
    togglePinMessage,
    loadPinnedMessages,
    markConversationVisited,
  } = useChatStore()
  const { activeCallId, isConnecting, startCall } = useCallStore()
  const user = useAuthStore((state) => state.user)
  const authToken = useAuthStore((state) => state.token) || localStorage.getItem('token')
  const timeFormat = usePreferencesStore((state) => state.timeFormat)
  const dateFormat = usePreferencesStore((state) => state.dateFormat)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showDisappearingMenu, setShowDisappearingMenu] = useState(false)
  const [activeTab, setActiveTab] = useState<'messages' | 'files' | 'members' | 'pinned'>('messages')
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([])
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingName, setPendingName] = useState('')
  const [pendingMessage, setPendingMessage] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [openReactionMessageId, setOpenReactionMessageId] = useState<string | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [hoverProfileCard, setHoverProfileCard] = useState<HoverProfileCard | null>(null)
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState('')
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const [memberSearchResults, setMemberSearchResults] = useState<ChannelMember[]>([])
  const [memberSearchLoading, setMemberSearchLoading] = useState(false)
  const [memberMutationUserId, setMemberMutationUserId] = useState<string | null>(null)
  const [mediaViewer, setMediaViewer] = useState<{
    url: string
    type: 'image' | 'video' | 'document'
    name?: string
    mime?: string
  } | null>(null)
  const profileCardOpenTimeoutRef = useRef<number | null>(null)
  const profileCardCloseTimeoutRef = useRef<number | null>(null)
  const highlightTimeoutRef = useRef<number | null>(null)
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const currentChatId = activeChannel || activeDM || activeGroupChat
  const currentChatType = activeChannel ? 'channel' : activeDM ? 'dm' : activeGroupChat ? 'group' : null
  const currentMessages = useMemo(() => 
    currentChatId ? messages[currentChatId] || [] : [],
    [currentChatId, messages]
  )
  const currentMessagesById = useMemo(
    () => new Map(currentMessages.map((message) => [message.id, message])),
    [currentMessages],
  )
  const replyTargetMessage = useMemo(
    () => (replyTargetId ? currentMessagesById.get(replyTargetId) || null : null),
    [replyTargetId, currentMessagesById],
  )

  const currentChannel = useMemo(() => 
    channels.find(ch => ch.id === activeChannel),
    [channels, activeChannel]
  )
  const currentDirectConversation = useMemo(
    () =>
      directMessages.find(
        (conversation) =>
          conversation.userId === activeDM || conversation.id === activeDM,
      ) || null,
    [activeDM, directMessages],
  )
  const currentGroupChat = useMemo(
    () => groupChats.find((group) => group.id === activeGroupChat) || null,
    [activeGroupChat, groupChats],
  )

  const seenIndicatorText = useMemo(() => {
    if (currentChatType !== 'dm' && currentChatType !== 'group') {
      return null
    }
    if (!currentChatId || !user) {
      return null
    }

    const lastOwnMessage = [...currentMessages]
      .reverse()
      .find((message) => message.senderId === String(user.id) && !message.isDeleted)
    if (!lastOwnMessage) {
      return null
    }

    const receipts = readReceiptsByChatId[currentChatId] || {}
    const lastOwnTimestamp = new Date(lastOwnMessage.timestamp).getTime()

    if (currentChatType === 'dm') {
      const peerLastVisited = receipts[currentChatId]
      if (peerLastVisited && new Date(peerLastVisited).getTime() >= lastOwnTimestamp) {
        return 'Seen'
      }
      return null
    }

    const seenByMembers = (currentGroupChat?.members || [])
      .filter((member) => member.id !== String(user.id))
      .filter((member) => {
        const lastVisited = receipts[member.id]
        return lastVisited && new Date(lastVisited).getTime() >= lastOwnTimestamp
      })

    if (seenByMembers.length === 0) {
      return null
    }
    if (seenByMembers.length <= 2) {
      return `Seen by ${seenByMembers.map((member) => member.username).join(', ')}`
    }
    return `Seen by ${seenByMembers.length} members`
  }, [currentChatType, currentChatId, currentMessages, user, readReceiptsByChatId, currentGroupChat])

  const reactionOptions = useMemo(() => [
    { type: 'like', icon: HandThumbUpIcon, label: 'Like' },
    { type: 'love', icon: HeartIcon, label: 'Love' },
    { type: 'dislike', icon: HandThumbDownIcon, label: 'Dislike' },
    { type: 'happy', icon: FaceSmileIcon, label: 'Happy' },
    { type: 'sad', icon: FaceFrownIcon, label: 'Sad' },
    { type: 'mad', icon: ExclamationTriangleIcon, label: 'Mad' },
  ], [])

  // Check if user can edit channel (admin or manager of this channel)
  const canEditChannel = useMemo(() => {
    if (!activeChannel || !user) return false
    return user.role === 'admin' || user.role === 'manager'
  }, [activeChannel, user])
  const canManageChannelMembers = canEditChannel
  const canAddChannelMembers = Boolean(
    canManageChannelMembers && activeChannel && currentChannel?.isPrivate,
  )
  const currentChannelMemberIds = useMemo(
    () => new Set(channelMembers.map((member) => String(member.id))),
    [channelMembers],
  )

  const authHeaders = useMemo(
    () =>
      authToken
        ? {
            Authorization: `Bearer ${authToken}`,
          }
        : undefined,
    [authToken],
  )

  const loadActiveChannelMembers = useCallback(async (channelId: string) => {
    setMembersLoading(true)
    setMembersError('')

    try {
      const response = await axios.get(`${API_URL}/channels/${channelId}/members`, {
        headers: authHeaders,
      })
      setChannelMembers(
        Array.isArray(response.data)
          ? response.data.map((member: ChannelMember) => normalizeChannelMember(member))
          : [],
      )
    } catch (error) {
      setMembersError(getRequestErrorMessage(error, 'Unable to load channel members'))
      setChannelMembers([])
    } finally {
      setMembersLoading(false)
    }
  }, [authHeaders])

  // Load historical messages when channel changes
  useEffect(() => {
    if (activeChannel) {
      loadChannelMessages(activeChannel)
      void loadActiveChannelMembers(activeChannel)
    }
  }, [activeChannel, loadActiveChannelMembers, loadChannelMessages])

  useEffect(() => {
    if (activeDM) {
      loadDirectMessages(activeDM)
      void loadDmDisappearingSeconds(activeDM)
    }
  }, [activeDM, loadDirectMessages, loadDmDisappearingSeconds])

  useEffect(() => {
    if (activeGroupChat) {
      loadGroupChatMessages(activeGroupChat)
    }
  }, [activeGroupChat, loadGroupChatMessages])

  useEffect(() => {
    if (!activeChannel && activeTab === 'members') {
      setActiveTab('messages')
    }
  }, [activeChannel, activeTab])

  useEffect(() => {
    setChannelMembers([])
    setMembersError('')
    setMemberSearchQuery('')
    setMemberSearchResults([])
  }, [activeChannel])

  useEffect(() => {
    if (activeTab !== 'files') return
    if (activeChannel) {
      loadChannelFiles(activeChannel)
    } else if (activeDM) {
      loadDirectFiles(activeDM)
    }
  }, [activeTab, activeChannel, activeDM, loadChannelFiles, loadDirectFiles])

  useEffect(() => {
    if (activeTab !== 'members' || !activeChannel) return
    void loadActiveChannelMembers(activeChannel)
  }, [activeChannel, activeTab, loadActiveChannelMembers])

  useEffect(() => {
    if (activeTab !== 'pinned') return
    if (activeChannel) {
      void loadPinnedMessages('channel', activeChannel).then(setPinnedMessages)
    } else if (activeGroupChat) {
      void loadPinnedMessages('group', activeGroupChat).then(setPinnedMessages)
    } else if (activeDM) {
      void loadPinnedMessages('dm', activeDM).then(setPinnedMessages)
    }
  }, [activeTab, activeChannel, activeGroupChat, activeDM, loadPinnedMessages])

  useEffect(() => {
    if (!socket) return

    const handleMembersUpdated = (payload: {
      channelId?: string
      members?: ChannelMember[]
    }) => {
      if (!activeChannel || String(payload.channelId) !== String(activeChannel)) {
        return
      }

      setChannelMembers(
        Array.isArray(payload.members)
          ? payload.members.map((member) => normalizeChannelMember(member))
          : [],
      )
      setMembersError('')
    }

    socket.on('channel-members-updated', handleMembersUpdated)
    return () => {
      socket.off('channel-members-updated', handleMembersUpdated)
    }
  }, [activeChannel, socket])

  useEffect(() => {
    if (!canAddChannelMembers) {
      setMemberSearchLoading(false)
      setMemberSearchResults([])
      return
    }

    const query = memberSearchQuery.trim()
    if (!query) {
      setMemberSearchResults([])
      return
    }

    const timeoutId = window.setTimeout(async () => {
      setMemberSearchLoading(true)
      try {
        const response = await axios.get(`${API_URL}/users/search?q=${encodeURIComponent(query)}`, {
          headers: authHeaders,
        })
        const results = Array.isArray(response.data) ? response.data : []
        setMemberSearchResults(
          results
            .map((member: ChannelMember) => normalizeChannelMember(member))
            .filter((member) =>
              String(member.id) !== String(user?.id) &&
              !currentChannelMemberIds.has(String(member.id)),
            ),
        )
      } catch (error) {
        setMembersError(getRequestErrorMessage(error, 'Unable to search users'))
        setMemberSearchResults([])
      } finally {
        setMemberSearchLoading(false)
      }
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    authHeaders,
    canAddChannelMembers,
    currentChannelMemberIds,
    memberSearchQuery,
    user?.id,
  ])

  const snapToLatestMessage = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = messagesContainerRef.current
        if (container) {
          container.scrollTop = container.scrollHeight
        }
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      })
    })
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = messagesContainerRef.current
    if (container && behavior === 'auto') {
      container.scrollTop = container.scrollHeight
      return
    }

    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [])

  const previousMessageCountRef = useRef(0)
  const previousChatIdRef = useRef<string | null>(null)

  const isSameDay = useCallback((a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(),
  [])

  const isToday = useCallback((value: Date) => isSameDay(value, new Date()), [isSameDay])

  const allMessagesToday = useMemo(
    () => currentMessages.length > 0 && currentMessages.every((msg) => isToday(new Date(msg.timestamp))),
    [currentMessages, isToday]
  )

  const formatMessageTimestamp = (currentTimestamp: Date) => {
    const timeLabel = formatTime(currentTimestamp, timeFormat)
    if (allMessagesToday || isToday(currentTimestamp)) {
      return timeLabel
    }

    const dateLabel = formatDate(currentTimestamp, dateFormat)
    return `${dateLabel} ${timeLabel}`
  }

  const clearHighlightTimer = useCallback(() => {
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current)
      highlightTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    const currentCount = currentMessages.length
    const isNewChat = previousChatIdRef.current !== currentChatId
    const hasNewMessage = currentCount > previousMessageCountRef.current

    if (isNewChat) {
      snapToLatestMessage()
    } else if (hasNewMessage) {
      scrollToBottom('smooth')
    }

    previousMessageCountRef.current = currentCount
    previousChatIdRef.current = currentChatId
  }, [currentMessages.length, currentChatId, scrollToBottom, snapToLatestMessage])

  useEffect(() => {
    if (activeTab !== 'messages') return
    snapToLatestMessage()
  }, [activeTab, currentChatId, snapToLatestMessage])

  useEffect(() => {
    if (!latestMessageRequest || !currentChatId || !currentChatType) return
    if (latestMessageRequest.chatId !== currentChatId) return
    if (latestMessageRequest.chatType !== currentChatType) return

    if (activeTab !== 'messages') {
      setActiveTab('messages')
      return
    }

    snapToLatestMessage()
    clearLatestMessageRequest()
  }, [
    activeTab,
    clearLatestMessageRequest,
    currentChatId,
    currentChatType,
    latestMessageRequest,
    snapToLatestMessage,
  ])

  useLayoutEffect(() => {
    if (activeTab !== 'messages') return
    if (!currentChatId) return

    snapToLatestMessage()
  }, [activeTab, currentChatId, snapToLatestMessage])

  useEffect(() => {
    setReplyTargetId(null)
    setHighlightedMessageId(null)
    clearHighlightTimer()
  }, [currentChatId, clearHighlightTimer])

  useEffect(() => {
    if (!currentChatId || activeTab !== 'messages') return

    const handleWindowFocus = () => {
      if (!currentChatType) return
      void markConversationVisited(currentChatType, currentChatId)
    }

    window.addEventListener('focus', handleWindowFocus)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [activeTab, currentChatId, currentChatType, markConversationVisited])

  useEffect(() => {
    if (!replyTargetId) return
    if (currentMessagesById.has(replyTargetId)) return
    setReplyTargetId(null)
  }, [replyTargetId, currentMessagesById])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (!currentChatId) return
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0]
        setPendingFile(file)
        setPendingName(file.name)
        setPendingMessage('')
      }
    },
    accept: {
      'image/*': [],
      'video/*': [],
      'application/pdf': [],
      'application/msword': [],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [],
      'application/vnd.ms-excel': [],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [],
      'text/plain': [],
    },
    multiple: false,
    noClick: true,
    noKeyboard: true,
    preventDropOnDocument: true,
  })

  useEffect(() => {
    const isPreviewable = pendingFile && 
      (pendingFile.type.startsWith('image/') || pendingFile.type.startsWith('video/'))
    
    if (!isPreviewable) {
      if (previewUrl) {
        setPreviewUrl(null)
      }
      return
    }

    const url = URL.createObjectURL(pendingFile)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [pendingFile, previewUrl])

  const resetPendingUpload = () => {
    setPendingFile(null)
    setPendingName('')
    setPendingMessage('')
  }

  const handleSendUpload = async () => {
    if (!pendingFile) return
    const trimmedName = pendingName.trim()
    const fileToSend = trimmedName && trimmedName !== pendingFile.name
      ? new File([pendingFile], trimmedName, { type: pendingFile.type })
      : pendingFile
    const sent = await sendMessage(
      pendingMessage,
      activeChannel || undefined,
      activeDM || undefined,
      fileToSend,
      replyTargetMessage?.id,
      activeGroupChat || undefined,
    )
    if (sent) {
      resetPendingUpload()
      setReplyTargetId(null)
    }
  }

  const buildMessageFileUrl = useCallback((fileUrl?: string | null) => {
    if (!fileUrl) return ''
    const needsAuth = fileUrl.startsWith('/api/messages/file/')
    const joiner = fileUrl.includes('?') ? '&' : '?'
    return needsAuth && authToken
      ? `${fileUrl}${joiner}token=${encodeURIComponent(authToken)}`
      : fileUrl
  }, [authToken])

  const jumpToMessage = useCallback((messageId?: string | null) => {
    if (!messageId) return

    const targetNode = messageRefs.current[messageId]
    if (!targetNode) return

    targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    clearHighlightTimer()
    setHighlightedMessageId(messageId)
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current))
      highlightTimeoutRef.current = null
    }, 2200)
  }, [clearHighlightTimer])

  useEffect(() => {
    if (!messageFocusTarget) return
    if (messageFocusTarget.chatId !== currentChatId) return
    if (!currentMessagesById.has(messageFocusTarget.messageId)) return

    jumpToMessage(messageFocusTarget.messageId)
    clearMessageFocusTarget()
  }, [
    clearMessageFocusTarget,
    currentChatId,
    currentMessagesById,
    jumpToMessage,
    messageFocusTarget,
  ])

  const resolveReplyReference = useCallback((message: ChatMessage) => {
    if (!message.replyToMessageId) return null
    return currentMessagesById.get(message.replyToMessageId) || message.replyContext || null
  }, [currentMessagesById])

  const clearProfileCardOpenTimer = useCallback(() => {
    if (profileCardOpenTimeoutRef.current !== null) {
      window.clearTimeout(profileCardOpenTimeoutRef.current)
      profileCardOpenTimeoutRef.current = null
    }
  }, [])

  const clearProfileCardCloseTimer = useCallback(() => {
    if (profileCardCloseTimeoutRef.current !== null) {
      window.clearTimeout(profileCardCloseTimeoutRef.current)
      profileCardCloseTimeoutRef.current = null
    }
  }, [])

  const scheduleProfileCardClose = useCallback((delay = PROFILE_CARD_CLOSE_DELAY_MS) => {
    clearProfileCardCloseTimer()
    profileCardCloseTimeoutRef.current = window.setTimeout(() => {
      setHoverProfileCard(null)
      profileCardCloseTimeoutRef.current = null
    }, delay)
  }, [clearProfileCardCloseTimer])

  const handleAvatarHoverStart = useCallback((
    event: MouseEvent<HTMLElement>,
    messageUserId: string,
    messageUsername: string,
    messageAvatar?: string,
  ) => {
    clearProfileCardCloseTimer()
    clearProfileCardOpenTimer()

    const anchor = event.currentTarget
    profileCardOpenTimeoutRef.current = window.setTimeout(() => {
      const rect = anchor.getBoundingClientRect()
      const viewportPadding = 12
      const clampedLeft = Math.min(
        Math.max(rect.left, viewportPadding),
        Math.max(viewportPadding, window.innerWidth - PROFILE_CARD_WIDTH - viewportPadding),
      )

      const preferredTop = rect.bottom + 8
      const shouldFlip = preferredTop + PROFILE_CARD_ESTIMATED_HEIGHT > window.innerHeight - viewportPadding
      const nextTop = shouldFlip
        ? Math.max(viewportPadding, rect.top - PROFILE_CARD_ESTIMATED_HEIGHT - 8)
        : preferredTop

      setHoverProfileCard({
        userId: messageUserId,
        username: messageUsername,
        avatar: messageAvatar,
        top: nextTop,
        left: clampedLeft,
      })

      profileCardOpenTimeoutRef.current = null
    }, PROFILE_CARD_OPEN_DELAY_MS)
  }, [clearProfileCardCloseTimer, clearProfileCardOpenTimer])

  const handleAvatarHoverEnd = useCallback(() => {
    clearProfileCardOpenTimer()
    scheduleProfileCardClose()
  }, [clearProfileCardOpenTimer, scheduleProfileCardClose])

  const handleProfileCardMouseEnter = useCallback(() => {
    clearProfileCardCloseTimer()
  }, [clearProfileCardCloseTimer])

  const handleProfileCardMouseLeave = useCallback(() => {
    scheduleProfileCardClose(0)
  }, [scheduleProfileCardClose])

  const handleMentionClick = useCallback((mention: MentionLinkTarget) => {
    if (mention.userId) {
      navigate(`/profile/${mention.userId}`)
      return
    }

    navigate(`/profile/u/${encodeURIComponent(mention.username)}`)
  }, [navigate])

  const handleReplyMessage = useCallback((messageId: string) => {
    setReplyTargetId(messageId)
    requestAnimationFrame(() => scrollToBottom('smooth'))
  }, [scrollToBottom])

  const handleViewProfile = useCallback(() => {
    if (!hoverProfileCard) return
    setHoverProfileCard(null)
    navigate(`/profile/${hoverProfileCard.userId}`)
  }, [hoverProfileCard, navigate])

  useEffect(() => {
    setHoverProfileCard(null)
    clearProfileCardOpenTimer()
    clearProfileCardCloseTimer()
  }, [currentChatId, activeTab, clearProfileCardOpenTimer, clearProfileCardCloseTimer])

  useEffect(() => () => {
    clearProfileCardOpenTimer()
    clearProfileCardCloseTimer()
    clearHighlightTimer()
  }, [clearProfileCardOpenTimer, clearProfileCardCloseTimer, clearHighlightTimer])

  const handleAddChannelMember = useCallback(async (member: ChannelMember) => {
    if (!activeChannel) return

    setMemberMutationUserId(member.id)
    setMembersError('')

    try {
      await axios.post(
        `${API_URL}/manager/${activeChannel}/members`,
        { userId: member.id },
        { headers: authHeaders },
      )
      await loadActiveChannelMembers(activeChannel)
      setMemberSearchQuery('')
      setMemberSearchResults([])
    } catch (error) {
      setMembersError(getRequestErrorMessage(error, 'Unable to add channel member'))
    } finally {
      setMemberMutationUserId(null)
    }
  }, [activeChannel, authHeaders, loadActiveChannelMembers])

  const handleRemoveChannelMember = useCallback(async (member: ChannelMember) => {
    if (!activeChannel) return

    setMemberMutationUserId(member.id)
    setMembersError('')

    try {
      await axios.delete(`${API_URL}/manager/${activeChannel}/members/${member.id}`, {
        headers: authHeaders,
      })
      await loadActiveChannelMembers(activeChannel)
    } catch (error) {
      setMembersError(getRequestErrorMessage(error, 'Unable to remove channel member'))
    } finally {
      setMemberMutationUserId(null)
    }
  }, [activeChannel, authHeaders, loadActiveChannelMembers])

  const renderConversationFilesPanel = (layout: 'default' | 'sidebar' = 'default') => (
    <div className={layout === 'sidebar' ? 'flex-1 min-h-0 overflow-hidden bg-[#2b2d31]' : 'flex-1 overflow-hidden'}>
      <ChatFilesPanel
        files={filesByChatId[currentChatId || ''] || []}
        authToken={authToken}
        onOpenMedia={(payload) => setMediaViewer(payload)}
        onOpenDocument={(payload) => setMediaViewer(payload)}
      />
    </div>
  )

  const renderConversationMessagesPanel = (layout: 'default' | 'sidebar' = 'default') => {
    const isSidebarLayout = layout === 'sidebar'
    const listClassName = isSidebarLayout
      ? 'flex-1 min-h-0 overflow-y-auto bg-[#2b2d31] p-3 space-y-4'
      : 'flex-1 overflow-y-auto p-4 sm:p-6 space-y-4'
    const emptyStateClassName = isSidebarLayout
      ? 'mt-8 text-center text-gray-400'
      : 'mt-8 text-center text-gray-500 dark:text-gray-400'
    const rowWidthClassName = isSidebarLayout ? 'max-w-full' : 'max-w-2xl'
    const bubbleWidthClassName = isSidebarLayout ? 'max-w-full' : 'max-w-xl'
    const mediaWidthClassName = isSidebarLayout ? 'max-w-full' : 'max-w-md'

    return (
      <div
        ref={messagesContainerRef}
        className={listClassName}
      >
        {currentMessages.length === 0 ? (
          <div className={emptyStateClassName}>
            No messages yet. Start the conversation!
          </div>
        ) : (
          currentMessages.map((message, index) => {
            const isOwn = String(message.senderId) === String(user?.id)
            const hasContent = Boolean(message.content?.trim())
            const hasFile = Boolean(message.fileUrl)
            const isDeleted = Boolean(message.isDeleted)
            const isEditing = editingMessageId === message.id
            const isPoll = Boolean(message.poll)
            const replyReference = resolveReplyReference(message)
            const threadKey = getThreadKey(message.threadRootMessageId)
            const previousThreadKey = getThreadKey(currentMessages[index - 1]?.threadRootMessageId)
            const nextThreadKey = getThreadKey(currentMessages[index + 1]?.threadRootMessageId)
            const threadContinuesFromPrev = Boolean(threadKey && previousThreadKey === threadKey)
            const threadContinuesToNext = Boolean(threadKey && nextThreadKey === threadKey)

            const shouldShowBubble =
              isDeleted || isEditing || isPoll || hasContent || hasFile || Boolean(replyReference)

            return (
              <div
                key={message.id}
                ref={(node) => {
                  messageRefs.current[message.id] = node
                }}
                className={`group flex rounded-2xl transition ${isOwn ? 'justify-end' : 'justify-start'} ${
                  highlightedMessageId === message.id
                    ? 'bg-primary-100/80 ring-2 ring-primary-300 dark:bg-primary-900/20 dark:ring-primary-700'
                    : ''
                }`}
                onMouseEnter={() => setHoveredMessageId(message.id)}
                onMouseLeave={() => {
                  setHoveredMessageId((current) => (current === message.id ? null : current))
                  setOpenReactionMessageId((current) => (current === message.id ? null : current))
                }}
              >
                <div className={`flex w-full ${rowWidthClassName} gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  {!isOwn && threadKey && (
                    <div className="relative flex w-4 flex-shrink-0 justify-center">
                      {threadContinuesFromPrev && (
                        <div className="absolute bottom-1/2 top-0 w-px bg-primary-300 dark:bg-primary-700" />
                      )}
                      {threadContinuesToNext && (
                        <div className="absolute bottom-0 top-1/2 w-px bg-primary-300 dark:bg-primary-700" />
                      )}
                      <div className="mt-7 h-2.5 w-2.5 rounded-full bg-primary-400 dark:bg-primary-500" />
                    </div>
                  )}
                  <div className={`flex w-full flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-center gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                      <div
                        className={`h-9 w-9 flex-shrink-0 overflow-hidden rounded-full ${
                          !isOwn ? 'cursor-pointer' : ''
                        }`}
                        onMouseEnter={
                          !isOwn
                            ? (event) => handleAvatarHoverStart(
                              event,
                              String(message.senderId),
                              message.senderName,
                              message.senderAvatar || undefined,
                            )
                            : undefined
                        }
                        onMouseLeave={!isOwn ? handleAvatarHoverEnd : undefined}
                      >
                        {message.senderAvatar ? (
                          <img src={message.senderAvatar} alt={message.senderName} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-primary-500 font-semibold text-white">
                            {message.senderName[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className={`flex items-baseline gap-2 ${isOwn ? 'flex-row-reverse text-right' : ''}`}>
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {message.senderName}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatMessageTimestamp(new Date(message.timestamp))}
                        </span>
                      </div>
                      {isOwn && !isDeleted && (
                        <div className="ml-auto flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMessageId(message.id)
                              setEditContent(message.content)
                            }}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm('Delete this message?')) {
                                void deleteMessage(message.id)
                              }
                            }}
                            className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm('Archive this message?')) {
                                void archiveMessage(message.id)
                              }
                            }}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                          >
                            Archive
                          </button>
                        </div>
                      )}
                    </div>

                    {shouldShowBubble && (
                      <div className={`mt-1 w-full ${bubbleWidthClassName} min-w-0 overflow-hidden rounded-2xl px-4 py-3 shadow-sm ${
                        isOwn
                          ? 'rounded-br-md bg-blue-600 text-white'
                          : 'rounded-bl-md bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                      } ${!replyReference && !hasContent && !isEditing && !isPoll && !isDeleted ? 'hidden' : ''}`}
                      >
                        {replyReference && (
                          <ReplyPreviewCard
                            reply={replyReference}
                            isOwn={isOwn}
                            onClick={
                              message.replyToMessageId
                                ? () => jumpToMessage(message.replyToMessageId)
                                : undefined
                            }
                          />
                        )}
                        {isDeleted ? (
                          <p className={`italic ${isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                            Message deleted
                          </p>
                        ) : isEditing ? (
                          <div className="space-y-2">
                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              rows={2}
                              className="w-full rounded-lg bg-white/70 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-900/60 dark:text-white"
                              aria-label="Edit message"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  const trimmed = editContent.trim()
                                  if (!trimmed) return
                                  const ok = await editMessage(message.id, trimmed)
                                  if (ok) {
                                    setEditingMessageId(null)
                                  }
                                }}
                                className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs text-white hover:bg-primary-700"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingMessageId(null)}
                                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : isPoll && message.poll ? (
                          <PollCard poll={message.poll} />
                        ) : (
                          <Fragment>
                            {hasContent && (
                              <p className={`${isOwn ? 'text-white' : 'text-gray-800 dark:text-gray-200'} whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>
                                <RenderMessage
                                  content={message.content}
                                  isOwn={isOwn}
                                  mentions={message.mentions}
                                  onMentionClick={handleMentionClick}
                                  onMentionHoverStart={
                                    !isOwn
                                      ? (event, mention) => {
                                        if (!mention.userId) return
                                        handleAvatarHoverStart(
                                          event,
                                          mention.userId,
                                          mention.username,
                                          mention.avatar || undefined,
                                        )
                                      }
                                      : undefined
                                  }
                                  onMentionHoverEnd={!isOwn ? handleAvatarHoverEnd : undefined}
                                />
                              </p>
                            )}
                            {message.editedAt && (
                              <div className={`text-xs italic ${isOwn ? 'text-blue-100' : 'text-gray-400'}`}>
                                Edited
                              </div>
                            )}
                          </Fragment>
                        )}
                      </div>
                    )}

                    {hasFile && !isDeleted && message.fileUrl && (
                      <div className="mt-2">
                        {(() => {
                          const fileUrl = buildMessageFileUrl(message.fileUrl)

                          if (message.fileType?.startsWith('image/')) {
                            return (
                              <button
                                type="button"
                                onClick={() => setMediaViewer({ url: fileUrl || '', type: 'image', name: message.fileName || 'Image' })}
                                className="block"
                                aria-label="Open image"
                              >
                                <img
                                  src={fileUrl || ''}
                                  alt={message.fileName || 'Image'}
                                  className={`${mediaWidthClassName} rounded-lg`}
                                />
                              </button>
                            )
                          }

                          if (message.fileType?.startsWith('video/')) {
                            return (
                              <button
                                type="button"
                                onClick={() => setMediaViewer({ url: fileUrl || '', type: 'video', name: message.fileName || 'Video' })}
                                className="block"
                                aria-label="Open video"
                              >
                                <video src={fileUrl || ''} className={`${mediaWidthClassName} rounded-lg`} controls />
                              </button>
                            )
                          }

                          return (
                            <button
                              type="button"
                              onClick={() =>
                                setMediaViewer({
                                  url: fileUrl || '',
                                  type: 'document',
                                  name: message.fileName || 'Document',
                                  mime: message.fileType || undefined,
                                })
                              }
                              className="break-words text-primary-600 hover:underline dark:text-primary-400 [overflow-wrap:anywhere]"
                            >
                              <span className="inline-flex items-center gap-1">
                                <PaperClipIcon className="h-4 w-4" />
                                {message.fileName || 'Document'}
                              </span>
                            </button>
                          )
                        })()}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {(message.reactions || [])
                        .filter((reaction) => reaction.count > 0)
                        .map((reaction) => {
                          const ReactionIcon = reactionIconMap[reaction.type] || FaceSmileIcon
                          return (
                            <button
                              key={`${message.id}-${reaction.type}`}
                              type="button"
                              onClick={() => toggleReaction(message.id, reaction.type)}
                              className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition ${
                                reaction.reacted
                                  ? 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-500 dark:bg-primary-900/30 dark:text-primary-200'
                                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                              }`}
                              aria-label={reaction.type}
                            >
                              <ReactionIcon className="h-3 w-3" />
                              <span>{reaction.count}</span>
                            </button>
                          )
                        })}

                      {hoveredMessageId === message.id && !isDeleted && !isEditing && (
                        <button
                          type="button"
                          onClick={() => handleReplyMessage(message.id)}
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          Reply
                        </button>
                      )}

                      {hoveredMessageId === message.id && !isDeleted && !isEditing && (
                        <button
                          type="button"
                          onClick={() => void togglePinMessage(message.id)}
                          className={`rounded-full border px-3 py-1 text-xs transition ${
                            message.isPinned
                              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-200'
                              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                          }`}
                        >
                          {message.isPinned ? 'Unpin' : 'Pin'}
                        </button>
                      )}

                      {hoveredMessageId === message.id && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenReactionMessageId((current) =>
                              current === message.id ? null : message.id
                            )
                          }
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 transition dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        >
                          React to Post
                        </button>
                      )}

                      {openReactionMessageId === message.id && (
                        <div className="flex flex-wrap gap-2">
                          {reactionOptions.map((reaction) => {
                            const entry = message.reactions?.find((item) => item.type === reaction.type)
                            const count = entry?.count || 0
                            const reacted = entry?.reacted || false
                            const ReactionIcon = reaction.icon
                            return (
                              <button
                                key={reaction.type}
                                type="button"
                                onClick={() => {
                                  toggleReaction(message.id, reaction.type)
                                  setOpenReactionMessageId(null)
                                }}
                                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition ${
                                  reacted
                                    ? 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-500 dark:bg-primary-900/30 dark:text-primary-200'
                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                                }`}
                                aria-label={reaction.label}
                              >
                                <ReactionIcon className="h-3 w-3" />
                                {count > 0 && <span>{count}</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  {isOwn && threadKey && (
                    <div className="relative flex w-4 flex-shrink-0 justify-center">
                      {threadContinuesFromPrev && (
                        <div className="absolute bottom-1/2 top-0 w-px bg-primary-300 dark:bg-primary-700" />
                      )}
                      {threadContinuesToNext && (
                        <div className="absolute bottom-0 top-1/2 w-px bg-primary-300 dark:bg-primary-700" />
                      )}
                      <div className="mt-7 h-2.5 w-2.5 rounded-full bg-primary-400 dark:bg-primary-500" />
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
        {seenIndicatorText && (
          <div className="px-4 pb-1 text-right text-xs text-gray-500 dark:text-gray-400">
            {seenIndicatorText}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    )
  }

  const renderConversationMembersPanel = (layout: 'default' | 'sidebar' = 'default') => {
    const isSidebarLayout = layout === 'sidebar'
    const containerClassName = isSidebarLayout
      ? 'flex-1 min-h-0 overflow-y-auto bg-[#2b2d31] p-4'
      : 'flex-1 overflow-y-auto p-4 sm:p-6'
    const panelClassName = isSidebarLayout
      ? 'rounded-2xl border border-white/10 bg-black/10 p-4'
      : 'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900'
    const mutedTextClassName = isSidebarLayout
      ? 'text-sm text-gray-300'
      : 'text-sm text-gray-600 dark:text-gray-300'
    const secondaryTextClassName = isSidebarLayout
      ? 'text-xs text-gray-400'
      : 'text-xs text-gray-500 dark:text-gray-400'

    return (
      <div className={containerClassName}>
        <div className={`${panelClassName} space-y-4`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <UserGroupIcon className="h-5 w-5 text-primary-500" />
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Channel Members
                </h4>
                <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
                  {channelMembers.length}
                </span>
              </div>
              <p className={mutedTextClassName}>
                {currentChannel?.isPrivate
                  ? 'Private channels only show invited members. Managers and admins can update this list.'
                  : 'Public channels show users who currently have access. Removing a user blocks their access to this channel.'}
              </p>
            </div>
          </div>

          {canAddChannelMembers && (
            <div className="rounded-2xl border border-dashed border-primary-200 bg-primary-50/70 p-4 dark:border-primary-900/40 dark:bg-primary-900/10">
              <label className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
                Add member to this private channel
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={memberSearchQuery}
                  onChange={(event) => setMemberSearchQuery(event.target.value)}
                  placeholder="Search users to add..."
                  className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
                />
              </div>
              {memberSearchLoading && (
                <p className={`${secondaryTextClassName} mt-2`}>Searching users...</p>
              )}
              {!memberSearchLoading && memberSearchQuery.trim() && memberSearchResults.length === 0 && (
                <p className={`${secondaryTextClassName} mt-2`}>
                  No eligible users found for this channel.
                </p>
              )}
              {memberSearchResults.length > 0 && (
                <div className="mt-3 space-y-2">
                  {memberSearchResults.map((member) => (
                    <div
                      key={member.id}
                      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-10 w-10 overflow-hidden rounded-full bg-primary-500 text-white">
                          {member.avatar ? (
                            <img
                              src={member.avatar}
                              alt={member.username}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                              {member.username.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-900 dark:text-white">
                            {member.username}
                          </div>
                          <div className={secondaryTextClassName}>
                            {member.email || 'Workspace user'}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleAddChannelMember(member)}
                        disabled={memberMutationUserId === member.id}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <UserPlusIcon className="h-4 w-4" />
                        {memberMutationUserId === member.id ? 'Adding...' : 'Add'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {membersError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {membersError}
            </div>
          )}

          {membersLoading ? (
            <div className={`${mutedTextClassName} py-6 text-center`}>
              Loading channel members...
            </div>
          ) : channelMembers.length === 0 ? (
            <div className={`${mutedTextClassName} py-6 text-center`}>
              No channel members to show.
            </div>
          ) : (
            <div className="space-y-2">
              {channelMembers.map((member) => {
                const canRemoveMember =
                  canManageChannelMembers &&
                  String(member.id) !== String(user?.id) &&
                  member.role !== 'admin'

                return (
                  <div
                    key={member.id}
                    className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full bg-primary-500 text-white">
                        {member.avatar ? (
                          <img
                            src={member.avatar}
                            alt={member.username}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                            {member.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-gray-900 dark:text-white">
                            {member.username}
                          </span>
                          {member.role && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {member.role}
                            </span>
                          )}
                        </div>
                        <div className={secondaryTextClassName}>
                          {member.email || 'Workspace user'}
                        </div>
                      </div>
                    </div>
                    {canRemoveMember && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveChannelMember(member)}
                        disabled={memberMutationUserId === member.id}
                        className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/30"
                      >
                        {memberMutationUserId === member.id
                          ? 'Removing...'
                          : currentChannel?.isPrivate
                            ? 'Remove'
                            : 'Remove Access'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderConversationPinnedPanel = () => (
    <div className="flex-1 overflow-y-auto p-4">
      {pinnedMessages.length === 0 ? (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">
          No pinned messages yet
        </div>
      ) : (
        <div className="space-y-3">
          {pinnedMessages.map((message) => (
            <div
              key={message.id}
              className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/10"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {message.senderName}
                </span>
                <button
                  type="button"
                  onClick={() => void togglePinMessage(message.id).then(() => {
                    setPinnedMessages((current) => current.filter((m) => m.id !== message.id))
                  })}
                  className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400"
                >
                  Unpin
                </button>
              </div>
              <p className="mt-1 break-words text-sm text-gray-700 dark:text-gray-200">
                {message.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderConversationBody = (layout: 'default' | 'sidebar' = 'default') =>
    activeTab === 'messages'
      ? renderConversationMessagesPanel(layout)
      : activeTab === 'files'
        ? renderConversationFilesPanel(layout)
        : activeTab === 'pinned'
          ? renderConversationPinnedPanel()
          : renderConversationMembersPanel(layout)

  if (!currentChatId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <HashtagIcon className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-600 mb-4" />
          <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Welcome to GWS Connect
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Select a channel or start a direct message
          </p>
        </div>
      </div>
    )
  }

  return (
    <div {...getRootProps()} className="relative flex-1 flex flex-col bg-gray-50 dark:bg-gray-900">
      <input {...getInputProps()} />
            {(isDragActive || pendingFile) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="w-full max-w-2xl rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Share a file</h3>
                    <button
                      onClick={resetPendingUpload}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                      aria-label="Close upload"
                    >
                      <XMarkIcon className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </button>
                  </div>

                  {pendingFile ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-[180px,1fr]">
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 flex items-center justify-center">
                        {previewUrl && pendingFile.type.startsWith('image/') ? (
                          <img src={previewUrl} alt={pendingFile.name} className="w-full h-40 object-cover rounded-lg" />
                        ) : previewUrl && pendingFile.type.startsWith('video/') ? (
                          <video src={previewUrl} className="w-full h-40 object-cover rounded-lg" controls />
                        ) : (
                          <div className="text-sm text-gray-600 dark:text-gray-300">Preview unavailable</div>
                        )}
                      </div>

                      <div className="space-y-3">
                        {replyTargetMessage && (
                          <div className="flex items-start justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 dark:border-primary-900/40 dark:bg-primary-900/20">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                                Replying to {replyTargetMessage.senderName}
                              </div>
                              <div className="mt-1 truncate text-sm text-gray-700 dark:text-gray-200">
                                {getReplyPreviewText(replyTargetMessage)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setReplyTargetId(null)}
                              className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-white/80 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                              aria-label="Cancel reply"
                            >
                              <XMarkIcon className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">File name</label>
                          <input
                            value={pendingName}
                            onChange={(e) => setPendingName(e.target.value)}
                            className="w-full rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                            aria-label="File name"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
                          <textarea
                            value={pendingMessage}
                            onChange={(e) => setPendingMessage(e.target.value)}
                            rows={3}
                            placeholder="Add a message..."
                            className="w-full rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                            aria-label="Message"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={resetPendingUpload}
                            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSendUpload}
                            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-6 py-10 text-center">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">Drop files to upload</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Images, videos, and documents</div>
                    </div>
                  )}
                </div>
              </div>
            )}
      {/* Chat Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0">
            {currentGroupChat ? (
              <UserGroupIcon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            ) : (
              <HashtagIcon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            )}
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white truncate">
                {currentChannel?.name || currentGroupChat?.name || currentDirectConversation?.username || 'Direct Message'}
              </h3>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">
                {currentChannel?.description
                  || (currentGroupChat
                    ? `${currentGroupChat.members.length} members`
                    : currentDirectConversation
                      ? `Direct message with ${currentDirectConversation.username}`
                      : 'Private conversation')}
              </p>
            </div>
            {canEditChannel && activeChannel && (
              <button
                onClick={() => setShowEditModal(true)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title="Edit channel"
              >
                <PencilIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            )}
          </div>

          {!activeCallId && currentChatType && currentChatId && (
            <div className="flex flex-shrink-0 items-center gap-2">
              {(currentChannel || currentGroupChat) && (
                <button
                  type="button"
                  onClick={() => setShowInviteModal(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                  title="Invite people"
                >
                  <UserPlusIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Invite</span>
                </button>
              )}
              {(currentGroupChat || (activeDM && currentDirectConversation)) && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowDisappearingMenu((current) => !current)}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                    title="Disappearing messages"
                  >
                    <ClockIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">
                      {(currentGroupChat?.disappearingMessagesSeconds || (activeDM ? dmDisappearingSecondsByPeerId[activeDM] : 0))
                        ? 'Disappearing: On'
                        : 'Disappearing'}
                    </span>
                  </button>
                  {showDisappearingMenu && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      {[
                        { label: 'Off', seconds: 0 },
                        { label: '1 hour', seconds: 3600 },
                        { label: '1 day', seconds: 86400 },
                        { label: '7 days', seconds: 604800 },
                      ].map((option) => (
                        <button
                          key={option.seconds}
                          type="button"
                          onClick={() => {
                            setShowDisappearingMenu(false)
                            if (currentGroupChat) {
                              void setGroupChatDisappearing(currentGroupChat.id, option.seconds)
                            } else if (activeDM) {
                              void setDmDisappearing(activeDM, option.seconds)
                            }
                          }}
                          className="w-full rounded-md px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => void startCall(currentChatType, currentChatId, false)}
                disabled={isConnecting}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                title={activeChannel ? 'Start voice call' : 'Call'}
              >
                <PhoneIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Voice</span>
              </button>
              <button
                type="button"
                onClick={() => void startCall(currentChatType, currentChatId, true)}
                disabled={isConnecting}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                title={activeChannel ? 'Start video call' : 'Video call'}
              >
                <VideoCameraIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Video</span>
              </button>
              {currentGroupChat && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Leave this group chat?')) {
                      void leaveGroupChat(currentGroupChat.id)
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/30"
                  title="Leave group"
                >
                  <span className="hidden sm:inline">Leave</span>
                </button>
              )}
            </div>
          )}
        </div>

        {currentGroupChat && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            {currentGroupChat.members.map((member) => (
              <span
                key={member.id}
                className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-700"
              >
                {member.username}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setActiveTab('messages')}
            className={`px-3 py-1.5 rounded-full text-sm ${
              activeTab === 'messages'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
            }`}
          >
            Messages
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`px-3 py-1.5 rounded-full text-sm ${
              activeTab === 'files'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
            }`}
          >
            Files
          </button>
          <button
            onClick={() => setActiveTab('pinned')}
            className={`px-3 py-1.5 rounded-full text-sm ${
              activeTab === 'pinned'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
            }`}
          >
            Pinned
          </button>
          {activeChannel && (
            <button
              onClick={() => setActiveTab('members')}
              className={`px-3 py-1.5 rounded-full text-sm ${
                activeTab === 'members'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
              }`}
            >
              Members
            </button>
          )}
        </div>
      </div>

      <>
        {renderConversationBody()}
        {activeTab === 'messages' && (
          <MessageInput
            channelId={activeChannel || undefined}
            recipientId={activeDM || undefined}
            groupChatId={activeGroupChat || undefined}
            onSelectFile={(file) => {
              setPendingFile(file)
              setPendingName(file.name)
              setPendingMessage('')
            }}
            replyTarget={replyTargetMessage}
            onCancelReply={() => setReplyTargetId(null)}
          />
        )}
      </>

      {hoverProfileCard && (
        <div
          className="fixed z-40 w-64 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl p-3"
          style={{ top: hoverProfileCard.top, left: hoverProfileCard.left }}
          onMouseEnter={handleProfileCardMouseEnter}
          onMouseLeave={handleProfileCardMouseLeave}
        >
          <div className="flex flex-col items-center gap-2">
            {hoverProfileCard.avatar ? (
              <img
                src={hoverProfileCard.avatar}
                alt={hoverProfileCard.username}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-primary-500 flex items-center justify-center text-white text-2xl font-semibold">
                {hoverProfileCard.username[0]?.toUpperCase() || '?'}
              </div>
            )}
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-full">
              {hoverProfileCard.username}
            </p>
          </div>
          <div className="my-3 h-px bg-gray-200 dark:bg-gray-700" />
          <button
            type="button"
            onClick={handleViewProfile}
            className="w-full px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
          >
            View Profile
          </button>
        </div>
      )}

      {mediaViewer && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-5xl">
            <button
              type="button"
              onClick={() => setMediaViewer(null)}
              className="absolute -top-10 right-0 text-sm text-white/80 hover:text-white"
            >
              Close
            </button>
            <div className="rounded-2xl bg-black/60 p-3">
              {mediaViewer.type === 'image' ? (
                <img
                  src={mediaViewer.url}
                  alt={mediaViewer.name || 'Full size'}
                  className="max-h-[80vh] w-full object-contain"
                />
              ) : mediaViewer.type === 'video' ? (
                <video src={mediaViewer.url} className="max-h-[80vh] w-full" controls autoPlay />
              ) : (
                <DocumentPreview
                  url={mediaViewer.url}
                  mime={mediaViewer.mime}
                  name={mediaViewer.name}
                />
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <a
                href={mediaViewer.url}
                download
                className="px-4 py-2 rounded-lg bg-white/90 text-gray-900 hover:bg-white"
              >
                Download
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Edit Channel Modal */}
      {currentChannel && (
        <ChannelModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            loadChannels()
            setShowEditModal(false)
          }}
          channel={{
            id: Number(currentChannel.id),
            name: currentChannel.name,
            description: currentChannel.description,
            isPrivate: !!currentChannel.isPrivate,
            slowModeSeconds: currentChannel.slowModeSeconds,
            disappearingMessagesSeconds: currentChannel.disappearingMessagesSeconds,
          }}
          mode="edit"
        />
      )}

      {/* Invite Modal */}
      {(currentChannel || currentGroupChat) && (
        <InviteModal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          targetType={currentChannel ? 'channel' : 'group'}
          targetId={currentChannel ? currentChannel.id : currentGroupChat!.id}
          targetName={currentChannel?.name || currentGroupChat?.name || ''}
        />
      )}
    </div>
  )
}
