import { XMarkIcon } from '@heroicons/react/24/outline'
import type { ReactNode } from 'react'
import type { Message as ChatMessage, WorkspaceEmoji } from '../store/chatStore'
import { renderMarkdownInline } from '../utils/renderMarkdown'
import { getReplyPreviewText } from '../utils/replies'

interface ThreadPanelProps {
  isOpen: boolean
  loading: boolean
  threadRootMessageId: string | null
  messages: ChatMessage[]
  onClose: () => void
  onJumpToMessage: (messageId: string) => void
  workspaceEmoji?: WorkspaceEmoji[]
  footer?: ReactNode
}

const buildPreview = (message: ChatMessage, workspaceEmoji: WorkspaceEmoji[]) =>
  renderMarkdownInline(getReplyPreviewText(message), workspaceEmoji)

export default function ThreadPanel({
  isOpen,
  loading,
  threadRootMessageId,
  messages,
  onClose,
  onJumpToMessage,
  workspaceEmoji = [],
  footer,
}: ThreadPanelProps) {
  const rootMessage = messages.find((message) => message.id === threadRootMessageId) || messages[0] || null

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform dark:border-gray-700 dark:bg-gray-900 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!isOpen}
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">Thread</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {Math.max(messages.length - 1, 0)} repl{messages.length - 1 === 1 ? 'y' : 'ies'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label="Close thread panel"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading thread…</div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No replies yet.</div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => {
              const isRoot = rootMessage?.id === message.id
              return (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => onJumpToMessage(message.id)}
                  className={`block w-full rounded-2xl border px-4 py-3 text-left transition ${
                    isRoot
                      ? 'border-primary-200 bg-primary-50 dark:border-primary-900/40 dark:bg-primary-900/20'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                        {message.senderName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(message.timestamp).toLocaleString()}
                      </div>
                    </div>
                    {isRoot && (
                      <span className="rounded-full bg-primary-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                        Root
                      </span>
                    )}
                  </div>
                  <div
                    className="chat-markdown mt-2 text-sm text-gray-700 dark:text-gray-200"
                    dangerouslySetInnerHTML={{ __html: buildPreview(message, workspaceEmoji) }}
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {footer && <div className="border-t border-gray-200 dark:border-gray-700">{footer}</div>}
    </aside>
  )
}
