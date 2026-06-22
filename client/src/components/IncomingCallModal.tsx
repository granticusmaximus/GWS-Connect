import { useCallStore } from '../store/callStore'
import { PhoneIcon, VideoCameraIcon, XMarkIcon } from '@heroicons/react/24/solid'

export default function IncomingCallModal() {
  const { incomingCall, acceptIncomingCall, declineIncomingCall } = useCallStore()

  if (!incomingCall) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-gray-900">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
          {incomingCall.withVideo ? (
            <VideoCameraIcon className="h-8 w-8 text-primary-600 dark:text-primary-300" />
          ) : (
            <PhoneIcon className="h-8 w-8 text-primary-600 dark:text-primary-300" />
          )}
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {incomingCall.fromUsername}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Incoming {incomingCall.withVideo ? 'video' : 'voice'} call...
        </p>
        <div className="mt-6 flex justify-center gap-4">
          <button
            type="button"
            onClick={declineIncomingCall}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-600"
            aria-label="Decline call"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() => void acceptIncomingCall()}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-white transition hover:bg-green-600"
            aria-label="Accept call"
          >
            <PhoneIcon className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  )
}
