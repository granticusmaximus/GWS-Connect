import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChatStore, type InvitePreview } from '../store/chatStore'
import { UserGroupIcon, HashtagIcon } from '@heroicons/react/24/outline'

export default function InvitePage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { previewInvite, redeemInvite, setActiveChannel, setActiveGroupChat } = useChatStore()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!code) return
    void (async () => {
      setLoading(true)
      const result = await previewInvite(code)
      if (!result) {
        setError('This invite link is invalid or has expired.')
      }
      setPreview(result)
      setLoading(false)
    })()
  }, [code])

  const handleJoin = async () => {
    if (!code) return
    setJoining(true)
    const result = await redeemInvite(code)
    setJoining(false)

    if (!result) {
      setError('Failed to join. The invite link may have expired.')
      return
    }

    if (result.targetType === 'channel') {
      setActiveChannel(result.targetId)
    } else {
      setActiveGroupChat(result.targetId)
    }
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-800 shadow-xl p-6 text-center">
        {loading ? (
          <p className="text-gray-500 dark:text-gray-400">Loading invite...</p>
        ) : error ? (
          <>
            <p className="text-red-500 mb-4">{error}</p>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white"
            >
              Back to dashboard
            </button>
          </>
        ) : preview ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
              {preview.targetType === 'channel' ? (
                <HashtagIcon className="w-7 h-7 text-primary-600 dark:text-primary-300" />
              ) : (
                <UserGroupIcon className="w-7 h-7 text-primary-600 dark:text-primary-300" />
              )}
            </div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              You've been invited to {preview.targetType === 'channel' ? '#' : ''}{preview.name}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {preview.targetType === 'channel' ? 'Join this channel' : 'Join this group chat'} on GWS Connect
            </p>
            <button
              onClick={() => void handleJoin()}
              disabled={joining}
              className="w-full px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50"
            >
              {joining ? 'Joining...' : 'Accept Invite'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
