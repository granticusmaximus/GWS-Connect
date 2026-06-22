import axios from 'axios'
import { create } from 'zustand'
import { API_URL } from '../config/runtime'

export interface NotificationTarget {
  type: 'channel' | 'dm' | 'group'
  id: string
  label?: string
}

export interface InAppNotification {
  id: string
  type: 'mention' | 'reaction' | 'reply'
  title: string
  body: string
  preview?: string
  createdAt: string
  isRead: boolean
  readAt?: string | null
  actor: {
    id: string
    username: string
    avatar?: string | null
  }
  messageId: string
  sourceMessageId?: string | null
  reaction?: string | null
  target: NotificationTarget
}

export interface ToastNotification {
  id: string
  title: string
  body: string
  target?: NotificationTarget & {
    messageId?: string
  }
}

interface NotificationState {
  notifications: InAppNotification[]
  toasts: ToastNotification[]
  loadNotifications: () => Promise<void>
  upsertNotification: (notification: InAppNotification) => void
  markNotificationRead: (id: string) => Promise<void>
  resetNotifications: () => void
  addToast: (toast: ToastNotification) => void
  removeToast: (id: string) => void
}

const getAuthHeaders = () => {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const sortNotifications = (notifications: InAppNotification[]) =>
  [...notifications].sort((a, b) => {
    const timeDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    if (timeDelta !== 0) return timeDelta
    return Number(b.id) - Number(a.id)
  })

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  toasts: [],

  loadNotifications: async () => {
    try {
      const response = await axios.get(`${API_URL}/notifications`, {
        headers: getAuthHeaders(),
      })
      set({
        notifications: sortNotifications(response.data || []),
      })
    } catch (error) {
      console.error('Load notifications error:', error)
    }
  },

  upsertNotification: (notification) =>
    set((state) => {
      const next = [
        notification,
        ...state.notifications.filter((entry) => entry.id !== notification.id),
      ]
      return { notifications: sortNotifications(next) }
    }),

  markNotificationRead: async (id) => {
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === id
          ? {
              ...notification,
              isRead: true,
              readAt: notification.readAt || new Date().toISOString(),
            }
          : notification,
      ),
    }))

    try {
      const response = await axios.post(
        `${API_URL}/notifications/${id}/read`,
        {},
        {
          headers: getAuthHeaders(),
        },
      )

      if (response.data) {
        set((state) => ({
          notifications: sortNotifications(
            state.notifications.map((notification) =>
              notification.id === id ? response.data : notification,
            ),
          ),
        }))
      }
    } catch (error) {
      console.error('Mark notification read error:', error)
    }
  },

  resetNotifications: () => {
    set({ notifications: [], toasts: [] })
  },

  addToast: (toast) =>
    set((state) => ({ toasts: [...state.toasts, toast] })),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}))
