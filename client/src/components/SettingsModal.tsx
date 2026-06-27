import { useState } from 'react'
import axios from 'axios'
import { XMarkIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import { usePreferencesStore } from '../store/preferencesStore'
import { useThemeStore } from '../store/themeStore'
import { useAuthStore } from '../store/authStore'
import { API_URL } from '../config/runtime'
import { subscribeToPush, unsubscribeFromPush, isIOS, isPWAInstalled, isPushNotificationSupported } from '../utils/pushNotifications'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  pushPermission: NotificationPermission
}

export default function SettingsModal({ isOpen, onClose, pushPermission }: SettingsModalProps) {
  const timeFormat = usePreferencesStore((state) => state.timeFormat)
  const dateFormat = usePreferencesStore((state) => state.dateFormat)
  const setTimeFormat = usePreferencesStore((state) => state.setTimeFormat)
  const setDateFormat = usePreferencesStore((state) => state.setDateFormat)
  const { autoCloseSidebarOnSelect, setAutoCloseSidebar } = useThemeStore()
  const { user } = useAuthStore()

  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [localTimeFormat, setLocalTimeFormat] = useState(timeFormat)
  const [localDateFormat, setLocalDateFormat] = useState(dateFormat)
  const [localAutoCloseSidebar, setLocalAutoCloseSidebar] = useState(autoCloseSidebarOnSelect)

  const twoFactorEnabled = !!user?.twoFactorEnabled
  const [twoFactorStep, setTwoFactorStep] = useState<'idle' | 'setup' | 'backup-codes' | 'disable'>('idle')
  const [twoFactorSetupData, setTwoFactorSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [disablePassword, setDisablePassword] = useState('')
  const [twoFactorLoading, setTwoFactorLoading] = useState(false)
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null)

  // The dedicated /2fa/* routes are the source of truth and already updated
  // the server - this just syncs the already-loaded client state to match,
  // no need to round-trip through the generic profile-update endpoint.
  const syncTwoFactorEnabled = (enabled: boolean) => {
    useAuthStore.setState((state) => {
      if (!state.user) return state
      const updatedUser = { ...state.user, twoFactorEnabled: enabled ? 1 : 0 }
      localStorage.setItem('user', JSON.stringify(updatedUser))
      return { user: updatedUser }
    })
  }

  const startTwoFactorSetup = async () => {
    setTwoFactorLoading(true)
    setTwoFactorError(null)
    try {
      const response = await axios.post(`${API_URL}/auth/2fa/setup`)
      setTwoFactorSetupData(response.data)
      setTwoFactorStep('setup')
    } catch (error) {
      console.error('2FA setup error:', error)
      setTwoFactorError('Failed to start two-factor setup. Please try again.')
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const confirmTwoFactorSetup = async () => {
    setTwoFactorLoading(true)
    setTwoFactorError(null)
    try {
      const response = await axios.post(`${API_URL}/auth/2fa/verify-setup`, { code: twoFactorCode })
      setBackupCodes(response.data.backupCodes)
      setTwoFactorStep('backup-codes')
      setTwoFactorCode('')
      syncTwoFactorEnabled(true)
    } catch (error) {
      console.error('2FA verify-setup error:', error)
      setTwoFactorError('Invalid code. Please check your authenticator app and try again.')
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const finishTwoFactorSetup = () => {
    setTwoFactorStep('idle')
    setTwoFactorSetupData(null)
    setBackupCodes([])
  }

  const disableTwoFactor = async () => {
    setTwoFactorLoading(true)
    setTwoFactorError(null)
    try {
      await axios.post(`${API_URL}/auth/2fa/disable`, { currentPassword: disablePassword })
      syncTwoFactorEnabled(false)
      setTwoFactorStep('idle')
      setDisablePassword('')
    } catch (error) {
      console.error('2FA disable error:', error)
      setTwoFactorError('Incorrect password. Please try again.')
    } finally {
      setTwoFactorLoading(false)
    }
  }

  const enablePush = async () => {
    if (!('Notification' in window)) {
      alert('Notifications are not supported in this browser.')
      return
    }

    // iOS-specific check
    if (isIOS()) {
      if (!isPWAInstalled()) {
        alert('Push notifications on iPhone require installing GWS Connect as an app:\n\n1. Open this page in Safari\n2. Tap the Share button\n3. Select "Add to Home Screen"\n4. Open the installed app and try enabling notifications again')
        return
      }
    }

    setPushLoading(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        return
      }
      await subscribeToPush()
      setPushEnabled(true)
    } catch (error) {
      console.error('Push subscribe error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to enable push notifications'
      alert(errorMessage)
    } finally {
      setPushLoading(false)
    }
  }

  const disablePush = async () => {
    setPushLoading(true)
    try {
      await unsubscribeFromPush()
      setPushEnabled(false)
    } catch (error) {
      console.error('Push unsubscribe error:', error)
      alert('Failed to disable push notifications')
    } finally {
      setPushLoading(false)
    }
  }

  const handleSave = async () => {
    setTimeFormat(localTimeFormat)
    setDateFormat(localDateFormat)
    setAutoCloseSidebar(localAutoCloseSidebar)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-4 py-4 sm:py-0 pointer-events-auto" onClick={(e) => {
      if (e.target === e.currentTarget) {
        onClose()
      }
    }}>
      <div className="w-full max-w-lg rounded-2xl sm:rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900 pointer-events-auto max-h-[90vh] overflow-y-auto mb-0 sm:mb-0">
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-white dark:bg-gray-900 -m-6 mb-4 p-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Settings</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 tap-highlight-none min-h-10 min-w-10 flex items-center justify-center -m-2 p-2"
            aria-label="Close settings modal"
            title="Close"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-5 pointer-events-auto">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Time format</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Switch between 12-hour and 24-hour timestamps.
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer pointer-events-auto min-h-10 min-w-12 flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={localTimeFormat === '24h'}
                onChange={(e) => setLocalTimeFormat(e.target.checked ? '24h' : '12h')}
                aria-label="Toggle 24-hour time format"
              />
              <span
                className={`w-11 h-6 rounded-full transition-colors ${
                  localTimeFormat === '24h' ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`block h-5 w-5 bg-white rounded-full shadow transform transition ${
                    localTimeFormat === '24h' ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Date format</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose how dates are displayed across the app.
              </p>
            </div>
            <select
              value={localDateFormat}
              onChange={(e) => setLocalDateFormat(e.target.value as typeof localDateFormat)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white pointer-events-auto min-h-10"
              aria-label="Date format"
            >
              <option value="MDY">MM/DD/YYYY</option>
              <option value="DMY">DD/MM/YYYY</option>
              <option value="YMD">YYYY-MM-DD</option>
            </select>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Auto-close sidebar</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Close sidebar after selecting a channel or chat (enables on mobile by default).
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer pointer-events-auto min-h-10 min-w-12 flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={localAutoCloseSidebar}
                onChange={(e) => setLocalAutoCloseSidebar(e.target.checked)}
                aria-label="Toggle auto-close sidebar"
              />
              <span
                className={`w-11 h-6 rounded-full transition-colors ${
                  localAutoCloseSidebar ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`block h-5 w-5 bg-white rounded-full shadow transform transition ${
                    localAutoCloseSidebar ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Notifications</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Receive device and in-app notifications for new messages.
              </p>
            </div>
            <label
              className={`inline-flex items-center pointer-events-auto min-h-10 min-w-12 flex-shrink-0 ${
                !isPushNotificationSupported() || pushLoading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={pushEnabled}
                disabled={!isPushNotificationSupported() || pushLoading || pushPermission === 'denied'}
                onChange={(e) => {
                  if (e.target.checked) {
                    void enablePush()
                  } else {
                    void disablePush()
                  }
                }}
                aria-label="Enable push notifications"
              />
              <span
                className={`w-11 h-6 rounded-full transition-colors ${
                  pushEnabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                } ${pushLoading ? 'opacity-60' : ''}`}
              >
                <span
                  className={`block h-5 w-5 bg-white rounded-full shadow transform transition ${
                    pushEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </label>
          </div>

          {pushPermission === 'denied' && (
            <div className="flex gap-3 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 p-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-600 dark:text-red-400">
                Notifications are blocked in your browser settings. Please enable them in Settings to receive notifications.
              </p>
            </div>
          )}

          {isIOS() && !isPWAInstalled() && (
            <div className="flex gap-3 rounded-lg border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 p-3">
              <InformationCircleIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-600 dark:text-blue-400">
                <p className="font-medium mb-1">iPhone: Install as App</p>
                <p className="text-xs leading-relaxed">
                  To enable notifications on iPhone, install GWS Connect as an app:
                </p>
                <ol className="list-decimal list-inside text-xs mt-1 space-y-0.5">
                  <li>Open in Safari</li>
                  <li>Tap Share button</li>
                  <li>Select "Add to Home Screen"</li>
                  <li>Enable notifications in the installed app</li>
                </ol>
              </div>
            </div>
          )}

          {!('Notification' in window) && (
            <div className="flex gap-3 rounded-lg border border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-900/20 p-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Notifications are not supported in this browser. Try using Chrome, Firefox, Edge, or Safari.
              </p>
            </div>
          )}

          <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Two-factor authentication</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {twoFactorEnabled
                    ? 'Enabled - your account requires an authenticator code at login.'
                    : 'Add an authenticator app code as a second login step.'}
                </p>
              </div>
              {twoFactorStep === 'idle' && (
                twoFactorEnabled ? (
                  <button
                    type="button"
                    onClick={() => { setTwoFactorStep('disable'); setTwoFactorError(null) }}
                    className="rounded-lg border border-red-300 dark:border-red-900/50 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-10"
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startTwoFactorSetup}
                    disabled={twoFactorLoading}
                    className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors min-h-10 disabled:opacity-60"
                  >
                    {twoFactorLoading ? 'Starting...' : 'Enable'}
                  </button>
                )
              )}
            </div>

            {twoFactorError && (
              <div className="mt-3 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {twoFactorError}
              </div>
            )}

            {twoFactorStep === 'setup' && twoFactorSetupData && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Scan this code with your authenticator app (Google Authenticator, Authy, etc.), or enter the secret manually.
                </p>
                <img
                  src={twoFactorSetupData.qrCodeDataUrl}
                  alt="Two-factor authentication QR code"
                  className="rounded-lg border border-gray-200 dark:border-gray-700 w-40 h-40"
                />
                <p className="font-mono text-xs break-all text-gray-600 dark:text-gray-400">
                  {twoFactorSetupData.secret}
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setTwoFactorStep('idle'); setTwoFactorSetupData(null); setTwoFactorCode('') }}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 min-h-10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmTwoFactorSetup}
                    disabled={twoFactorLoading || !twoFactorCode}
                    className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 min-h-10 disabled:opacity-60"
                  >
                    {twoFactorLoading ? 'Verifying...' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}

            {twoFactorStep === 'backup-codes' && (
              <div className="mt-4 space-y-3">
                <div className="flex gap-3 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Save these backup codes somewhere safe. Each one can be used once to log in if you lose access to your authenticator app. You won't see them again.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 font-mono text-sm text-gray-900 dark:text-white">
                  {backupCodes.map((backupCode) => (
                    <span key={backupCode}>{backupCode}</span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={finishTwoFactorSetup}
                  className="w-full rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 min-h-10"
                >
                  I've saved these codes
                </button>
              </div>
            )}

            {twoFactorStep === 'disable' && (
              <div className="mt-4 space-y-3">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Current password"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setTwoFactorStep('idle'); setDisablePassword('') }}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 min-h-10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={disableTwoFactor}
                    disabled={twoFactorLoading || !disablePassword}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 min-h-10 disabled:opacity-60"
                  >
                    {twoFactorLoading ? 'Disabling...' : 'Disable two-factor authentication'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-white dark:bg-gray-900 -m-6 mt-6 p-6 pt-4 border-t border-gray-200 dark:border-gray-700 pointer-events-auto">
          <button
            onClick={onClose}
            className="px-4 py-3 sm:py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors min-h-12 sm:min-h-auto font-medium tap-highlight-none pointer-events-auto"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-3 sm:py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors min-h-12 sm:min-h-auto font-medium tap-highlight-none pointer-events-auto"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
