import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '../store/notificationStore'
import { useChatStore } from '../store/chatStore'

export default function ToastContainer() {
  const navigate = useNavigate()
  const { setActiveChannel, setActiveDM, setActiveGroupChat, setMessageFocusTarget, loadMessageById } = useChatStore()
  const { toasts, removeToast } = useNotificationStore()

  useEffect(() => {
    const timers = toasts.map((toast) =>
      setTimeout(() => removeToast(toast.id), 6000)
    )

    return () => {
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [toasts, removeToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => {
            if (toast.target) {
              if (toast.target.type === 'channel') {
                setActiveChannel(toast.target.id)
              } else if (toast.target.type === 'group') {
                setActiveGroupChat(toast.target.id)
              } else {
                setActiveDM(toast.target.id)
              }
              if (toast.target.messageId) {
                setMessageFocusTarget({
                  chatType: toast.target.type,
                  chatId: toast.target.id,
                  messageId: toast.target.messageId,
                })
                void loadMessageById(toast.target.messageId)
              }
              navigate('/dashboard')
            }
            removeToast(toast.id)
          }}
          className="w-80 max-w-[85vw] text-left rounded-lg shadow-lg border border-gray-200/70 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-4 py-3 transition hover:shadow-xl"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {toast.title}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">now</span>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            {toast.body}
          </div>
        </button>
      ))}
    </div>
  )
}
