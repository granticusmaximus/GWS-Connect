import { useEffect, useState } from 'react'

interface ScheduleMessagePickerProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (deliverAt: string) => Promise<void> | void
}

const buildDefaultValue = () => {
  const nextHour = new Date(Date.now() + 60 * 60 * 1000)
  const timezoneOffset = nextHour.getTimezoneOffset() * 60000
  return new Date(nextHour.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

export default function ScheduleMessagePicker({
  isOpen,
  onClose,
  onConfirm,
}: ScheduleMessagePickerProps) {
  const [deliverAt, setDeliverAt] = useState(buildDefaultValue())

  useEffect(() => {
    if (isOpen) {
      setDeliverAt(buildDefaultValue())
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
        <div className="text-lg font-semibold text-gray-900 dark:text-white">
          Schedule Message
        </div>
        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Pick when this message should be delivered.
        </div>

        <input
          type="datetime-local"
          value={deliverAt}
          onChange={(event) => setDeliverAt(event.target.value)}
          className="mt-4 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm(new Date(deliverAt).toISOString())}
            disabled={!deliverAt}
            className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-60"
          >
            Schedule
          </button>
        </div>
      </div>
    </div>
  )
}
