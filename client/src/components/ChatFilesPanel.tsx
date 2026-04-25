import { usePreferencesStore } from '../store/preferencesStore'
import { formatDate } from '../utils/dateFormat'

interface SharedFileItem {
  id: string
  fileUrl: string
  fileName: string
  fileType: string
  timestamp: string
  senderName: string
  senderAvatar?: string
}

interface ChatFilesPanelProps {
  files: SharedFileItem[]
  authToken?: string | null
  onOpenMedia?: (payload: { url: string; type: 'image' | 'video'; name?: string }) => void
  onOpenDocument?: (payload: { url: string; type: 'document'; name?: string; mime?: string }) => void
}

export default function ChatFilesPanel({ files, authToken, onOpenMedia, onOpenDocument }: ChatFilesPanelProps) {
  const dateFormat = usePreferencesStore((state) => state.dateFormat)
  const buildUrl = (url: string) => {
    if (!authToken || !url.startsWith('/api/messages/file/')) return url
    const joiner = url.includes('?') ? '&' : '?'
    return `${url}${joiner}token=${encodeURIComponent(authToken)}`
  }
  const media = files.filter((file) => file.fileType?.startsWith('image/') || file.fileType?.startsWith('video/'))
  const docs = files.filter((file) => !file.fileType?.startsWith('image/') && !file.fileType?.startsWith('video/'))

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      {media.length === 0 && docs.length === 0 && (
        <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
          No shared files yet.
        </div>
      )}

      {media.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Media</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {media.map((file) => (
              <a
                key={file.id}
                href={buildUrl(file.fileUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900"
                onClick={(event) => {
                  if (!onOpenMedia) return
                  event.preventDefault()
                  const type = file.fileType.startsWith('image/') ? 'image' : 'video'
                  onOpenMedia({ url: buildUrl(file.fileUrl), type, name: file.fileName })
                }}
              >
                {file.fileType.startsWith('image/') ? (
                  <img src={buildUrl(file.fileUrl)} alt={file.fileName} className="w-full h-32 object-cover" />
                ) : (
                  <video src={buildUrl(file.fileUrl)} className="w-full h-32 object-cover" controls />
                )}
                <div className="p-2">
                  <div className="text-xs text-gray-600 dark:text-gray-300 truncate">{file.fileName}</div>
                  <div className="text-[11px] text-gray-400">{file.senderName}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Documents</h3>
          <div className="space-y-2">
            {docs.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() =>
                  onOpenDocument?.({
                    url: buildUrl(file.fileUrl),
                    type: 'document',
                    name: file.fileName,
                    mime: file.fileType,
                  })
                }
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
              >
                <div>
                  <div className="text-sm text-gray-900 dark:text-white">{file.fileName}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Shared by {file.senderName}</div>
                </div>
                <span className="text-xs text-gray-400">{formatDate(new Date(file.timestamp), dateFormat)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
