import { BookmarkSlashIcon } from '@heroicons/react/24/outline'
import type { Message as ChatMessage } from '../store/chatStore'
import { renderMarkdownInline } from '../utils/renderMarkdown'
import { getReplyPreviewText } from '../utils/replies'

interface BookmarksPanelProps {
  messages: ChatMessage[]
  onOpenMessage: (message: ChatMessage) => void
  onRemoveBookmark: (message: ChatMessage) => void
  resolveContextLabel: (message: ChatMessage) => string
}

const buildPreviewHtml = (message: ChatMessage) => {
  const previewText = getReplyPreviewText(message)
  return renderMarkdownInline(previewText)
}

export default function BookmarksPanel({
  messages,
  onOpenMessage,
  onRemoveBookmark,
  resolveContextLabel,
}: BookmarksPanelProps) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 px-5 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
          No bookmarked messages yet.
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
                  {resolveContextLabel(message)}
                </div>
                <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                  {message.senderName}
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {new Date(message.timestamp).toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveBookmark(message)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <BookmarkSlashIcon className="h-4 w-4" />
                Remove
              </button>
            </div>

            <button
              type="button"
              onClick={() => onOpenMessage(message)}
              className="mt-3 block w-full rounded-xl bg-gray-50 px-3 py-3 text-left transition hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              <div
                className="chat-markdown text-sm text-gray-700 dark:text-gray-200"
                dangerouslySetInnerHTML={{ __html: buildPreviewHtml(message) }}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
