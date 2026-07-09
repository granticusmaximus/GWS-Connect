import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { XMarkIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import { usePreferencesStore } from '../store/preferencesStore'
import { formatDateTime } from '../utils/dateFormat'
import { useThemeStore } from '../store/themeStore'
import { useAuthStore } from '../store/authStore'
import { API_URL } from '../config/runtime'
import { getActiveCustomStatus, toDateTimeLocalValue } from '../utils/userStatus'
import { subscribeToPush, unsubscribeFromPush, isIOS, isPWAInstalled, isPushNotificationSupported } from '../utils/pushNotifications'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  pushPermission: NotificationPermission
}

export default function SettingsModal({ isOpen, onClose, pushPermission }: SettingsModalProps) {
  const resolveActiveDndUntil = (value?: string | null) => {
    if (!value) {
      return null
    }

    const dndUntil = new Date(value).getTime()
    if (Number.isNaN(dndUntil) || dndUntil <= Date.now()) {
      return null
    }

    return value
  }

  const resolveDndDurationMinutes = (value?: string | null) => {
    const activeDndUntil = resolveActiveDndUntil(value)
    if (!activeDndUntil) {
      return '60'
    }

    const minutesRemaining = Math.max(
      1,
      Math.round((new Date(activeDndUntil).getTime() - Date.now()) / 60000),
    )

    if (minutesRemaining <= 90) {
      return '60'
    }
    if (minutesRemaining <= 720) {
      return '480'
    }

    return '1440'
  }

  const timeFormat = usePreferencesStore((state) => state.timeFormat)
  const dateFormat = usePreferencesStore((state) => state.dateFormat)
  const setTimeFormat = usePreferencesStore((state) => state.setTimeFormat)
  const setDateFormat = usePreferencesStore((state) => state.setDateFormat)
  const { autoCloseSidebarOnSelect, setAutoCloseSidebar } = useThemeStore()
  const { user, deleteAccount, updateProfile, updateStatus, updateDnd } = useAuthStore()
  const navigate = useNavigate()
  const initialStatus = getActiveCustomStatus(user)
  const initialDndUntil = resolveActiveDndUntil(user?.dndUntil)

  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [localTimeFormat, setLocalTimeFormat] = useState(timeFormat)
  const [localDateFormat, setLocalDateFormat] = useState(dateFormat)
  const [localAutoCloseSidebar, setLocalAutoCloseSidebar] = useState(autoCloseSidebarOnSelect)
  const [localAppearOffline, setLocalAppearOffline] = useState(Boolean(user?.appearOffline))
  const [localStatusEmoji, setLocalStatusEmoji] = useState(initialStatus?.statusEmoji || '')
  const [localStatusText, setLocalStatusText] = useState(initialStatus?.statusText || '')
  const [localStatusClearsAt, setLocalStatusClearsAt] = useState(
    toDateTimeLocalValue(initialStatus?.statusClearsAt || null),
  )
  const [localDndEnabled, setLocalDndEnabled] = useState(Boolean(initialDndUntil))
  const [localDndDurationMinutes, setLocalDndDurationMinutes] = useState(
    resolveDndDurationMinutes(initialDndUntil),
  )
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

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

  interface UserSession {
    id: number
    userAgent: string
    ipAddress: string
    createdAt: string
    lastSeenAt: string
    isCurrent: boolean
  }

  const [sessions, setSessions] = useState<UserSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [revokingSessionId, setRevokingSessionId] = useState<number | null>(null)

  const loadSessions = async () => {
    setSessionsLoading(true)
    setSessionsError(null)
    try {
      const response = await axios.get(`${API_URL}/auth/sessions`)
      setSessions(response.data)
    } catch (error) {
      console.error('Load sessions error:', error)
      setSessionsError('Failed to load active sessions.')
    } finally {
      setSessionsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      const activeStatus = getActiveCustomStatus(user)
      const activeDndUntil = resolveActiveDndUntil(user?.dndUntil)
      setLocalTimeFormat(timeFormat)
      setLocalDateFormat(dateFormat)
      setLocalAutoCloseSidebar(autoCloseSidebarOnSelect)
      setLocalAppearOffline(Boolean(user?.appearOffline))
      setLocalStatusEmoji(activeStatus?.statusEmoji || '')
      setLocalStatusText(activeStatus?.statusText || '')
      setLocalStatusClearsAt(toDateTimeLocalValue(activeStatus?.statusClearsAt || null))
      setLocalDndEnabled(Boolean(activeDndUntil))
      setLocalDndDurationMinutes(resolveDndDurationMinutes(activeDndUntil))
      setSettingsError(null)
      void loadSessions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, timeFormat, dateFormat, autoCloseSidebarOnSelect, user])

  const revokeSession = async (sessionId: number) => {
    setRevokingSessionId(sessionId)
    try {
      await axios.delete(`${API_URL}/auth/sessions/${sessionId}`)
      setSessions((prev) => prev.filter((session) => session.id !== sessionId))
    } catch (error) {
      console.error('Revoke session error:', error)
      setSessionsError('Failed to revoke that session.')
    } finally {
      setRevokingSessionId(null)
    }
  }

  const revokeOtherSessions = async () => {
    setSessionsLoading(true)
    try {
      await axios.delete(`${API_URL}/auth/sessions`)
      setSessions((prev) => prev.filter((session) => session.isCurrent))
    } catch (error) {
      console.error('Revoke other sessions error:', error)
      setSessionsError('Failed to log out other devices.')
    } finally {
      setSessionsLoading(false)
    }
  }

  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm'>('idle')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteCode, setDeleteCode] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleDeleteAccount = async () => {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await deleteAccount(deletePassword, twoFactorEnabled ? deleteCode : undefined)
      navigate('/login')
    } catch (error) {
      console.error('Delete account error:', error)
      setDeleteError('Failed to delete account. Check your password and code, then try again.')
    } finally {
      setDeleteLoading(false)
    }
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
    setSettingsSaving(true)
    setSettingsError(null)

    try {
      const statusEmoji = localStatusEmoji.trim() || null
      const statusText = localStatusText.trim() || null
      let statusClearsAt: string | null = null

      if (localStatusClearsAt && (statusEmoji || statusText)) {
        const parsedClearsAt = new Date(localStatusClearsAt)
        if (Number.isNaN(parsedClearsAt.getTime())) {
          setSettingsError('Please choose a valid status clear time.')
          setSettingsSaving(false)
          return
        }
        if (parsedClearsAt.getTime() <= Date.now()) {
          setSettingsError('Status clear time must be in the future.')
          setSettingsSaving(false)
          return
        }
        statusClearsAt = parsedClearsAt.toISOString()
      }

      await updateStatus({
        statusEmoji,
        statusText,
        statusClearsAt: statusEmoji || statusText ? statusClearsAt : null,
      })

      await updateDnd({
        dndUntil: localDndEnabled
          ? new Date(Date.now() + Number(localDndDurationMinutes) * 60000).toISOString()
          : null,
      })

      if (Boolean(user?.appearOffline) !== localAppearOffline) {
        await updateProfile({ appearOffline: localAppearOffline ? 1 : 0 })
      }

      setTimeFormat(localTimeFormat)
      setDateFormat(localDateFormat)
      setAutoCloseSidebar(localAutoCloseSidebar)
      onClose()
    } catch (error) {
      console.error('Settings save error:', error)
      setSettingsError('Failed to save settings. Please try again.')
    } finally {
      setSettingsSaving(false)
    }
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
              <p className="text-sm font-medium text-gray-900 dark:text-white">Appear offline</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Hide your online indicator from other users while staying connected.
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer pointer-events-auto min-h-10 min-w-12 flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={localAppearOffline}
                onChange={(e) => setLocalAppearOffline(e.target.checked)}
                aria-label="Toggle appear offline"
              />
              <span
                className={`w-11 h-6 rounded-full transition-colors ${
                  localAppearOffline ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`block h-5 w-5 bg-white rounded-full shadow transform transition ${
                    localAppearOffline ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </label>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Custom status</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Add a short status message that appears in direct messages and profile hover cards.
                </p>
              </div>
              {(localStatusEmoji || localStatusText || localStatusClearsAt) && (
                <button
                  type="button"
                  onClick={() => {
                    setLocalStatusEmoji('')
                    setLocalStatusText('')
                    setLocalStatusClearsAt('')
                  }}
                  className="rounded-lg border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                value={localStatusEmoji}
                onChange={(e) => setLocalStatusEmoji(e.target.value)}
                placeholder="🙂"
                maxLength={16}
                className="w-20 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-center text-lg text-gray-900 dark:text-white"
                aria-label="Status emoji"
              />
              <input
                type="text"
                value={localStatusText}
                onChange={(e) => setLocalStatusText(e.target.value)}
                placeholder="What are you up to?"
                maxLength={80}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                aria-label="Status text"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                Clear status at
              </label>
              <input
                type="datetime-local"
                value={localStatusClearsAt}
                onChange={(e) => setLocalStatusClearsAt(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                aria-label="Status clear time"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Leave blank to keep the status until you clear or replace it.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Do Not Disturb</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Suppress push notifications on this account until DND expires or you turn it off.
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer pointer-events-auto min-h-10 min-w-12 flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={localDndEnabled}
                onChange={(e) => setLocalDndEnabled(e.target.checked)}
                aria-label="Toggle do not disturb"
              />
              <span
                className={`w-11 h-6 rounded-full transition-colors ${
                  localDndEnabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`block h-5 w-5 bg-white rounded-full shadow transform transition ${
                    localDndEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </label>
          </div>

          {localDndEnabled && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/60 p-4 space-y-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                DND duration
              </label>
              <select
                value={localDndDurationMinutes}
                onChange={(e) => setLocalDndDurationMinutes(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                aria-label="DND duration"
              >
                <option value="60">1 hour</option>
                <option value="480">8 hours</option>
                <option value="1440">24 hours</option>
              </select>
              {initialDndUntil && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Currently active until {formatDateTime(new Date(initialDndUntil), dateFormat, timeFormat)}.
                </p>
              )}
            </div>
          )}

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

          <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Active sessions</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Devices and browsers currently signed in to your account.
                </p>
              </div>
              {sessions.some((session) => !session.isCurrent) && (
                <button
                  type="button"
                  onClick={revokeOtherSessions}
                  disabled={sessionsLoading}
                  className="rounded-lg border border-red-300 dark:border-red-900/50 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-10 disabled:opacity-60"
                >
                  Log out other devices
                </button>
              )}
            </div>

            {sessionsError && (
              <div className="mt-3 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {sessionsError}
              </div>
            )}

            {sessionsLoading && sessions.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading sessions...</p>
            ) : (
              <div className="mt-3 space-y-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 dark:text-white truncate max-w-xs">
                        {session.userAgent || 'Unknown device'}
                        {session.isCurrent && (
                          <span className="ml-2 rounded-full bg-primary-100 dark:bg-primary-900/40 px-2 py-0.5 text-xs font-medium text-primary-700 dark:text-primary-300">
                            This device
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {session.ipAddress} · Last active {formatDateTime(new Date(session.lastSeenAt), dateFormat, timeFormat)}
                      </p>
                    </div>
                    {!session.isCurrent && (
                      <button
                        type="button"
                        onClick={() => revokeSession(session.id)}
                        disabled={revokingSessionId === session.id}
                        className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
                      >
                        {revokingSessionId === session.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">Danger zone</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Permanently deletes your login credentials and personal data. Channels, groups, and messages you've shared with others are not removed - they'll just show as posted by "Deleted User."
            </p>

            {deleteStep === 'idle' && (
              <button
                type="button"
                onClick={() => { setDeleteStep('confirm'); setDeleteError(null) }}
                className="mt-3 rounded-lg border border-red-300 dark:border-red-900/50 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-10"
              >
                Delete account
              </button>
            )}

            {deleteStep === 'confirm' && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-3 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 p-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-300">
                    This cannot be undone. You will be permanently signed out of every device.
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    Type <span className="font-mono font-semibold">{user?.username}</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={user?.username}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  />
                </div>

                <input
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Current password"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                />

                {twoFactorEnabled && (
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    value={deleteCode}
                    onChange={(e) => setDeleteCode(e.target.value)}
                    placeholder="Authentication code or backup code"
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  />
                )}

                {deleteError && (
                  <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                    {deleteError}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteStep('idle')
                      setDeleteConfirmText('')
                      setDeletePassword('')
                      setDeleteCode('')
                      setDeleteError(null)
                    }}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 min-h-10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={
                      deleteLoading ||
                      deleteConfirmText !== user?.username ||
                      !deletePassword ||
                      (twoFactorEnabled && !deleteCode)
                    }
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 min-h-10 disabled:opacity-60"
                  >
                    {deleteLoading ? 'Deleting...' : 'Permanently delete my account'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {settingsError && (
          <div className="mt-4 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {settingsError}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-white dark:bg-gray-900 -m-6 mt-6 p-6 pt-4 border-t border-gray-200 dark:border-gray-700 pointer-events-auto">
          <button
            onClick={onClose}
            className="px-4 py-3 sm:py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors min-h-12 sm:min-h-auto font-medium tap-highlight-none pointer-events-auto"
            disabled={settingsSaving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-3 sm:py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors min-h-12 sm:min-h-auto font-medium tap-highlight-none pointer-events-auto"
            disabled={settingsSaving}
          >
            {settingsSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
