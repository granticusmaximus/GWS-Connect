import { useState, type FormEvent } from 'react'
import axios from 'axios'
import { Link, useNavigate } from 'react-router-dom'
import { API_URL } from '../config/runtime'
import { useAuthStore } from '../store/authStore'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false)
  const [forgotPasswordStatus, setForgotPasswordStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const { login, completeTwoFactorLogin, twoFactorChallengeId, loading, error } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
      if (useAuthStore.getState().twoFactorChallengeId) {
        // Server wants a second factor - stay on this page, the form below
        // switches to the code-entry step. password is kept in local state
        // (never re-sent except over the original login call) so the E2EE
        // private key can still be decrypted once the second factor passes.
        return
      }
      navigate('/dashboard')
    } catch (err) {
      console.error('Login error:', err)
    }
  }

  const handleTwoFactorSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await completeTwoFactorLogin(twoFactorCode, password)
      navigate('/dashboard')
    } catch (err) {
      console.error('Two-factor login error:', err)
    }
  }

  const openForgotPasswordModal = () => {
    setForgotPasswordEmail(email)
    setForgotPasswordStatus(null)
    setIsForgotPasswordOpen(true)
  }

  const closeForgotPasswordModal = () => {
    setIsForgotPasswordOpen(false)
    setForgotPasswordStatus(null)
  }

  const handleForgotPasswordRequest = async (e: FormEvent) => {
    e.preventDefault()
    setForgotPasswordLoading(true)
    try {
      const response = await axios.post(`${API_URL}/auth/forgot-password-request`, {
        email: forgotPasswordEmail,
      })
      setForgotPasswordStatus(
        {
          type: 'success',
          message:
            response.data?.message ||
            'If an account exists for that email, your request has been sent to an administrator.',
        },
      )
    } catch (err) {
      console.error('Forgot password request error:', err)
      setForgotPasswordStatus({
        type: 'error',
        message: 'Unable to submit your request right now. Please try again.',
      })
    } finally {
      setForgotPasswordLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-900 via-primary-800 to-primary-950 dark:from-gray-900 dark:via-primary-950 dark:to-black px-4 py-8 sm:py-0">
      <div className="w-full max-w-md space-y-8 p-6 sm:p-8 bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-2xl">
        <div>
          <h2 className="text-center text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white">
            GWS Connect
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            Sign in to your account
          </p>
        </div>
        {twoFactorChallengeId ? (
          <form className="mt-8 space-y-6" onSubmit={handleTwoFactorSubmit}>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="twoFactorCode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Authentication code
              </label>
              <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                Enter the 6-digit code from your authenticator app, or one of your backup codes.
              </p>
              <input
                id="twoFactorCode"
                name="twoFactorCode"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                required
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
                placeholder="123456"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-12 flex justify-center items-center py-3 sm:py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors tap-highlight-none"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </form>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={openForgotPasswordModal}
                className="text-sm text-primary-600 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300 transition-colors"
              >
                Forgot password?
              </button>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-12 flex justify-center items-center py-3 sm:py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors tap-highlight-none"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>

            <div className="text-center">
              <Link to="/register" className="text-sm text-primary-600 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300 transition-colors">
                Don't have an account? Sign up
              </Link>
            </div>
          </form>
        )}

        {isForgotPasswordOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Request Password Reset
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Enter your account email and an administrator will receive your reset request.
              </p>

              <form className="mt-4 space-y-4" onSubmit={handleForgotPasswordRequest}>
                <input
                  type="email"
                  required
                  value={forgotPasswordEmail}
                  onChange={(e) => setForgotPasswordEmail(e.target.value)}
                  className="w-full px-4 py-3 text-base sm:text-sm border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-colors"
                  placeholder="email@example.com"
                />

                {forgotPasswordStatus && (
                  <div
                    className={`rounded-lg px-4 py-3 text-sm ${
                      forgotPasswordStatus.type === 'success'
                        ? 'border border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200'
                        : 'border border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200'
                    }`}
                  >
                    {forgotPasswordStatus.message}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeForgotPasswordModal}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={forgotPasswordLoading}
                    className="rounded-lg bg-primary-600 px-4 py-3 sm:py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
                  >
                    {forgotPasswordLoading ? 'Sending...' : 'Send Request'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
