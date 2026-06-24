import { useEffect, useState } from 'react'
import { ClipboardIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useChatStore, type InviteLink } from '../store/chatStore'

interface InviteModalProps {
  isOpen: boolean
  onClose: () => void
  targetType: 'channel' | 'group'
  targetId: string
  targetName: string
}

export default function InviteModal({ isOpen, onClose, targetType, targetId, targetName }: InviteModalProps) {
  const { createInviteLink, listInviteLinks, revokeInviteLink } = useChatStore()
  const [invites, setInvites] = useState<InviteLink[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [expiresInHours, setExpiresInHours] = useState<string>('24')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    const result = await listInviteLinks(targetType, targetId)
    setInvites(result)
    setLoading(false)
  }

  useEffect(() => {
    if (isOpen) {
      void refresh()
    }
  }, [isOpen])

  if (!isOpen) return null

  const buildInviteUrl = (code: string) => `${window.location.origin}/invite/${code}`

  const handleCreate = async () => {
    setCreating(true)
    const hours = expiresInHours ? Number(expiresInHours) : undefined
    const invite = await createInviteLink(targetType, targetId, hours ? { expiresInHours: hours } : undefined)
    setCreating(false)
    if (invite) {
      setInvites((current) => [invite, ...current])
    }
  }

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(buildInviteUrl(code))
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 1500)
  }

  const handleRevoke = async (inviteId: string) => {
    const ok = await revokeInviteLink(inviteId)
    if (ok) {
      setInvites((current) => current.filter((invite) => invite.id !== inviteId))
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Invite people to {targetName}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Expires
              </label>
              <select
                aria-label="Invite expiry"
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
                className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border-none rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white"
              >
                <option value="1">1 hour</option>
                <option value="24">1 day</option>
                <option value="168">7 days</option>
                <option value="">Never</option>
              </select>
            </div>
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'New Link'}
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-2">
            {loading ? (
              <div className="text-center py-4 text-gray-500 dark:text-gray-400">Loading...</div>
            ) : invites.length === 0 ? (
              <div className="text-center py-4 text-gray-500 dark:text-gray-400">No active invite links</div>
            ) : (
              invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-mono text-gray-900 dark:text-white">
                      {buildInviteUrl(invite.code)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {invite.useCount} use{invite.useCount === 1 ? '' : 's'}
                      {invite.maxUses ? ` / ${invite.maxUses}` : ''}
                      {invite.expiresAt ? ` · expires ${new Date(invite.expiresAt).toLocaleString()}` : ' · never expires'}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleCopy(invite.code)}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    aria-label="Copy invite link"
                    title={copiedCode === invite.code ? 'Copied!' : 'Copy link'}
                  >
                    <ClipboardIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  </button>
                  <button
                    onClick={() => void handleRevoke(invite.id)}
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                    aria-label="Revoke invite link"
                  >
                    <TrashIcon className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
