/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: unknown }

import { precacheAndRoute } from 'workbox-precaching'

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event: PushEvent) => {
    const data = event.data?.json() || {}
    const title = data.title || 'GWS Connect'
    const options = {
        body: data.body || 'New message',
        icon: data.icon || '/gws-connect-favicon.svg',
        badge: data.icon || '/gws-connect-favicon.svg',
        data: { url: data.url || '/' },
    }

    event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
    event.notification.close()
    event.waitUntil(self.clients.openWindow(event.notification?.data?.url || '/'))
})
