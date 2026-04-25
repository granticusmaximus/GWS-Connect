import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { useThemeStore } from '../store/themeStore'
import { isMobileDevice } from '../utils/responsive'
import Sidebar from '../components/Sidebar'
import ChatWindow from '../components/ChatWindow'
import Header from '../components/Header'
import ForcePasswordChangeModal from '../components/ForcePasswordChangeModal'

const SIDEBAR_COLLAPSE_BREAKPOINT = 1024

export default function Dashboard() {
  const { user, changePassword, error } = useAuthStore()
  const { restoreActiveChat } = useChatStore()
  const { autoCloseSidebarOnSelect } = useThemeStore()
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.innerWidth >= SIDEBAR_COLLAPSE_BREAKPOINT
  })
  const [wasSidebarOpenedFromCollapsed, setWasSidebarOpenedFromCollapsed] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    restoreActiveChat(String(user.id))
  }, [restoreActiveChat, user?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia(`(min-width: ${SIDEBAR_COLLAPSE_BREAKPOINT}px)`)

    const syncSidebarToViewport = (matchesDesktop: boolean) => {
      setIsSidebarOpen(matchesDesktop)
      setWasSidebarOpenedFromCollapsed(false)
    }

    syncSidebarToViewport(mediaQuery.matches)

    const handleMediaQueryChange = (event: MediaQueryListEvent) => {
      syncSidebarToViewport(event.matches)
    }

    mediaQuery.addEventListener('change', handleMediaQueryChange)

    return () => {
      mediaQuery.removeEventListener('change', handleMediaQueryChange)
    }
  }, [])

  const handleSidebarMenuClick = () => {
    if (isSidebarOpen) {
      setIsSidebarOpen(false)
      setWasSidebarOpenedFromCollapsed(false)
      return
    }

    setIsSidebarOpen(true)
    if (!isMobileDevice()) {
      setWasSidebarOpenedFromCollapsed(true)
    }
  }

  const handleSidebarClose = () => {
    setIsSidebarOpen(false)
    setWasSidebarOpenedFromCollapsed(false)
  }

  const handleSidebarChatSelect = () => {
    const shouldAutoCollapse =
      isMobileDevice() || autoCloseSidebarOnSelect || wasSidebarOpenedFromCollapsed

    if (shouldAutoCollapse) {
      handleSidebarClose()
    }
  }

  return (
    <div className="h-screen min-h-screen flex flex-col bg-gray-100 dark:bg-gray-900 safe-area">
      <Header onMenuClick={handleSidebarMenuClick} isSidebarOpen={isSidebarOpen} />
      <div className="flex-1 flex overflow-hidden">
        {isSidebarOpen && (
          <button
            className="fixed inset-0 z-30 bg-black/40 lg:hidden tap-highlight-none"
            onClick={handleSidebarClose}
            aria-label="Close sidebar"
          />
        )}
        <Sidebar
          isMobileOpen={isSidebarOpen}
          onClose={handleSidebarClose}
          onChatSelect={handleSidebarChatSelect}
        />
        <ChatWindow />
      </div>
      <ForcePasswordChangeModal
        isOpen={!!user?.mustChangePassword}
        error={error}
        loading={savingPassword}
        onSave={async (currentPassword, newPassword) => {
          setSavingPassword(true)
          try {
            await changePassword(currentPassword, newPassword)
          } finally {
            setSavingPassword(false)
          }
        }}
      />
    </div>
  )
}
