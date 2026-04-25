import axios from 'axios'
import { API_URL } from '../config/runtime'

// Detect if running on iOS
export const isIOS = () => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
}

// Detect if PWA is installed (not just in browser)
export const isPWAInstalled = () => {
    // Check if running in standalone mode (installed as PWA)
    return (navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

// Check if push notifications are supported
export const isPushNotificationSupported = () => {
    if (!('serviceWorker' in navigator)) return false
    if (!('PushManager' in window)) return false
    // iOS Safari doesn't support push notifications unless installed as PWA
    if (isIOS() && !isPWAInstalled()) return false
    return true
}

const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(base64)
    const output = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i)
    }
    return output
}

export const getVapidPublicKey = async () => {
    const token = localStorage.getItem('token')
    const response = await axios.get(`${API_URL}/notifications/vapid-public-key`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    return response.data.publicKey as string
}

export const registerServiceWorker = async () => {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers not supported')
    }
    return navigator.serviceWorker.ready
}

export const subscribeToPush = async () => {
    if (!isPushNotificationSupported()) {
        if (isIOS() && !isPWAInstalled()) {
            throw new Error('Push notifications on iOS require installing the app via "Add to Home Screen"')
        }
        throw new Error('Push notifications are not supported in this browser')
    }

    const registration = await registerServiceWorker()
    const existing = await registration.pushManager.getSubscription()
    const token = localStorage.getItem('token')

    if (existing) {
        await axios.post(`${API_URL}/notifications/subscribe`, {
            endpoint: existing.endpoint,
            keys: existing.toJSON().keys,
            userAgent: navigator.userAgent,
        }, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        return existing
    }

    const publicKey = await getVapidPublicKey()
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
    })

    await axios.post(`${API_URL}/notifications/subscribe`, {
        endpoint: subscription.endpoint,
        keys: subscription.toJSON().keys,
        userAgent: navigator.userAgent,
    }, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })

    return subscription
}

export const hasPushSubscription = async () => {
    const registration = await registerServiceWorker()
    const subscription = await registration.pushManager.getSubscription()
    return !!subscription
}

export const unsubscribeFromPush = async () => {
    const registration = await registerServiceWorker()
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
        const token = localStorage.getItem('token')
        await axios.post(`${API_URL}/notifications/unsubscribe`, {
            endpoint: subscription.endpoint,
        }, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        await subscription.unsubscribe()
    }
}
