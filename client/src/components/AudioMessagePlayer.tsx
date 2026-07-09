import { SpeakerWaveIcon } from '@heroicons/react/24/outline'

interface AudioMessagePlayerProps {
  url: string
  name?: string
}

export default function AudioMessagePlayer({ url, name = 'Voice message' }: AudioMessagePlayerProps) {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
        <SpeakerWaveIcon className="h-4 w-4" />
        Audio clip
      </div>
      <div className="text-sm font-medium text-gray-900 dark:text-white">
        {name}
      </div>
      <audio src={url} controls className="mt-3 w-full" preload="metadata" />
    </div>
  )
}
