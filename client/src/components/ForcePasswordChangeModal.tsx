import { useState } from 'react'

interface ForcePasswordChangeModalProps {
  isOpen: boolean
  onSave: (currentPassword: string, newPassword: string) => Promise<void>
  loading: boolean
  error?: string | null
  e2eeKeyRecoveryNeeded?: boolean
}

const isStrongPassword = (value: string) =>
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(value)

export default function ForcePasswordChangeModal({
  isOpen,
  onSave,
  loading,
  error,
  e2eeKeyRecoveryNeeded,
}: ForcePasswordChangeModalProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false)

  if (!isOpen) return null

  const handleSave = async () => {
    setLocalError(null)

    if (!currentPassword || !newPassword) {
      setLocalError('Please fill in all fields')
      return
    }
    if (newPassword !== confirmPassword) {
      setLocalError('Passwords do not match')
      return
    }
    if (!isStrongPassword(newPassword)) {
      setLocalError(
        'Password must be at least 8 characters and include letters, numbers, and a special character',
      )
      return
    }

    await onSave(currentPassword, newPassword)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Update Your Password
        </h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Your account was created with a temporary password. Please set a new
          password to continue.
        </p>

        {(localError || error) && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
            {localError || error}
          </div>
        )}

        {e2eeKeyRecoveryNeeded && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200">
            <p className="font-semibold">Encryption key cannot be recovered</p>
            <p className="mt-1">
              Your previous encryption key cannot be unlocked because your
              password was reset. Continuing will generate a new encryption
              key. <strong>You will permanently lose access to any
              previously end-to-end encrypted messages</strong> — this
              cannot be undone.
            </p>
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={recoveryAcknowledged}
                onChange={(e) => setRecoveryAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>I understand and want to continue.</span>
            </label>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <input
            type="password"
            placeholder="Current temporary password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || (e2eeKeyRecoveryNeeded && !recoveryAcknowledged)}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm disabled:opacity-60"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
