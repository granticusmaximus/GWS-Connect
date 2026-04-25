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
    e2eePublicKey?: JsonWebKey
    e2eeEncryptedPrivateKey?: string
    e2eeSalt?: string
    e2eeIv?: string
    avatar?: string
    banner?: string
    bio?: string
    role?: 'user' | 'manager' | 'admin'
    mustChangePassword?: number | boolean
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
    login: (email: string, password: string) => Promise<void>
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>
    register: (username: string, email: string, password: string) => Promise<void>
    logout: () => void
    initializeAuth: () => void
    updateProfile: (updates: Partial<User>) => Promise<void>
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

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: null,
    loading: false,
    initialized: false,
    error: null,
    e2eePrivateKey: null,
    e2eeReady: false,

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
                        set({ token, user: parsedUser, initialized: true })
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
            const { token, user } = response.data
            const normalizedUser = normalizeUserAvatar(user)

            if (normalizedUser?.e2eeEncryptedPrivateKey && normalizedUser?.e2eeSalt && normalizedUser?.e2eeIv) {
                const privateKeyJwk = await decryptPrivateKeyJwk(
                    normalizedUser.e2eeEncryptedPrivateKey,
                    password,
                    normalizedUser.e2eeSalt,
                    normalizedUser.e2eeIv,
                )
                const privateKey = await importPrivateKey(privateKeyJwk)
                sessionStorage.setItem('e2eePrivateKeyJwk', JSON.stringify(privateKeyJwk))
                set({ e2eePrivateKey: privateKey, e2eeReady: true })
            } else {
                set({ e2eePrivateKey: null, e2eeReady: false })
            }

            localStorage.setItem('token', token)
            localStorage.setItem('user', JSON.stringify(normalizedUser))
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`

            set({ user: normalizedUser, token, loading: false, initialized: true })
        } catch (error: unknown) {
            const axiosError = error as AxiosError<{ message?: string }>
            const message = axiosError.response?.data?.message || 'Login failed'
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

    logout: () => {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        sessionStorage.removeItem('e2eePrivateKeyJwk')
        delete axios.defaults.headers.common['Authorization']
        clearE2eeCache()
        set({ user: null, token: null, initialized: true, e2eePrivateKey: null, e2eeReady: false })
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
    changePassword: async (currentPassword: string, newPassword: string) => {
        try {
            const response = await axios.post(`${API_URL}/auth/change-password`, {
                currentPassword,
                newPassword,
            })
            if (response.data?.mustChangePassword === 0) {
                set((state) => {
                    if (!state.user) return state
                    const updatedUser = { ...state.user, mustChangePassword: 0 }
                    localStorage.setItem('user', JSON.stringify(updatedUser))
                    return { user: updatedUser }
                })
            }
        } catch (error: unknown) {
            const axiosError = error as AxiosError<{ message?: string }>
            const message = axiosError.response?.data?.message || 'Password change failed'
            set({ error: message })
            throw error
        }
    },
}))
