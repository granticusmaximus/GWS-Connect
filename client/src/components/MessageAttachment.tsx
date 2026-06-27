import { PaperClipIcon } from '@heroicons/react/24/outline'
import { useDecryptedAttachment } from '../hooks/useDecryptedAttachment'
import type { Message } from '../store/chatStore'

interface MessageAttachmentProps {
  message: Message
  mediaWidthClassName: string
  onOpen: (payload: { url: string; type: 'image' | 'video' | 'document'; name?: string; mime?: string }) => void
}

export default function MessageAttachment({ message, mediaWidthClassName, onOpen }: MessageAttachmentProps) {
  const { url, name, type, loading, error } = useDecryptedAttachment(message, {
    channelId: message.channelId,
    recipientId: message.recipientId,
    groupChatId: message.groupChatId,
  })

  if (loading) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 italic">Decrypting attachment…</div>
    )
  }

  if (error || !url) {
    return (
      <div className="text-sm text-red-500 dark:text-red-400">
        {error || 'Failed to load attachment'}
      </div>
    )
  }

  if (type.startsWith('image/')) {
    return (
      <button
        type="button"
        onClick={() => onOpen({ url, type: 'image', name: name || 'Image' })}
        className="block"
        aria-label="Open image"
      >
        <img src={url} alt={name || 'Image'} className={`${mediaWidthClassName} rounded-lg`} />
      </button>
    )
  }

  if (type.startsWith('video/')) {
    return (
      <button
        type="button"
        onClick={() => onOpen({ url, type: 'video', name: name || 'Video' })}
        className="block"
        aria-label="Open video"
      >
        <video src={url} className={`${mediaWidthClassName} rounded-lg`} controls />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen({ url, type: 'document', name: name || 'Document', mime: type || undefined })}
      className="break-words text-primary-600 hover:underline dark:text-primary-400 [overflow-wrap:anywhere]"
    >
      <span className="inline-flex items-center gap-1">
        <PaperClipIcon className="h-4 w-4" />
        {name || 'Document'}
      </span>
    </button>
  )
}
