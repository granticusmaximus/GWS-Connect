import { useEffect, useState } from 'react'
import { useChatStore } from '../store/chatStore'
import { HashtagIcon, PlusIcon, UserCircleIcon, UserGroupIcon, XMarkIcon } from '@heroicons/react/24/outline'
import UserSearchModal from './UserSearchModal'
import ChannelModal from './ChannelModal'
import GroupChatModal from './GroupChatModal'

interface SidebarProps {
  isMobileOpen?: boolean
  onClose?: () => void
  onChatSelect?: () => void
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
    requestLatestMessageView,
    onlineUsers,
    presenceByUserId,
  } = useChatStore()
  const [showUserSearch, setShowUserSearch] = useState(false)
  const [showChannelModal, setShowChannelModal] = useState(false)
  const [showGroupChatModal, setShowGroupChatModal] = useState(false)

  useEffect(() => {
    void loadGroupChats()
  }, [loadGroupChats])

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

  return (
    <div
      className={`fixed inset-y-0 left-0 z-40 w-full max-w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transform transition-[transform,width] duration-300 ${
        isMobileOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:relative lg:inset-auto lg:max-w-none lg:translate-x-0 lg:flex-shrink-0 lg:overflow-hidden ${
        isMobileOpen ? 'lg:w-64 xl:w-72 lg:border-r' : 'lg:w-0 lg:border-r-0'
      }`}
    >
      {/* Channels Section */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">
            Channels
          </h2>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 lg:hidden"
              aria-label="Close sidebar"
            >
              <XMarkIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
          )}
          <button 
            onClick={() => setShowChannelModal(true)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" 
            aria-label="Add channel"
          >
            <PlusIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
        <div className="space-y-1">
          {channels.map((channel) => (
            <button
              key={channel.id}
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
          ))}
          
          {/* Default channels if none exist */}
          {channels.length === 0 && (
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

      {/* Group Chats Section */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase">
            Group Chats
          </h2>
          <button
            onClick={() => setShowGroupChatModal(true)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            aria-label="Add group chat"
          >
            <PlusIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
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

      {/* Direct Messages Section */}
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
            directMessages.map((conversation) => (
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
                <span className="flex-1 truncate text-left text-sm font-medium">
                  {conversation.username}
                </span>
                {conversation.unreadCount > 0 && (
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                    {formatUnreadCount(conversation.unreadCount)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* User Search Modal */}
      <UserSearchModal 
        isOpen={showUserSearch} 
        onClose={() => setShowUserSearch(false)}
        onUserSelected={onChatSelect}
      />

      {/* Channel Modal */}
      <ChannelModal
        isOpen={showChannelModal}
        onClose={() => setShowChannelModal(false)}
        onSuccess={() => loadChannels()}
        mode="create"
      />

      {/* Group Chat Modal */}
      <GroupChatModal
        isOpen={showGroupChatModal}
        onClose={() => setShowGroupChatModal(false)}
        onCreated={onChatSelect}
      />
    </div>
  )
}
