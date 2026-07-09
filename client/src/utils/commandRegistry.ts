import type { ComponentType, SVGProps } from 'react'
import {
  ChartBarIcon,
  ClockIcon,
  MicrophoneIcon,
  PaperClipIcon,
  PhotoIcon,
  SparklesIcon,
  UserIcon,
} from '@heroicons/react/24/outline'

export type SlashCommandId =
  | 'attach'
  | 'gif'
  | 'poll'
  | 'voice'
  | 'schedule'
  | 'shrug'
  | 'me'

export interface SlashCommandDefinition {
  id: SlashCommandId
  label: string
  trigger: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const COMMAND_REGISTRY: SlashCommandDefinition[] = [
  {
    id: 'attach',
    label: 'Attach File',
    trigger: 'attach',
    description: 'Upload a file',
    icon: PaperClipIcon,
  },
  {
    id: 'gif',
    label: 'GIF',
    trigger: 'gif',
    description: 'Search and send a GIF',
    icon: PhotoIcon,
  },
  {
    id: 'poll',
    label: 'Create Poll',
    trigger: 'poll',
    description: 'Start a new poll',
    icon: ChartBarIcon,
  },
  {
    id: 'voice',
    label: 'Voice Note',
    trigger: 'voice',
    description: 'Record an audio clip',
    icon: MicrophoneIcon,
  },
  {
    id: 'schedule',
    label: 'Schedule',
    trigger: 'schedule',
    description: 'Send this message later',
    icon: ClockIcon,
  },
  {
    id: 'shrug',
    label: 'Shrug',
    trigger: 'shrug',
    description: 'Insert a shrug',
    icon: SparklesIcon,
  },
  {
    id: 'me',
    label: 'Emote',
    trigger: 'me',
    description: 'Send an action message',
    icon: UserIcon,
  },
]

export const searchCommands = (query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return COMMAND_REGISTRY
  }

  return COMMAND_REGISTRY.filter(
    (command) =>
      command.trigger.startsWith(normalizedQuery) ||
      command.label.toLowerCase().includes(normalizedQuery),
  )
}
