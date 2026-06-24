import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from './store/authStore'
import { useChatStore } from './store/chatStore'
import { useNotificationStore } from './store/notificationStore'
import { useThemeStore } from './store/themeStore'
import { useCallStore } from './store/callStore'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Friends from './pages/Friends'
import AdminPanel from './pages/AdminPanel'
import InvitePage from './pages/InvitePage'
import ToastContainer from './components/ToastContainer'
import IncomingCallModal from './components/IncomingCallModal'
import CallBar from './components/CallBar'
import './App.css'

function App() {
  const { user, token, initializeAuth, initialized } = useAuthStore()
  const { initSocket, disconnectSocket, loadDirectConversations } = useChatStore()
  const { loadNotifications, resetNotifications } = useNotificationStore()
  const { setTheme } = useThemeStore()
  const { registerSocketListeners } = useCallStore()

  useEffect(() => {
    initializeAuth()
  }, [initializeAuth])

  useEffect(() => {
    if (user?.theme === 'dark') {
      setTheme(true)
    } else if (user?.theme === 'light') {
      setTheme(false)
    }
  }, [user?.theme, setTheme])

  useEffect(() => {
    const activeToken = token || localStorage.getItem('token')

    if (!user?.id || !activeToken) {
      disconnectSocket()
      resetNotifications()
      return
    }

    initSocket(activeToken)
    registerSocketListeners()
    void loadNotifications()
    void loadDirectConversations()

    return () => {
      disconnectSocket()
    }
  }, [disconnectSocket, initSocket, loadDirectConversations, loadNotifications, registerSocketListeners, resetNotifications, token, user?.id])

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-gray-600 dark:text-gray-300">Loading...</div>
      </div>
    )
  }

  return (
    <Router>
      <ToastContainer />
      <CallBar />
      <IncomingCallModal />
      <Routes>
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/register" element={!user ? <Register /> : <Navigate to="/dashboard" />} />
        <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" />} />
        <Route
          path="/profile/u/:username"
          element={
            user
              ? user.mustChangePassword
                ? <Navigate to="/dashboard" />
                : <Profile />
              : <Navigate to="/login" />
          }
        />
        <Route
          path="/profile/:userId"
          element={
            user
              ? user.mustChangePassword
                ? <Navigate to="/dashboard" />
                : <Profile />
              : <Navigate to="/login" />
          }
        />
        <Route
          path="/friends"
          element={
            user
              ? user.mustChangePassword
                ? <Navigate to="/dashboard" />
                : <Friends />
              : <Navigate to="/login" />
          }
        />
        <Route
          path="/admin"
          element={
            user?.role === 'admin'
              ? user.mustChangePassword
                ? <Navigate to="/dashboard" />
                : <AdminPanel />
              : <Navigate to="/dashboard" />
          }
        />
        <Route
          path="/invite/:code"
          element={user ? <InvitePage /> : <Navigate to="/login" />}
        />
        <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} />} />
      </Routes>
    </Router>
  )
}

export default App
