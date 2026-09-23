/* eslint-env serviceworker */
/**
 * ตัวรับแจ้งเตือนของ BPL SUPPLY
 *
 * ไฟล์นี้ถูก importScripts เข้าไปใน service worker ที่ workbox สร้างให้
 * แยกไว้ต่างหากเพราะ workbox generateSW เขียนทับไฟล์ตัวเองทุกครั้งที่ build
 */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'BPL SUPPLY', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'BPL SUPPLY'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // สั่นให้รู้ตัวตอนอยู่หน้างานเสียงดัง
    vibrate: [80, 40, 80],
    data: { url: data.url || '/' },
    // เรื่องเดียวกันมาซ้ำให้ทับอันเก่า ไม่ให้กองเป็นตั้ง
    tag: data.tag || title,
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // เปิดแอพค้างอยู่แล้วก็เด้งไปหน้านั้นในแท็บเดิม ไม่เปิดซ้อนอีกแท็บ
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
