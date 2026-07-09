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
import { useAuthStore } from '../store/authStore'
import { getReplyPreviewText } from '../utils/replies'
import { PaperAirplaneIcon, PaperClipIcon, PlusIcon, ChartBarIcon, ClockIcon, PhotoIcon, MicrophoneIcon, StopCircleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import PollCreateModal from './PollCreateModal'
import GifPickerModal from './GifPickerModal'
import ScheduleMessagePicker from './ScheduleMessagePicker'
import { searchCommands, type SlashCommandId } from '../utils/commandRegistry'
import { searchEmoji, type EmojiEntry } from '../utils/emojiData'

const TYPING_STOP_DELAY_MS = 1800
const TYPING_KEEPALIVE_INTERVAL_MS = 1500
const AUDIO_MIME_TYPE_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

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

// Matches :keyword with at least 2 chars so we don't trigger on emoticons like :)
const emojiTriggerRegex = /(^|\s):([a-z0-9_+\-]{2,})$/

interface EmojiContext {
  start: number // index of the ':' character
  end: number   // current cursor position
  query: string
}

const getEmojiContext = (text: string, cursorPosition: number): EmojiContext | null => {
  const beforeCursor = text.slice(0, cursorPosition)
  const match = beforeCursor.match(emojiTriggerRegex)
  if (!match) return null
  const query = match[2] ?? ''
  const colonIdx = beforeCursor.lastIndexOf(':')
  return { start: colonIdx, end: cursorPosition, query }
}

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
  const [showSchedulePicker, setShowSchedulePicker] = useState(false)
  const [gifQuery, setGifQuery] = useState('')
  const [pollInitialQuestion, setPollInitialQuestion] = useState('')
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [channelMembers, setChannelMembers] = useState<User[]>([])
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [emojiContext, setEmojiContext] = useState<EmojiContext | null>(null)
  const [selectedEmojiIndex, setSelectedEmojiIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const messageInputRef = useRef<HTMLInputElement | null>(null)
  const typingStopTimeoutRef = useRef<number | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingTimerRef = useRef<number | null>(null)
  const typingStateRef = useRef({
    active: false,
    lastEmittedAt: 0,
  })
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const {
    sendMessage,
    scheduleMessage,
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
  const currentUser = useAuthStore((state) => state.user)

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }, [])

  const cleanupRecordingStream = useCallback(() => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    recordingStreamRef.current = null
  }, [])

  const stopRecording = useCallback(async (discard = false) => {
    const recorder = mediaRecorderRef.current
    if (!recorder) {
      return
    }

    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const chunks = [...recordingChunksRef.current]
        const mimeType = recorder.mimeType || 'audio/webm'
        const extension = mimeType.includes('mp4') ? 'm4a' : 'webm'

        clearRecordingTimer()
        cleanupRecordingStream()
        mediaRecorderRef.current = null
        recordingChunksRef.current = []
        setIsRecording(false)
        setRecordingSeconds(0)

        if (!discard && chunks.length > 0 && onSelectFile) {
          onSelectFile(
            new File(chunks, `voice-note-${Date.now()}.${extension}`, { type: mimeType }),
          )
        }

        resolve()
      }

      recorder.stop()
    })
  }, [cleanupRecordingStream, clearRecordingTimer, onSelectFile])

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      await stopRecording(false)
      setShowActions(false)
      return
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('Voice recording is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordingStreamRef.current = stream

      const mimeType = AUDIO_MIME_TYPE_CANDIDATES.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      )
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      recordingChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecordingSeconds(0)
      clearRecordingTimer()
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => current + 1)
      }, 1000)
      setShowActions(false)
    } catch (error) {
      console.error('Voice note recording failed:', error)
      cleanupRecordingStream()
      alert('Unable to access your microphone.')
    }
  }, [cleanupRecordingStream, clearRecordingTimer, isRecording, stopRecording])

  const commandQuery = useMemo(() => {
    if (!message.startsWith('/')) {
      return ''
    }
    return message.slice(1).trimStart().split(/\s+/)[0]?.toLowerCase() || ''
  }, [message])

  const commandItems = useMemo(() => searchCommands(commandQuery), [commandQuery])
  const showCommandMenu = message.startsWith('/')

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

  useEffect(() => () => {
    clearRecordingTimer()
    cleanupRecordingStream()
  }, [clearRecordingTimer, cleanupRecordingStream])

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

  const emojiCandidates = useMemo<EmojiEntry[]>(
    () => (emojiContext ? searchEmoji(emojiContext.query) : []),
    [emojiContext],
  )
  const showEmojiAutocomplete = Boolean(!showMentions && emojiContext && emojiCandidates.length > 0)

  useEffect(() => {
    setSelectedEmojiIndex(0)
  }, [emojiContext?.query])

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

  const updateEmojiContext = useCallback((text: string, cursorPosition: number | null) => {
    if (cursorPosition === null) { setEmojiContext(null); return }
    setEmojiContext(getEmojiContext(text, cursorPosition))
  }, [])

  const handleMessageChange = (value: string, cursorPosition: number | null) => {
    setMessage(value)
    updateMentionContext(value, cursorPosition)
    updateEmojiContext(value, cursorPosition)
    syncTypingState(value)
  }

  const handleCursorUpdate = () => {
    if (!messageInputRef.current) return
    const pos = messageInputRef.current.selectionStart
    updateMentionContext(message, pos)
    updateEmojiContext(message, pos)
  }

  const handleSendMessage = async () => {
    if (isRecording || !message.trim()) return

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

    if (/^\/schedule(\s|$)/.test(message.trim())) {
      setShowSchedulePicker(true)
      return
    }

    if (/^\/shrug(\s|$)/.test(message.trim())) {
      const suffix = message.trim().replace(/^\/shrug\s*/, '')
      const shrugMessage = suffix ? `¯\\_(ツ)_/¯ ${suffix}` : '¯\\_(ツ)_/¯'
      const sent = await sendMessage(shrugMessage, channelId, recipientId, undefined, replyTarget?.id, groupChatId)
      if (sent) {
        setMessage('')
        setMentionContext(null)
        setEmojiContext(null)
        onCancelReply?.()
      }
      return
    }

    if (/^\/me(\s|$)/.test(message.trim())) {
      const actionText = message.trim().replace(/^\/me\s*/, '')
      if (!actionText) {
        return
      }
      const emoteMessage = `*${currentUser?.username || 'Someone'} ${actionText}*`
      const sent = await sendMessage(emoteMessage, channelId, recipientId, undefined, replyTarget?.id, groupChatId)
      if (sent) {
        setMessage('')
        setMentionContext(null)
        setEmojiContext(null)
        onCancelReply?.()
      }
      return
    }

    const sent = await sendMessage(message, channelId, recipientId, undefined, replyTarget?.id, groupChatId)
    if (sent) {
      setMessage('')
      setMentionContext(null)
      setEmojiContext(null)
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

  const selectEmoji = (entry: EmojiEntry) => {
    if (!emojiContext) return

    const before = message.slice(0, emojiContext.start)
    const after = message.slice(emojiContext.end)
    const insertion = `${entry.char} `
    const newMessage = `${before}${insertion}${after}`
    const nextCursor = before.length + insertion.length

    setMessage(newMessage)
    setEmojiContext(null)

    requestAnimationFrame(() => {
      if (!messageInputRef.current) return
      messageInputRef.current.focus()
      messageInputRef.current.setSelectionRange(nextCursor, nextCursor)
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

    if (showEmojiAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedEmojiIndex((prev) => (prev + 1) % emojiCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedEmojiIndex((prev) => (prev - 1 + emojiCandidates.length) % emojiCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const selected = emojiCandidates[selectedEmojiIndex]
        if (selected) {
          e.preventDefault()
          selectEmoji(selected)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setEmojiContext(null)
        return
      }
    }

    if (showCommandMenu) {
      if (e.key === 'ArrowDown' && commandItems.length > 0) {
        e.preventDefault()
        setSelectedCommandIndex((prev) => (prev + 1) % commandItems.length)
        return
      }

      if (e.key === 'ArrowUp' && commandItems.length > 0) {
        e.preventDefault()
        setSelectedCommandIndex((prev) => (prev - 1 + commandItems.length) % commandItems.length)
        return
      }

      if (e.key === 'Enter' && commandItems.length > 0) {
        const selectedCommandId = commandItems[selectedCommandIndex]?.id
        const hasCommandArguments = message.trim().split(/\s+/).length > 1
        const shouldDeferToSend =
          hasCommandArguments &&
          ['gif', 'poll', 'schedule', 'me', 'shrug'].includes(
            String(selectedCommandId || ''),
          )

        if (!shouldDeferToSend) {
          e.preventDefault()
          handleCommandAction(selectedCommandId)
          setMessage('')
          stopTyping()
          return
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSendMessage()
    }
  }

  const handleCommandAction = (commandId?: SlashCommandId) => {
    switch (commandId) {
      case 'attach':
        fileInputRef.current?.click()
        break
      case 'gif':
        setGifQuery('')
        setShowGifModal(true)
        break
      case 'poll':
        setPollInitialQuestion('')
        setShowPollModal(true)
        break
      case 'voice':
        void toggleRecording()
        break
      case 'schedule':
        setShowSchedulePicker(true)
        break
      case 'shrug':
        setMessage('/shrug ')
        break
      case 'me':
        setMessage('/me ')
        break
      default:
        break
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

      {isRecording && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/40 dark:bg-red-900/20">
          <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            Recording voice note ({recordingSeconds}s)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void stopRecording(true)}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/30"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void stopRecording(false)}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
            >
              Finish
            </button>
          </div>
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
              <button
                type="button"
                onClick={() => {
                  void toggleRecording()
                }}
                className="w-full px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
              >
                <MicrophoneIcon className="w-4 h-4" />
                Voice Note
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void toggleRecording()}
          className={`p-2 rounded-lg transition-colors ${
            isRecording
              ? 'bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50'
              : 'hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
          aria-label={isRecording ? 'Stop recording voice note' : 'Record voice note'}
        >
          {isRecording ? (
            <StopCircleIcon className="w-5 h-5" />
          ) : (
            <MicrophoneIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setShowSchedulePicker(true)}
          disabled={!message.trim() || isRecording}
          className="p-2 rounded-lg transition-colors hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
          aria-label="Schedule message"
        >
          <ClockIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </button>

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
            placeholder="Type a message... (@username to mention, :emoji: for emoji)"
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

          {showEmojiAutocomplete && (
            <div className="absolute left-0 bottom-12 w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-20">
              {emojiCandidates.map((entry, index) => (
                <button
                  key={entry.char}
                  type="button"
                  onClick={() => selectEmoji(entry)}
                  onMouseEnter={() => setSelectedEmojiIndex(index)}
                  className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-3 transition-colors ${
                    index === selectedEmojiIndex
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className="text-xl leading-none w-7 flex-shrink-0 text-center">{entry.char}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">:{entry.names[0]}:</span>
                </button>
              ))}
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
                      handleCommandAction(item.id)
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
          disabled={!message.trim() || isRecording}
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

      <ScheduleMessagePicker
        isOpen={showSchedulePicker}
        onClose={() => setShowSchedulePicker(false)}
        onConfirm={async (deliverAt) => {
          const ok = await scheduleMessage(message, deliverAt, channelId, recipientId, replyTarget?.id, groupChatId)
          if (ok) {
            setShowSchedulePicker(false)
            setMessage('')
            setMentionContext(null)
            setEmojiContext(null)
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
