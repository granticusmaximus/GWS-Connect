import { useState } from 'react'
import { XMarkIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import { usePreferencesStore } from '../store/preferencesStore'
import { useThemeStore } from '../store/themeStore'
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

  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [localTimeFormat, setLocalTimeFormat] = useState(timeFormat)
  const [localDateFormat, setLocalDateFormat] = useState(dateFormat)
  const [localAutoCloseSidebar, setLocalAutoCloseSidebar] = useState(autoCloseSidebarOnSelect)

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
