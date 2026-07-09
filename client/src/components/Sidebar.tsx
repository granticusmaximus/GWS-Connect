import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useChatStore } from '../store/chatStore'
import { useCallStore } from '../store/callStore'
import { useAuthStore } from '../store/authStore'
import { API_URL } from '../config/runtime'
import { CheckCircleIcon, HashtagIcon, PencilSquareIcon, PlusIcon, SpeakerWaveIcon, TrashIcon, UserCircleIcon, UserGroupIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { formatStatusForDisplay } from '../utils/userStatus'
import UserSearchModal from './UserSearchModal'
import ChannelModal from './ChannelModal'
import GroupChatModal from './GroupChatModal'

interface SidebarProps {
  isMobileOpen?: boolean
  onClose?: () => void
  onChatSelect?: () => void
}

interface SidebarSection {
  id: string
  name: string
  channelIds: string[]
}

const normalizeSidebarSection = (section: Partial<SidebarSection> & { id?: string | number }): SidebarSection => ({
  id: String(section.id || `temp-${Date.now()}`),
  name: String(section.name || 'Section'),
  channelIds: Array.isArray(section.channelIds) ? section.channelIds.map(String) : [],
})

const removeChannelFromSections = (sections: SidebarSection[], channelId: string) =>
  sections.map((section) => ({
    ...section,
    channelIds: section.channelIds.filter((id) => id !== channelId),
  }))

const insertChannelIntoSection = (
  sections: SidebarSection[],
  channelId: string,
  sectionId: string | null,
  targetIndex?: number,
) => {
  const withoutChannel = removeChannelFromSections(sections, channelId)

  if (!sectionId) {
    return withoutChannel
  }

  return withoutChannel.map((section) => {
    if (section.id !== sectionId) {
      return section
    }

    const nextChannelIds = [...section.channelIds]
    const insertionIndex =
      typeof targetIndex === 'number'
        ? Math.max(0, Math.min(targetIndex, nextChannelIds.length))
        : nextChannelIds.length

    nextChannelIds.splice(insertionIndex, 0, channelId)
    return { ...section, channelIds: nextChannelIds }
  })
}

export default function Sidebar({ isMobileOpen = false, onClose, onChatSelect }: SidebarProps) {
  const {
    channels,
    directMessages,
    groupChats,
    activeChannel,
    activeDM,
    activeGroupChat,
    setActiveChannel,
    setActiveDM,
    setActiveGroupChat,
    loadChannels,
    loadGroupChats,
    loadVoiceChannels,
    loadWorkspaceEmoji,
    voiceChannels,
    requestLatestMessageView,
    onlineUsers,
    presenceByUserId,
    markAllConversationsRead,
  } = useChatStore()
  const { activeCallId, isConnecting, startCall } = useCallStore()
  const user = useAuthStore((state) => state.user)
  const [showUserSearch, setShowUserSearch] = useState(false)
  const [showChannelModal, setShowChannelModal] = useState(false)
  const [showGroupChatModal, setShowGroupChatModal] = useState(false)
  const [sidebarSections, setSidebarSections] = useState<SidebarSection[]>([])
  const [sidebarLoading, setSidebarLoading] = useState(false)
  const [sidebarSaving, setSidebarSaving] = useState(false)
  const [draggingChannelId, setDraggingChannelId] = useState<string | null>(null)

  const loadSidebarSections = async () => {
    setSidebarLoading(true)
    try {
      const response = await axios.get(`${API_URL}/sidebar/sections`)
      setSidebarSections(
        Array.isArray(response.data)
          ? response.data.map((section: SidebarSection) => normalizeSidebarSection(section))
          : [],
      )
    } catch (error) {
      console.error('Error loading sidebar sections:', error)
      setSidebarSections([])
    } finally {
      setSidebarLoading(false)
    }
  }

  const persistSidebarSections = async (sections: SidebarSection[]) => {
    setSidebarSections(sections)
    setSidebarSaving(true)
    try {
      const response = await axios.put(`${API_URL}/sidebar/sections`, {
        sections: sections.map((section) => ({
          name: section.name,
          channelIds: section.channelIds,
        })),
      })
      setSidebarSections(
        Array.isArray(response.data)
          ? response.data.map((section: SidebarSection) => normalizeSidebarSection(section))
          : sections,
      )
    } catch (error) {
      console.error('Error saving sidebar sections:', error)
      void loadSidebarSections()
    } finally {
      setSidebarSaving(false)
    }
  }

  useEffect(() => {
    void loadGroupChats()
    void loadSidebarSections()
    void loadVoiceChannels()
    void loadWorkspaceEmoji()
  }, [loadGroupChats, loadVoiceChannels, loadWorkspaceEmoji])

  const activeVoiceChannelId = useMemo(
    () => (activeCallId?.startsWith('voice:') ? activeCallId.slice('voice:'.length) : null),
    [activeCallId],
  )

  const handleChannelSelect = (channelId: string) => {
    requestLatestMessageView('channel', channelId)
    setActiveChannel(channelId)
    onChatSelect?.()
  }

  const handleDirectMessageSelect = (userId: string) => {
    requestLatestMessageView('dm', userId)
    setActiveDM(userId)
    onChatSelect?.()
  }

  const handleGroupChatSelect = (groupChatId: string) => {
    requestLatestMessageView('group', groupChatId)
    setActiveGroupChat(groupChatId)
    onChatSelect?.()
  }

  const formatUnreadCount = (count: number) => (count > 99 ? '99+' : String(count))

  const totalUnread =
    channels.reduce((sum, ch) => sum + (ch.unreadCount ?? 0), 0) +
    directMessages.reduce((sum, dm) => sum + (dm.unreadCount ?? 0), 0) +
    groupChats.reduce((sum, g) => sum + (g.unreadCount ?? 0), 0)

  const channelsById = useMemo(
    () =>
      channels.reduce<Record<string, (typeof channels)[number]>>((accumulator, channel) => {
        accumulator[channel.id] = channel
        return accumulator
      }, {}),
    [channels],
  )

  const assignedChannelIds = useMemo(
    () => new Set(sidebarSections.flatMap((section) => section.channelIds)),
    [sidebarSections],
  )

  const uncategorizedChannels = useMemo(
    () => channels.filter((channel) => !assignedChannelIds.has(channel.id)),
    [assignedChannelIds, channels],
  )

  const handleCreateSection = async () => {
    const name = window.prompt('Section name')
    if (!name || !name.trim()) {
      return
    }

    await persistSidebarSections([
      ...sidebarSections,
      {
        id: `temp-${Date.now()}`,
        name: name.trim(),
        channelIds: [],
      },
    ])
  }

  const handleRenameSection = async (section: SidebarSection) => {
    const nextName = window.prompt('Rename section', section.name)
    if (!nextName || !nextName.trim()) {
      return
    }

    await persistSidebarSections(
      sidebarSections.map((entry) =>
        entry.id === section.id ? { ...entry, name: nextName.trim() } : entry,
      ),
    )
  }

  const handleRemoveSection = async (sectionId: string) => {
    await persistSidebarSections(
      sidebarSections.filter((section) => section.id !== sectionId),
    )
  }

  const handleDropChannel = async (
    destinationSectionId: string | null,
    targetIndex?: number,
  ) => {
    if (!draggingChannelId) {
      return
    }

    const nextSections = insertChannelIntoSection(
      sidebarSections,
      draggingChannelId,
      destinationSectionId,
      targetIndex,
    )
    setDraggingChannelId(null)
    await persistSidebarSections(nextSections)
  }

  const renderChannelButton = (
    channel: (typeof channels)[number],
    options: { sectionId?: string | null; dropIndex?: number } = {},
  ) => (
    <button
      key={`${options.sectionId || 'root'}-${channel.id}`}
      draggable
      onDragStart={() => setDraggingChannelId(channel.id)}
      onDragEnd={() => setDraggingChannelId(null)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        void handleDropChannel(options.sectionId ?? null, options.dropIndex)
      }}
      onClick={() => handleChannelSelect(channel.id)}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
        activeChannel === channel.id
          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
      }`}
    >
      <HashtagIcon className="w-5 h-5 flex-shrink-0" />
      <span className="text-sm font-medium truncate flex-1 text-left">{channel.name}</span>
      {channel.unreadCount > 0 && (
        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
          {formatUnreadCount(channel.unreadCount)}
        </span>
      )}
    </button>
  )

  return (
    <div
      className={`fixed inset-y-0 left-0 z-40 w-full max-w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transform transition-[transform,width] duration-300 ${
        isMobileOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:relative lg:inset-auto lg:max-w-none lg:translate-x-0 lg:flex-shrink-0 lg:overflow-hidden ${
        isMobileOpen ? 'lg:w-64 xl:w-72 lg:border-r' : 'lg:w-0 lg:border-r-0'
      }`}
    >
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">
            Channels
          </h2>
          <div className="flex items-center gap-1">
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 lg:hidden"
                aria-label="Close sidebar"
              >
                <XMarkIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            )}
            {totalUnread > 0 && (
              <button
                onClick={() => void markAllConversationsRead()}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                title="Mark all as read"
                aria-label="Mark all conversations as read"
              >
                <CheckCircleIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            )}
            <button
              onClick={() => void handleCreateSection()}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              aria-label="Add sidebar section"
              title="Add section"
            >
              <PencilSquareIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
            {user?.role !== 'guest' && (
              <button
                onClick={() => setShowChannelModal(true)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                aria-label="Add channel"
              >
                <PlusIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            )}
          </div>
        </div>

        {sidebarSaving && (
          <div className="mb-2 text-[11px] font-medium text-primary-600 dark:text-primary-400">
            Saving layout...
          </div>
        )}

        <div
          className="space-y-1"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void handleDropChannel(null)
          }}
        >
          {uncategorizedChannels.map((channel) => renderChannelButton(channel))}

          {sidebarSections.map((section) => {
            const sectionChannels = section.channelIds
              .map((channelId) => channelsById[channelId])
              .filter(Boolean)

            return (
              <div
                key={section.id}
                className="mt-3 rounded-xl border border-gray-200 bg-gray-50/80 p-2 dark:border-gray-700 dark:bg-gray-900/40"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  void handleDropChannel(section.id)
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2 px-2">
                  <div className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {section.name}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleRenameSection(section)}
                      className="rounded p-1 text-gray-500 transition hover:bg-white hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      aria-label={`Rename ${section.name}`}
                    >
                      <PencilSquareIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveSection(section.id)}
                      className="rounded p-1 text-gray-500 transition hover:bg-white hover:text-red-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-red-400"
                      aria-label={`Remove ${section.name}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  {sectionChannels.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      Drop channels here
                    </div>
                  ) : (
                    sectionChannels.map((channel, index) =>
                      renderChannelButton(channel, {
                        sectionId: section.id,
                        dropIndex: index,
                      }),
                    )
                  )}
                </div>
              </div>
            )
          })}

          {!sidebarLoading && channels.length === 0 && (
            <>
              <button
                onClick={() => handleChannelSelect('general')}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                  activeChannel === 'general'
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <HashtagIcon className="w-5 h-5" />
                <span className="text-sm font-medium">general</span>
              </button>
              <button
                onClick={() => handleChannelSelect('random')}
                className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
                  activeChannel === 'random'
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <HashtagIcon className="w-5 h-5" />
                <span className="text-sm font-medium">random</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">
            Group Chats
          </h2>
          {user?.role !== 'guest' && (
            <button
              onClick={() => setShowGroupChatModal(true)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              aria-label="Add group chat"
            >
              <PlusIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}
        </div>
        <div className="space-y-1">
          {groupChats.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
              No group chats yet
            </div>
          ) : (
            groupChats.map((group) => (
              <button
                key={group.id}
                onClick={() => handleGroupChatSelect(group.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  activeGroupChat === group.id
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <UserGroupIcon className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-medium truncate flex-1 text-left">{group.name}</span>
                {group.unreadCount > 0 && (
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                    {formatUnreadCount(group.unreadCount)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="border-b border-gray-200 p-4 dark:border-gray-700">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-gray-700 dark:text-gray-300">
            Voice Channels
          </h2>
        </div>
        <div className="space-y-2">
          {voiceChannels.length === 0 ? (
            <div className="py-2 text-sm text-gray-500 dark:text-gray-400">
              No voice channels available
            </div>
          ) : (
            voiceChannels.map((voiceChannel) => {
              const isActiveVoice = activeVoiceChannelId === voiceChannel.id
              return (
                <button
                  key={voiceChannel.id}
                  type="button"
                  onClick={() => void startCall('voice', voiceChannel.id, false)}
                  disabled={isConnecting && !isActiveVoice}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    isActiveVoice
                      ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-200'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <SpeakerWaveIcon className="h-5 w-5 flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {voiceChannel.name}
                    </span>
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold dark:bg-white/10">
                      {voiceChannel.participants.length}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                    {voiceChannel.participants.length > 0
                      ? voiceChannel.participants.map((participant) => participant.username).join(', ')
                      : voiceChannel.description || 'Join the room'}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">
            Direct Messages
          </h2>
          <button 
            onClick={() => setShowUserSearch(true)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" 
            aria-label="Add direct message"
          >
            <PlusIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
        <div className="space-y-1">
          {directMessages.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No direct messages yet
            </div>
          ) : (
            directMessages.map((conversation) => {
              const statusLabel = formatStatusForDisplay(conversation)

              return (
                <button
                  key={conversation.id}
                  onClick={() => handleDirectMessageSelect(conversation.userId)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    activeDM === conversation.userId
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <div className="relative h-9 w-9 flex-shrink-0">
                    <div className="h-9 w-9 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                      {conversation.avatar ? (
                        <img
                          src={conversation.avatar}
                          alt={conversation.username}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <UserCircleIcon className="h-7 w-7 text-gray-500 dark:text-gray-400" />
                      )}
                    </div>
                    {onlineUsers.includes(conversation.userId) && (
                      <span
                        className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-gray-800 ${
                          presenceByUserId[conversation.userId] === 'idle'
                            ? 'bg-yellow-400'
                            : 'bg-green-500'
                        }`}
                        aria-label={presenceByUserId[conversation.userId] === 'idle' ? 'Idle' : 'Online'}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium">{conversation.username}</div>
                    {statusLabel && (
                      <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {statusLabel}
                      </div>
                    )}
                  </div>
                  {conversation.unreadCount > 0 && (
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                      {formatUnreadCount(conversation.unreadCount)}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      <UserSearchModal 
        isOpen={showUserSearch} 
        onClose={() => setShowUserSearch(false)}
        onUserSelected={onChatSelect}
      />

      <ChannelModal
        isOpen={showChannelModal}
        onClose={() => setShowChannelModal(false)}
        onSuccess={() => {
          void loadChannels()
          void loadSidebarSections()
          void loadVoiceChannels()
        }}
        mode="create"
      />

      <GroupChatModal
        isOpen={showGroupChatModal}
        onClose={() => setShowGroupChatModal(false)}
        onCreated={onChatSelect}
      />
    </div>
  )
}
