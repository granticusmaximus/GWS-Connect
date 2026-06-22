import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { useNotificationStore, type InAppNotification } from '../store/notificationStore'
import { useThemeStore } from '../store/themeStore'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRightOnRectangleIcon,
  BellIcon,
  SunIcon,
  MoonIcon,
  HomeIcon,
  UserGroupIcon,
  Bars3Icon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline'
import type { Message } from '../store/chatStore'

interface HeaderProps {
  onMenuClick?: () => void
  isSidebarOpen?: boolean
}

export default function Header({ onMenuClick, isSidebarOpen = false }: HeaderProps) {
  const { user, logout, updateProfile } = useAuthStore()
  const {
    setActiveChannel,
    setActiveDM,
    setMessageFocusTarget,
    loadMessageById,
    activeChannel,
    activeDM,
    searchMessages,
  } = useChatStore()
  const { notifications, markNotificationRead } = useNotificationStore()
  const { isDarkMode, toggleTheme } = useThemeStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] = useState(false)
  const notificationMenuRef = useRef<HTMLDivElement | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Message[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const searchMenuRef = useRef<HTMLDivElement | null>(null)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleThemeToggle = () => {
    const nextMode = toggleTheme()
    if (user) {
      void updateProfile({ theme: nextMode ? 'dark' : 'light' })
    }
  }

  const isActive = (path: string) => location.pathname === path
  const isProfileActive = location.pathname.startsWith('/profile')
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications],
  )
  const getNavButtonClass = (active: boolean) =>
    active
      ? 'flex items-center gap-2 rounded-lg bg-primary-50 px-2.5 py-2 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200 xl:px-3'
      : 'flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors xl:px-3'
  const getNavTextClass = (active: boolean) =>
    active ? 'text-primary-700 dark:text-primary-200' : 'text-gray-700 dark:text-gray-300'
  const getNavIconClass = (active: boolean) =>
    active ? 'text-primary-600 dark:text-primary-300' : 'text-gray-600 dark:text-gray-400'

  useEffect(() => {
    setIsNotificationMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!notificationMenuRef.current?.contains(event.target as Node)) {
        setIsNotificationMenuOpen(false)
      }
      if (!searchMenuRef.current?.contains(event.target as Node)) {
        setIsSearchOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNotificationMenuOpen(false)
        setIsSearchOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const handleNotificationClick = async (notification: InAppNotification) => {
    if (notification.target.type === 'channel') {
      setActiveChannel(notification.target.id)
    } else {
      setActiveDM(notification.target.id)
    }

    setMessageFocusTarget({
      chatType: notification.target.type,
      chatId: notification.target.id,
      messageId: notification.messageId,
    })
    setIsNotificationMenuOpen(false)
    navigate('/dashboard')
    void markNotificationRead(notification.id)
    await loadMessageById(notification.messageId)
  }

  const activeChatTarget = activeChannel
    ? { chatType: 'channel' as const, chatId: activeChannel }
    : activeDM
      ? { chatType: 'dm' as const, chatId: activeDM }
      : null

  const handleSearchSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeChatTarget || searchQuery.trim().length < 2) return

    setIsSearching(true)
    const results = await searchMessages(activeChatTarget.chatType, activeChatTarget.chatId, searchQuery.trim())
    setSearchResults(results)
    setIsSearching(false)
  }

  const handleSearchResultClick = async (message: Message) => {
    if (!activeChatTarget) return
    setMessageFocusTarget({
      chatType: activeChatTarget.chatType,
      chatId: activeChatTarget.chatId,
      messageId: message.id,
    })
    setIsSearchOpen(false)
    navigate('/dashboard')
    await loadMessageById(message.id)
  }

  const formatNotificationTime = (value: string) => {
    const timestamp = new Date(value)
    const now = Date.now()
    const deltaMs = now - timestamp.getTime()
    const deltaMinutes = Math.floor(deltaMs / 60000)

    if (deltaMinutes < 1) return 'now'
    if (deltaMinutes < 60) return `${deltaMinutes}m`

    const deltaHours = Math.floor(deltaMinutes / 60)
    if (deltaHours < 24) return `${deltaHours}h`

    const deltaDays = Math.floor(deltaHours / 24)
    if (deltaDays < 7) return `${deltaDays}d`

    return timestamp.toLocaleDateString()
  }

  return (
    <header className="sticky top-0 z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-3 sm:py-4 safe-area-top">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 sm:gap-3 min-w-0">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="p-2.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-12 min-w-12 flex items-center justify-center tap-highlight-none"
              aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <Bars3Icon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            </button>
          )}
          <Link
            to="/"
            className="flex items-center gap-1.5 sm:gap-2 text-lg sm:text-2xl font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors min-w-0 flex-shrink-0"
          >
            <img
              src="/gws-connect-favicon.svg"
              alt="GWS Connect"
              className="w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0"
            />
            <span className="hidden lg:inline">GWS Connect</span>
            <span className="hidden sm:inline lg:hidden">GWS</span>
          </Link>
          <button
            onClick={handleThemeToggle}
            className="p-2.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-12 min-w-12 flex items-center justify-center tap-highlight-none"
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? (
              <SunIcon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            ) : (
              <MoonIcon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            )}
          </button>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-3 overflow-visible">

          <button
            onClick={() => navigate('/')}
            className={`${getNavButtonClass(isActive('/dashboard') || isActive('/'))} min-h-12 sm:min-h-auto tap-highlight-none`}
            title="Home"
            aria-label="Home"
          >
            <HomeIcon className={`w-6 h-6 flex-shrink-0 ${getNavIconClass(isActive('/dashboard') || isActive('/'))}`} />
            <span className={`hidden xl:inline text-sm font-medium ${getNavTextClass(isActive('/dashboard') || isActive('/'))}`}>
              Home
            </span>
          </button>

          <button
            onClick={() => navigate('/friends')}
            className={`${getNavButtonClass(isActive('/friends'))} min-h-12 sm:min-h-auto tap-highlight-none`}
            title="Friends"
            aria-label="Friends"
          >
            <UserGroupIcon className={`w-6 h-6 flex-shrink-0 ${getNavIconClass(isActive('/friends'))}`} />
            <span className={`hidden xl:inline text-sm font-medium ${getNavTextClass(isActive('/friends'))}`}>
              Friends
            </span>
          </button>

          <div className="relative flex-shrink-0" ref={searchMenuRef}>
            <button
              type="button"
              onClick={() => setIsSearchOpen((current) => !current)}
              disabled={!activeChatTarget}
              className={`${getNavButtonClass(isSearchOpen)} min-h-12 sm:min-h-auto tap-highlight-none disabled:opacity-40`}
              title={activeChatTarget ? 'Search messages' : 'Select a chat to search'}
              aria-label="Search messages"
              aria-expanded={isSearchOpen}
            >
              <MagnifyingGlassIcon className={`w-6 h-6 flex-shrink-0 ${getNavIconClass(isSearchOpen)}`} />
              <span className={`hidden xl:inline text-sm font-medium ${getNavTextClass(isSearchOpen)}`}>
                Search
              </span>
            </button>

            {isSearchOpen && (
              <div className="absolute right-0 top-full z-50 mt-3 w-[22rem] max-w-[calc(100vw-2rem)]">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                  <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search this conversation..."
                      autoFocus
                      className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
                    >
                      Go
                    </button>
                  </form>
                  <div className="max-h-96 overflow-y-auto">
                    {isSearching ? (
                      <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
                    ) : searchResults.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">No results yet</div>
                    ) : (
                      searchResults.map((message) => (
                        <button
                          key={message.id}
                          type="button"
                          onClick={() => void handleSearchResultClick(message)}
                          className="flex w-full flex-col items-start gap-0.5 border-b border-gray-100 px-4 py-3 text-left transition hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/80"
                        >
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {message.senderName}
                          </span>
                          <span className="truncate text-sm text-gray-600 dark:text-gray-300">
                            {message.content}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative flex-shrink-0" ref={notificationMenuRef}>
            <button
              type="button"
              onClick={() => setIsNotificationMenuOpen((current) => !current)}
              className={`${getNavButtonClass(isNotificationMenuOpen)} min-h-12 sm:min-h-auto tap-highlight-none relative`}
              title="Notifications"
              aria-label="Notifications"
              aria-expanded={isNotificationMenuOpen}
            >
              <span className="relative flex-shrink-0">
                <BellIcon className={`w-6 h-6 ${getNavIconClass(isNotificationMenuOpen)}`} />
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
              <span className={`hidden xl:inline text-sm font-medium ${getNavTextClass(isNotificationMenuOpen)}`}>
                Notifications
              </span>
            </button>

            {isNotificationMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-3 w-[22rem] max-w-[calc(100vw-2rem)]">
                <div className="absolute right-8 top-0 h-4 w-4 -translate-y-1/2 rotate-45 border-l border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" />
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      Notifications
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                    </div>
                  </div>
                </div>

                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
                    No New Notifications
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => void handleNotificationClick(notification)}
                        className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/80 ${
                          notification.isRead ? 'bg-white dark:bg-gray-900' : 'bg-primary-50/70 dark:bg-primary-900/10'
                        }`}
                      >
                        <div className="h-10 w-10 overflow-hidden rounded-full bg-primary-100 dark:bg-primary-900/30 flex-shrink-0">
                          {notification.actor.avatar ? (
                            <img
                              src={notification.actor.avatar}
                              alt={notification.actor.username}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-primary-700 dark:text-primary-200">
                              {notification.actor.username?.[0]?.toUpperCase() || '?'}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                              {notification.title}
                            </span>
                            <span className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
                              {formatNotificationTime(notification.createdAt)}
                            </span>
                          </div>
                          <div className="mt-0.5 text-sm text-gray-700 dark:text-gray-200">
                            {notification.body}
                          </div>
                          {notification.preview && (
                            <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                              {notification.preview}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => navigate(`/profile/${user?.id}`)}
            className={`${getNavButtonClass(isProfileActive)} min-h-12 sm:min-h-auto tap-highlight-none`}
            aria-label="Profile"
          >
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
              {user?.avatar ? (
                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-primary-500 flex items-center justify-center text-white text-sm font-semibold">
                  {user?.username?.[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <span className={`hidden xl:inline text-sm font-medium ${getNavTextClass(isProfileActive)}`}>
              {user?.username}
            </span>
          </button>

          <button
            onClick={handleLogout}
            className="p-2.5 sm:p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-12 min-w-12 flex items-center justify-center tap-highlight-none"
            aria-label="Logout"
          >
            <ArrowRightOnRectangleIcon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>
    </header>
  )
}
