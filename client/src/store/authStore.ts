import { create } from 'zustand'
import axios, { type AxiosError } from 'axios'
import { API_URL } from '../config/runtime'
import {
    decryptPrivateKeyJwk,
    encryptPrivateKeyJwk,
    generateIdentityKeyPair,
    importPrivateKey,
    clearE2eeCache,
} from '../utils/e2ee'
const DEFAULT_AVATAR_SRC = '/image.png'

const normalizeAvatar = (avatar?: string | null) =>
    typeof avatar === 'string' && avatar.trim() ? avatar : DEFAULT_AVATAR_SRC

const normalizeUserAvatar = <T extends { avatar?: string | null }>(user: T): T => ({
    ...user,
    avatar: normalizeAvatar(user.avatar),
})

interface User {
    id: string
    username: string
    email: string
    theme?: 'light' | 'dark'
    appearOffline?: number | boolean
    statusEmoji?: string | null
    statusText?: string | null
    statusClearsAt?: string | null
    e2eePublicKey?: JsonWebKey
    e2eeEncryptedPrivateKey?: string
    e2eeSalt?: string
    e2eeIv?: string
    avatar?: string
    banner?: string
    bio?: string
    role?: 'user' | 'manager' | 'admin'
    mustChangePassword?: number | boolean
    twoFactorEnabled?: number | boolean
    interests?: string[]
    socialLinks?: {
        twitter?: string
        github?: string
        linkedin?: string
        website?: string
    }
    contactInfo?: {
        displayEmail?: string
        phone?: string
    }
}

interface AuthState {
    user: User | null
    token: string | null
    loading: boolean
    initialized: boolean
    error: string | null
    e2eePrivateKey: CryptoKey | null
    e2eeReady: boolean
    e2eeKeyRecoveryNeeded: boolean
    twoFactorChallengeId: string | null
    login: (email: string, password: string) => Promise<void>
    completeTwoFactorLogin: (code: string, password: string) => Promise<void>
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>
    register: (username: string, email: string, password: string) => Promise<void>
    logout: () => Promise<void>
    deleteAccount: (currentPassword: string, code?: string) => Promise<void>
    initializeAuth: () => void
    updateProfile: (updates: Partial<User>) => Promise<void>
    updateStatus: (status: Pick<User, 'statusEmoji' | 'statusText' | 'statusClearsAt'>) => Promise<void>
}

// Set up axios interceptor to always include token from localStorage
axios.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token')
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        return config
    },
    (error) => Promise.reject(error)
)

export const useAuthStore = create<AuthState>((set, get) => {
    // Shared by logout() and deleteAccount() - both end the session locally
    // the same way, just with a different (or no) server call beforehand.
    const clearLocalSession = () => {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        sessionStorage.removeItem('e2eePrivateKeyJwk')
        delete axios.defaults.headers.common['Authorization']
        clearE2eeCache()
        set({
            user: null,
            token: null,
            initialized: true,
            e2eePrivateKey: null,
            e2eeReady: false,
            e2eeKeyRecoveryNeeded: false,
            twoFactorChallengeId: null,
        })
    }

    // Shared by login() (no 2FA) and completeTwoFactorLogin() (after the
    // second factor passes) - both end up with the same {token, user} shape
    // from the server and need the same E2EE bootstrap/recovery handling.
    const completeLoginSession = async (token: string, user: User, password: string) => {
        const normalizedUser = normalizeUserAvatar(user)

        let e2eeKeyRecoveryNeeded = false
        if (normalizedUser?.e2eeEncryptedPrivateKey && normalizedUser?.e2eeSalt && normalizedUser?.e2eeIv) {
            try {
                const privateKeyJwk = await decryptPrivateKeyJwk(
                    normalizedUser.e2eeEncryptedPrivateKey,
                    password,
                    normalizedUser.e2eeSalt,
                    normalizedUser.e2eeIv,
                )
                const privateKey = await importPrivateKey(privateKeyJwk)
                sessionStorage.setItem('e2eePrivateKeyJwk', JSON.stringify(privateKeyJwk))
                set({ e2eePrivateKey: privateKey, e2eeReady: true })
            } catch {
                // The private key is encrypted under a different password than the one
                // just used (e.g. an admin password reset). The password itself was
                // already verified by the server above, so this is not an auth failure -
                // surface a recovery state instead of blocking login entirely.
                sessionStorage.removeItem('e2eePrivateKeyJwk')
                set({ e2eePrivateKey: null, e2eeReady: false })
                e2eeKeyRecoveryNeeded = true
            }
        } else {
            set({ e2eePrivateKey: null, e2eeReady: false })
        }

        localStorage.setItem('token', token)
        localStorage.setItem('user', JSON.stringify(normalizedUser))
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`

        set({
            user: normalizedUser,
            token,
            loading: false,
            initialized: true,
            e2eeKeyRecoveryNeeded,
            twoFactorChallengeId: null,
        })
    }

    return {
    user: null,
    token: null,
    loading: false,
    initialized: false,
    error: null,
    e2eePrivateKey: null,
    e2eeReady: false,
    e2eeKeyRecoveryNeeded: false,
    twoFactorChallengeId: null,

    initializeAuth: () => {
        const token = localStorage.getItem('token')
        const user = localStorage.getItem('user')
        const e2eePrivateKeyJwk = sessionStorage.getItem('e2eePrivateKeyJwk')
        if (token && user) {
            const parsedUser = normalizeUserAvatar(JSON.parse(user))
            localStorage.setItem('user', JSON.stringify(parsedUser))
            if (e2eePrivateKeyJwk) {
                importPrivateKey(JSON.parse(e2eePrivateKeyJwk))
                    .then((privateKey) => {
                        set({
                            token,
                            user: parsedUser,
                            initialized: true,
                            e2eePrivateKey: privateKey,
                            e2eeReady: true,
                        })
                    })
                    .catch(() => {
                        sessionStorage.removeItem('e2eePrivateKeyJwk')
                        set({
                            token,
                            user: parsedUser,
                            initialized: true,
                            e2eePrivateKey: null,
                            e2eeReady: false,
                            e2eeKeyRecoveryNeeded: true,
                        })
                    })
                return
            }
            set({ token, user: parsedUser, initialized: true })
            return
        }
        set({ initialized: true })
    },

    login: async (email: string, password: string) => {
        set({ loading: true, error: null })
        try {
            const response = await axios.post(`${API_URL}/auth/login`, { email, password })

            if (response.data?.requiresTwoFactor) {
                set({
                    loading: false,
                    twoFactorChallengeId: response.data.challengeId,
                })
                return
            }

            const { token, user } = response.data
            await completeLoginSession(token, user, password)
        } catch (error: unknown) {
            const axiosError = error as AxiosError<{ message?: string }>
            const message = axiosError.response?.data?.message || 'Login failed'
            set({ error: message, loading: false })
            throw error
        }
    },

    completeTwoFactorLogin: async (code: string, password: string) => {
        const { twoFactorChallengeId } = get()
        if (!twoFactorChallengeId) {
            throw new Error('No login in progress')
        }

        set({ loading: true, error: null })
        try {
            const response = await axios.post(`${API_URL}/auth/2fa/challenge`, {
                challengeId: twoFactorChallengeId,
                code,
            })
            const { token, user } = response.data
            await completeLoginSession(token, user, password)
        } catch (error: unknown) {
            const axiosError = error as AxiosError<{ message?: string }>
            const message = axiosError.response?.data?.message || 'Invalid authentication code'
            set({ error: message, loading: false })
            throw error
        }
    },

    register: async (username: string, email: string, password: string) => {
        set({ loading: true, error: null })
        try {
            const { publicKeyJwk, privateKeyJwk } = await generateIdentityKeyPair()
            const encrypted = await encryptPrivateKeyJwk(privateKeyJwk, password)

            const response = await axios.post(`${API_URL}/auth/register`, {
                username,
                email,
                password,
                e2eePublicKey: publicKeyJwk,
                e2eeEncryptedPrivateKey: encrypted.encryptedPrivateKey,
                e2eeSalt: encrypted.salt,
                e2eeIv: encrypted.iv,
            })
            const { token, user } = response.data
            const normalizedUser = normalizeUserAvatar(user)

            const privateKey = await importPrivateKey(privateKeyJwk)
            sessionStorage.setItem('e2eePrivateKeyJwk', JSON.stringify(privateKeyJwk))
            set({ e2eePrivateKey: privateKey, e2eeReady: true })

            localStorage.setItem('token', token)
            localStorage.setItem('user', JSON.stringify(normalizedUser))
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`

            set({ user: normalizedUser, token, loading: false, initialized: true })
        } catch (error: unknown) {
            const axiosError = error as AxiosError<{ message?: string }>
            const message = axiosError.response?.data?.message || 'Registration failed'
            set({ error: message, loading: false })
            throw error
        }
    },

    logout: async () => {
        try {
            await axios.post(`${API_URL}/auth/logout`)
        } catch (error) {
            // Best-effort - if the token's already invalid/expired there's
            // nothing to revoke server-side, just proceed to clear local state.
            console.error('Logout request failed:', error)
        }

        clearLocalSession()
    },

    deleteAccount: async (currentPassword: string, code?: string) => {
        await axios.post(`${API_URL}/auth/delete-account`, { currentPassword, code })
        // Already revoked server-side as part of deletion - no separate
        // /auth/logout call needed, just clear local state.
        clearLocalSession()
    },

    updateProfile: async (updates: Partial<User>) => {
        try {
            const response = await axios.put(`${API_URL}/users/profile`, updates)
            const updatedUser = normalizeUserAvatar(response.data)
            set((state) => {
                const mergedUser = { ...(state.user || {}), ...updates, ...updatedUser }
                localStorage.setItem('user', JSON.stringify(mergedUser))
                return { user: mergedUser }
            })
        } catch (error: unknown) {
            const axiosError = error as AxiosError<{ message?: string }>
            const message = axiosError.response?.data?.message || 'Profile update failed'
            set({ error: message })
            throw error
        }
    },
    updateStatus: async (status) => {
        try {
            const response = await axios.put(`${API_URL}/users/me/status`, status)
            const updatedUser = normalizeUserAvatar(response.data)
            set((state) => {
                const mergedUser = { ...(state.user || {}), ...updatedUser }
                localStorage.setItem('user', JSON.stringify(mergedUser))
                return { user: mergedUser }
            })
        } catch (error: unknown) {
            const axiosError = error as AxiosError<{ message?: string }>
            const message = axiosError.response?.data?.message || 'Status update failed'
            set({ error: message })
            throw error
        }
    },
    changePassword: async (currentPassword: string, newPassword: string) => {
        try {
            const { user, e2eeKeyRecoveryNeeded } = get()

            let e2eeUpdate: {
                e2eePublicKey?: JsonWebKey
                e2eeEncryptedPrivateKey: string
                e2eeSalt: string
                e2eeIv: string
            } | null = null
            let rotated = false

            if (user?.e2eeEncryptedPrivateKey && user?.e2eeSalt && user?.e2eeIv) {
                try {
                    const privateKeyJwk = await decryptPrivateKeyJwk(
                        user.e2eeEncryptedPrivateKey,
                        currentPassword,
                        user.e2eeSalt,
                        user.e2eeIv,
                    )
                    const reEncrypted = await encryptPrivateKeyJwk(privateKeyJwk, newPassword)
                    e2eeUpdate = {
                        e2eeEncryptedPrivateKey: reEncrypted.encryptedPrivateKey,
                        e2eeSalt: reEncrypted.salt,
                        e2eeIv: reEncrypted.iv,
                    }
                    const privateKey = await importPrivateKey(privateKeyJwk)
                    sessionStorage.setItem('e2eePrivateKeyJwk', JSON.stringify(privateKeyJwk))
                    set({ e2eePrivateKey: privateKey, e2eeReady: true, e2eeKeyRecoveryNeeded: false })
                    rotated = true
                } catch {
                    // currentPassword can't decrypt the existing key - either it's wrong
                    // (server will reject below via bcrypt) or this is the recovery case
                    // (admin-issued temp password, original key unrecoverable).
                }
            }

            if (!rotated && e2eeKeyRecoveryNeeded) {
                // No usable old key. Generate a fresh identity instead of leaving the
                // account without one - old E2EE content is permanently unrecoverable.
                // The UI must have already warned the user before calling this.
                const { publicKeyJwk, privateKeyJwk } = await generateIdentityKeyPair()
                const encrypted = await encryptPrivateKeyJwk(privateKeyJwk, newPassword)
                e2eeUpdate = {
                    e2eePublicKey: publicKeyJwk,
                    e2eeEncryptedPrivateKey: encrypted.encryptedPrivateKey,
                    e2eeSalt: encrypted.salt,
                    e2eeIv: encrypted.iv,
                }
                clearE2eeCache()
                const privateKey = await importPrivateKey(privateKeyJwk)
                sessionStorage.setItem('e2eePrivateKeyJwk', JSON.stringify(privateKeyJwk))
                set({ e2eePrivateKey: privateKey, e2eeReady: true, e2eeKeyRecoveryNeeded: false })
            }

            const response = await axios.post(`${API_URL}/auth/change-password`, {
                currentPassword,
                newPassword,
                ...(e2eeUpdate ?? {}),
            })

            set((state) => {
                if (!state.user) return state
                const updatedUser = {
                    ...state.user,
                    ...(response.data?.mustChangePassword === 0 ? { mustChangePassword: 0 } : {}),
                    ...(e2eeUpdate ?? {}),
                }
                localStorage.setItem('user', JSON.stringify(updatedUser))
                return { user: updatedUser }
            })
        } catch (error: unknown) {
            const axiosError = error as AxiosError<{ message?: string }>
            const message = axiosError.response?.data?.message || 'Password change failed'
            set({ error: message })
            throw error
        }
    },
    }
})
