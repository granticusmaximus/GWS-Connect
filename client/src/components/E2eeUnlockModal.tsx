import { useState } from 'react'

interface E2eeUnlockModalProps {
  isOpen: boolean
  loading?: boolean
  onUnlock: (password: string) => Promise<boolean>
}

export default function E2eeUnlockModal({ isOpen, loading = false, onUnlock }: E2eeUnlockModalProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleUnlock = async () => {
    if (!password) {
      setError('Enter your password to unlock encrypted messages.')
      return
    }

    setError(null)
    const unlocked = await onUnlock(password)
    if (!unlocked) {
      setError('Unable to unlock encryption key. Check your password and try again.')
      return
    }

    setPassword('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Unlock End-to-End Encryption
        </h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Your encrypted key is locked in this browser session. Enter your account password to send and read encrypted messages.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4">
          <input
            type="password"
            placeholder="Account password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleUnlock()
              }
            }}
          />
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => void handleUnlock()}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm disabled:opacity-60"
          >
            {loading ? 'Unlocking...' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}
