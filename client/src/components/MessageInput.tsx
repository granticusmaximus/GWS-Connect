import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import axios from 'axios'
import { API_URL } from '../config/runtime'
import { useChatStore, type Message as ChatMessage, type TypingUser } from '../store/chatStore'
import { getReplyPreviewText } from '../utils/replies'
import { PaperAirplaneIcon, PaperClipIcon, PlusIcon, ChartBarIcon, PhotoIcon, XMarkIcon } from '@heroicons/react/24/outline'
import PollCreateModal from './PollCreateModal'
import GifPickerModal from './GifPickerModal'
const TYPING_STOP_DELAY_MS = 1800
const TYPING_KEEPALIVE_INTERVAL_MS = 1500

interface MessageInputProps {
  channelId?: string
  recipientId?: string
  groupChatId?: string
  onSelectFile?: (file: File) => void
  replyTarget?: ChatMessage | null
  onCancelReply?: () => void
}

interface User {
  id: number | string
  username: string
  avatar?: string | null
}

interface MentionContext {
  start: number
  end: number
  query: string
}

interface TypingIndicatorProps {
  users: TypingUser[]
}

const mentionTriggerRegex = /(^|\s)@([A-Za-z0-9._-]*)$/

const getMentionContext = (text: string, cursorPosition: number): MentionContext | null => {
  const beforeCursor = text.slice(0, cursorPosition)
  const match = beforeCursor.match(mentionTriggerRegex)

  if (!match) return null

  const query = match[2] ?? ''
  const start = beforeCursor.length - query.length - 1 // index of "@"

  return {
    start,
    end: cursorPosition,
    query,
  }
}

function TypingIndicator({ users }: TypingIndicatorProps) {
  if (users.length === 0) return null

  const label = (() => {
    if (users.length === 1) return `${users[0].username} is typing...`
    if (users.length === 2) return `${users[0].username} and ${users[1].username} are typing...`
    if (users.length === 3) {
      return `${users[0].username}, ${users[1].username}, and ${users[2].username} are typing...`
    }
    return 'Several people are typing...'
  })()

  const leadUser = users[0]

  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-gray-100 px-3 py-2 text-gray-600 dark:bg-gray-700/80 dark:text-gray-200">
      <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-full bg-gray-300 dark:bg-gray-600">
        {leadUser.avatar ? (
          <img src={leadUser.avatar} alt={leadUser.username} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-white">
            {leadUser.username[0]?.toUpperCase() || '?'}
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 dark:bg-gray-800/80">
          {[0, 1, 2].map((dotIndex) => (
            <span
              key={dotIndex}
              className="h-2 w-2 rounded-full bg-gray-400 dark:bg-gray-300"
              style={{
                animation: 'bounce 1.2s infinite',
                animationDelay: `${dotIndex * 0.15}s`,
              }}
            />
          ))}
        </div>
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
    </div>
  )
}

export default function MessageInput({
  channelId,
  recipientId,
  groupChatId,
  onSelectFile,
  replyTarget = null,
  onCancelReply,
}: MessageInputProps) {
  const [message, setMessage] = useState('')
  const [showActions, setShowActions] = useState(false)
  const [showPollModal, setShowPollModal] = useState(false)
  const [showGifModal, setShowGifModal] = useState(false)
  const [gifQuery, setGifQuery] = useState('')
  const [pollInitialQuestion, setPollInitialQuestion] = useState('')
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [channelMembers, setChannelMembers] = useState<User[]>([])
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const messageInputRef = useRef<HTMLInputElement | null>(null)
  const typingStopTimeoutRef = useRef<number | null>(null)
  const typingStateRef = useRef({
    active: false,
    lastEmittedAt: 0,
  })
  const {
    sendMessage,
    createPoll,
    sendGif,
    emitTypingStart,
    emitTypingStop,
    typingUsersByChatId,
  } = useChatStore()

  const typingConversationKey = channelId
    ? String(channelId)
    : groupChatId
      ? String(groupChatId)
      : recipientId
        ? String(recipientId)
        : null
  const typingUsers = useMemo(
    () => (typingConversationKey ? typingUsersByChatId[typingConversationKey] || [] : []),
    [typingConversationKey, typingUsersByChatId],
  )

  const showCommandMenu = message.startsWith('/')

  const commandItems = useMemo(
    () => [
      {
        id: 'attach',
        label: 'Attach File',
        description: 'Upload a file',
        icon: PaperClipIcon,
        action: () => {
          fileInputRef.current?.click()
        },
      },
      {
        id: 'gif',
        label: 'GIF',
        description: 'Search and send a GIF',
        icon: PhotoIcon,
        action: () => {
          setGifQuery('')
          setShowGifModal(true)
        },
      },
      {
        id: 'poll',
        label: 'Create Poll',
        description: 'Start a new poll',
        icon: ChartBarIcon,
        action: () => {
          setPollInitialQuestion('')
          setShowPollModal(true)
        },
      },
    ],
    []
  )

  useEffect(() => {
    if (showCommandMenu) {
      setSelectedCommandIndex(0)
    }
  }, [showCommandMenu])

  useEffect(() => {
    if (!replyTarget || !messageInputRef.current) return
    messageInputRef.current.focus()
  }, [replyTarget])

  const clearTypingStopTimeout = useCallback(() => {
    if (typingStopTimeoutRef.current !== null) {
      window.clearTimeout(typingStopTimeoutRef.current)
      typingStopTimeoutRef.current = null
    }
  }, [])

  const stopTyping = useCallback(() => {
    clearTypingStopTimeout()

    if (!typingStateRef.current.active) {
      typingStateRef.current.lastEmittedAt = 0
      return
    }

    emitTypingStop(channelId, recipientId, groupChatId)
    typingStateRef.current.active = false
    typingStateRef.current.lastEmittedAt = 0
  }, [channelId, clearTypingStopTimeout, emitTypingStop, groupChatId, recipientId])

  const syncTypingState = useCallback((nextMessage: string) => {
    if (!channelId && !recipientId && !groupChatId) return

    const hasContent = nextMessage.trim().length > 0
    if (!hasContent) {
      stopTyping()
      return
    }

    const now = Date.now()
    if (
      !typingStateRef.current.active ||
      now - typingStateRef.current.lastEmittedAt >= TYPING_KEEPALIVE_INTERVAL_MS
    ) {
      emitTypingStart(channelId, recipientId, groupChatId)
      typingStateRef.current.active = true
      typingStateRef.current.lastEmittedAt = now
    }

    clearTypingStopTimeout()
    typingStopTimeoutRef.current = window.setTimeout(() => {
      emitTypingStop(channelId, recipientId, groupChatId)
      typingStateRef.current.active = false
      typingStateRef.current.lastEmittedAt = 0
      typingStopTimeoutRef.current = null
    }, TYPING_STOP_DELAY_MS)
  }, [
    channelId,
    clearTypingStopTimeout,
    emitTypingStart,
    emitTypingStop,
    groupChatId,
    recipientId,
    stopTyping,
  ])

  useEffect(() => () => {
    stopTyping()
  }, [stopTyping])

  const mentionCandidates = useMemo(() => {
    if (!channelId || !mentionContext) return []

    const normalizedQuery = mentionContext.query.toLowerCase()
    return channelMembers.filter((member) =>
      member.username.toLowerCase().includes(normalizedQuery),
    )
  }, [channelId, mentionContext, channelMembers])

  const showMentions = Boolean(channelId && mentionContext)

  useEffect(() => {
    setSelectedMentionIndex(0)
  }, [mentionContext?.query, mentionContext?.start, mentionCandidates.length])

  useEffect(() => {
    let isCancelled = false

    const fetchMembers = async () => {
      if (!channelId) {
        setChannelMembers([])
        setMentionContext(null)
        return
      }

      try {
        const response = await axios.get(`${API_URL}/channels/${channelId}/members`)
        if (!isCancelled) {
          setChannelMembers(Array.isArray(response.data) ? response.data : [])
        }
      } catch (error) {
        console.error('Error fetching channel members:', error)
        if (!isCancelled) {
          setChannelMembers([])
        }
      }
    }

    void fetchMembers()

    return () => {
      isCancelled = true
    }
  }, [channelId])

  const updateMentionContext = useCallback(
    (nextMessage: string, cursorPosition: number | null) => {
      if (!channelId || cursorPosition === null) {
        setMentionContext(null)
        return
      }

      const nextMentionContext = getMentionContext(nextMessage, cursorPosition)
      setMentionContext(nextMentionContext)
    },
    [channelId],
  )

  const handleMessageChange = (value: string, cursorPosition: number | null) => {
    setMessage(value)
    updateMentionContext(value, cursorPosition)
    syncTypingState(value)
  }

  const handleCursorUpdate = () => {
    if (!messageInputRef.current) return
    updateMentionContext(message, messageInputRef.current.selectionStart)
  }

  const handleSendMessage = async () => {
    if (!message.trim()) return

    stopTyping()

    if (/^\/poll(\s|$)/.test(message.trim())) {
      const question = message.trim().replace(/^\/poll\s*/, '')
      setPollInitialQuestion(question)
      setShowPollModal(true)
      setMessage('')
      setMentionContext(null)
      return
    }

    if (/^\/gif(\s|$)/.test(message.trim())) {
      const query = message.trim().replace(/^\/gif\s*/, '')
      setGifQuery(query)
      setShowGifModal(true)
      setMessage('')
      setMentionContext(null)
      return
    }

    const sent = await sendMessage(message, channelId, recipientId, undefined, replyTarget?.id, groupChatId)
    if (sent) {
      setMessage('')
      setMentionContext(null)
      onCancelReply?.()
    }
  }

  const selectMention = (user: User) => {
    if (!mentionContext) return

    const beforeMention = message.slice(0, mentionContext.start)
    const afterMention = message.slice(mentionContext.end)
    const mentionText = `@${user.username} `
    const newMessage = `${beforeMention}${mentionText}${afterMention}`
    const nextCursorPosition = beforeMention.length + mentionText.length

    setMessage(newMessage)
    setMentionContext(null)

    requestAnimationFrame(() => {
      if (!messageInputRef.current) return
      messageInputRef.current.focus()
      messageInputRef.current.setSelectionRange(nextCursorPosition, nextCursorPosition)
    })
  }

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showMentions) {
      if (e.key === 'ArrowDown' && mentionCandidates.length > 0) {
        e.preventDefault()
        setSelectedMentionIndex((prev) => (prev + 1) % mentionCandidates.length)
        return
      }

      if (e.key === 'ArrowUp' && mentionCandidates.length > 0) {
        e.preventDefault()
        setSelectedMentionIndex((prev) => (prev - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        const selected = mentionCandidates[selectedMentionIndex]
        if (selected) {
          e.preventDefault()
          selectMention(selected)
          return
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionContext(null)
        return
      }
    }

    if (showCommandMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex((prev) => (prev + 1) % commandItems.length)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex((prev) => (prev - 1 + commandItems.length) % commandItems.length)
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        commandItems[selectedCommandIndex]?.action()
        setMessage('')
        stopTyping()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSendMessage()
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-3 sm:p-4">
      <TypingIndicator users={typingUsers} />

      {replyTarget && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 dark:border-primary-900/40 dark:bg-primary-900/20">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
              Replying to {replyTarget.senderName}
            </div>
            <div className="mt-1 truncate text-sm text-gray-700 dark:text-gray-200">
              {getReplyPreviewText(replyTarget)}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-white/80 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Cancel reply"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-center space-x-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowActions((prev) => !prev)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Message actions"
          >
            <PlusIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>

          {showActions && (
            <div className="absolute bottom-12 left-0 w-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-2">
              <label className="w-full px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file && onSelectFile) onSelectFile(file)
                    setShowActions(false)
                  }}
                  aria-label="File upload"
                />
                <PaperClipIcon className="w-4 h-4" />
                Attach File
              </label>
              <button
                type="button"
                onClick={() => {
                  setGifQuery('')
                  setShowGifModal(true)
                  setShowActions(false)
                }}
                className="w-full px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
              >
                <PhotoIcon className="w-4 h-4" />
                GIF
              </button>
              <button
                type="button"
                onClick={() => {
                  setPollInitialQuestion('')
                  setShowPollModal(true)
                  setShowActions(false)
                }}
                className="w-full px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
              >
                <ChartBarIcon className="w-4 h-4" />
                Create Poll
              </button>
            </div>
          )}
        </div>

        <div className="relative flex-1">
          <input
            ref={messageInputRef}
            type="text"
            value={message}
            onChange={(e) => handleMessageChange(e.target.value, e.target.selectionStart)}
            onClick={handleCursorUpdate}
            onBlur={stopTyping}
            onKeyUp={handleCursorUpdate}
            onKeyDown={handleKeyPress}
            placeholder="Type a message... (use @username to mention)"
            className="w-full px-3 sm:px-4 py-2 bg-gray-100 dark:bg-gray-700 border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm sm:text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          />

          {showMentions && (
            <div className="absolute left-0 bottom-12 w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-20 max-h-56 overflow-y-auto">
              {mentionCandidates.length > 0 ? (
                mentionCandidates.map((user, index) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => selectMention(user)}
                    onMouseEnter={() => setSelectedMentionIndex(index)}
                    className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                      index === selectedMentionIndex
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-300 dark:bg-gray-600 flex-shrink-0">
                      {user.avatar ? (
                        <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white text-xs font-semibold">
                          {user.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <span>@{user.username}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  No matching users in this channel
                </div>
              )}
            </div>
          )}

          {showCommandMenu && !showMentions && (
            <div className="absolute left-0 bottom-12 w-full sm:w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-2 z-10">
              {commandItems.map((item, index) => {
                const Icon = item.icon
                const isActive = index === selectedCommandIndex
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      item.action()
                      setMessage('')
                    }}
                    onMouseEnter={() => setSelectedCommandIndex(index)}
                    className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                      isActive
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <div className="flex flex-col">
                      <span>{item.label}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{item.description}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        
        <button
          onClick={handleSendMessage}
          disabled={!message.trim()}
          className="p-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 rounded-lg transition-colors disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          <PaperAirplaneIcon className="w-5 h-5 text-white" />
        </button>
      </div>

      <PollCreateModal
        isOpen={showPollModal}
        onClose={() => setShowPollModal(false)}
        initialQuestion={pollInitialQuestion}
        onCreate={async ({ question, options, durationMinutes }) => {
          const ok = await createPoll(question, options, channelId, recipientId, durationMinutes, replyTarget?.id, groupChatId)
          if (ok) {
            setShowPollModal(false)
            setPollInitialQuestion('')
            onCancelReply?.()
          }
        }}
      />

      <GifPickerModal
        isOpen={showGifModal}
        initialQuery={gifQuery}
        onClose={() => setShowGifModal(false)}
        onSelect={async (gif) => {
          const ok = await sendGif(gif.url, gif.title, channelId, recipientId, replyTarget?.id, groupChatId)
          if (ok) {
            setShowGifModal(false)
            setGifQuery('')
            onCancelReply?.()
          }
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file && onSelectFile) onSelectFile(file)
        }}
        aria-label="File upload"
      />
    </div>
  )
}
