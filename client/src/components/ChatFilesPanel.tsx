import { useEffect, useState } from 'react'
import { usePreferencesStore } from '../store/preferencesStore'
import { formatDate } from '../utils/dateFormat'
import { resolveAttachment, type ResolvedAttachment } from '../store/chatStore'

interface SharedFileItem {
  id: string
  fileUrl: string
  fileName: string
  fileType: string
  fileIv?: string | null
  cipherIv?: string | null
  isEncrypted?: number | boolean
  timestamp: string
  senderName: string
  senderAvatar?: string
}

interface ConversationContext {
  channelId?: string | null
  recipientId?: string | null
  groupChatId?: string | null
}

interface ChatFilesPanelProps {
  files: SharedFileItem[]
  conversationContext: ConversationContext
  onOpenMedia?: (payload: { url: string; type: 'image' | 'video'; name?: string }) => void
  onOpenDocument?: (payload: { url: string; type: 'document'; name?: string; mime?: string }) => void
}

interface ResolvedFileItem extends SharedFileItem {
  resolved?: ResolvedAttachment
  resolveError?: string
}

export default function ChatFilesPanel({ files, conversationContext, onOpenMedia, onOpenDocument }: ChatFilesPanelProps) {
  const dateFormat = usePreferencesStore((state) => state.dateFormat)
  const [resolvedFiles, setResolvedFiles] = useState<ResolvedFileItem[]>([])

  useEffect(() => {
    let cancelled = false

    Promise.all(
      files.map(async (file) => {
        try {
          const resolved = await resolveAttachment(file, conversationContext)
          return { ...file, resolved }
        } catch (error) {
          return { ...file, resolveError: error instanceof Error ? error.message : 'Failed to load' }
        }
      }),
    ).then((results) => {
      if (!cancelled) setResolvedFiles(results)
    })

    return () => {
      cancelled = true
    }
  }, [files, conversationContext])

  const media = resolvedFiles.filter((file) => file.resolved?.type.startsWith('image/') || file.resolved?.type.startsWith('video/'))
  const docs = resolvedFiles.filter((file) => file.resolved && !file.resolved.type.startsWith('image/') && !file.resolved.type.startsWith('video/'))
  const failed = resolvedFiles.filter((file) => file.resolveError)

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      {media.length === 0 && docs.length === 0 && failed.length === 0 && (
        <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
          No shared files yet.
        </div>
      )}

      {media.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Media</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {media.map((file) => {
              const resolved = file.resolved as ResolvedAttachment
              const type = resolved.type.startsWith('image/') ? 'image' : 'video'
              return (
                <button
                  key={file.id}
                  type="button"
                  className="group rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900 text-left"
                  onClick={() => onOpenMedia?.({ url: resolved.url, type, name: resolved.name })}
                >
                  {type === 'image' ? (
                    <img src={resolved.url} alt={resolved.name} className="w-full h-32 object-cover" />
                  ) : (
                    <video src={resolved.url} className="w-full h-32 object-cover" controls />
                  )}
                  <div className="p-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300 truncate">{resolved.name}</div>
                    <div className="text-[11px] text-gray-400">{file.senderName}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Documents</h3>
          <div className="space-y-2">
            {docs.map((file) => {
              const resolved = file.resolved as ResolvedAttachment
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() =>
                    onOpenDocument?.({
                      url: resolved.url,
                      type: 'document',
                      name: resolved.name,
                      mime: resolved.type,
                    })
                  }
                  className="flex w-full items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                >
                  <div>
                    <div className="text-sm text-gray-900 dark:text-white">{resolved.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Shared by {file.senderName}</div>
                  </div>
                  <span className="text-xs text-gray-400">{formatDate(new Date(file.timestamp), dateFormat)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div className="text-xs text-red-500 dark:text-red-400">
          {failed.length} file{failed.length > 1 ? 's' : ''} could not be decrypted.
        </div>
      )}
    </div>
  )
}
