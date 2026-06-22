import { useEffect, useRef } from 'react'
import { useCallStore } from '../store/callStore'
import {
  MicrophoneIcon,
  PhoneXMarkIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/solid'

function VideoTile({ stream, label, muted = false }: { stream: MediaStream | null; label: string; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="relative h-24 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-gray-800">
      <video ref={videoRef} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        {label}
      </span>
    </div>
  )
}

export default function CallBar() {
  const {
    activeCallId,
    localStream,
    participants,
    isMuted,
    isCameraOff,
    isScreenSharing,
    isConnecting,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    leaveCall,
  } = useCallStore()

  if (!activeCallId && !isConnecting) return null

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 overflow-x-auto border-b border-gray-200 bg-gray-900 px-4 py-2 dark:border-gray-700">
      {isConnecting ? (
        <span className="text-sm text-gray-300">Connecting...</span>
      ) : (
        <>
          <VideoTile stream={localStream} label="You" muted />
          {Object.values(participants).map((participant) => (
            <VideoTile key={participant.userId} stream={participant.stream} label={participant.username} />
          ))}

          <div className="ml-auto flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleMute}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                isMuted ? 'bg-red-500 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              }`}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <MicrophoneIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleCamera}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                isCameraOff ? 'bg-red-500 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              }`}
              aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
              title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
            >
              {isCameraOff ? <VideoCameraSlashIcon className="h-4 w-4" /> : <VideoCameraIcon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void toggleScreenShare()}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                isScreenSharing ? 'bg-primary-500 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              }`}
              aria-label={isScreenSharing ? 'Stop screen share' : 'Share screen'}
              title={isScreenSharing ? 'Stop screen share' : 'Share screen'}
            >
              <ComputerDesktopIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={leaveCall}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700"
              aria-label="Leave call"
              title="Leave call"
            >
              <PhoneXMarkIcon className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
