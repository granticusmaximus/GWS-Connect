import { useState, useEffect } from 'react'
import { XMarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'

interface PollCreateModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (payload: { question: string; options: string[]; durationMinutes?: number }) => void
  initialQuestion?: string
}

export default function PollCreateModal({
  isOpen,
  onClose,
  onCreate,
  initialQuestion = '',
}: PollCreateModalProps) {
  const [question, setQuestion] = useState(initialQuestion)
  const [options, setOptions] = useState<string[]>(['', ''])
  const [durationMinutes, setDurationMinutes] = useState('')

  useEffect(() => {
    if (isOpen) {
      setQuestion(initialQuestion)
      setOptions(['', ''])
      setDurationMinutes('')
    }
  }, [isOpen, initialQuestion])

  if (!isOpen) return null

  const updateOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((opt, idx) => (idx === index ? value : opt)))
  }

  const addOption = () => {
    setOptions((prev) => [...prev, ''])
  }

  const removeOption = (index: number) => {
    setOptions((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleSubmit = () => {
    const trimmedQuestion = question.trim()
    const trimmedOptions = options.map((opt) => opt.trim()).filter(Boolean)
    if (!trimmedQuestion || trimmedOptions.length < 2) return

    const duration = Number(durationMinutes)
    onCreate({
      question: trimmedQuestion,
      options: trimmedOptions,
      durationMinutes: durationMinutes ? duration : undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create Poll</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Question</label>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Ask your question"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Options</label>
              <button
                onClick={addOption}
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
                type="button"
              >
                <PlusIcon className="w-4 h-4" />
                Add option
              </button>
            </div>

            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={`Option ${index + 1}`}
                />
                {options.length > 2 && (
                  <button
                    onClick={() => removeOption(index)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    type="button"
                    aria-label="Remove option"
                  >
                    <TrashIcon className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Time limit (minutes, optional)
            </label>
            <input
              type="number"
              min="1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Leave blank for no limit"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white"
          >
            Create Poll
          </button>
        </div>
      </div>
    </div>
  )
}
