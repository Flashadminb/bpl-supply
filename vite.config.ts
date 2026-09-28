import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' ไม่ใช่ 'autoUpdate'
      //
      // autoUpdate จะรีโหลดหน้าเองทันทีที่เจอโค้ดชุดใหม่ ซึ่งมักไปตรงกับจังหวะที่ผู้ใช้กำลังกด
      // ผลคือจอวาบขาวแล้วเด้งกลับหน้าเดิม และถ้ากำลังกรอกฟอร์มอยู่ของก็หายหมด
      // แบบ prompt จะรอให้กดปุ่มอัปเดตเอง (ดู UpdatePrompt.tsx)
      registerType: 'prompt',
      // ลงทะเบียนเองในโค้ด จะได้คุมจังหวะแจ้งเตือนได้
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'BPL SUPPLY — ระบบเบิก-คืนของ',
        short_name: 'BPL SUPPLY',
        description: 'ระบบเบิก-คืนของสำหรับฮับขนส่ง',
        lang: 'th',
        theme_color: '#F5B301',
        background_color: '#FAF8F3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // ตัวรับแจ้งเตือนอยู่ในไฟล์แยก เพราะ workbox เขียนทับ sw.js ทุกครั้งที่ build
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
        // ล้าง precache รุ่นเก่าทิ้งทุกครั้ง กันของค้างข้ามรุ่นจนชี้ไปไฟล์ที่ไม่มีแล้ว
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            /**
             * การเปิดหน้า — เอาจากเน็ตก่อนเสมอ
             *
             * เดิมใช้ index.html จาก precache อย่างเดียว ซึ่งเป็นแบบล้มแล้วตาย
             * ถ้า precache หายหรือพังระหว่างอัปเวอร์ชัน การเปิดหน้าลึก ๆ จะได้
             * ERR_FAILED ทันที ขึ้นว่า "เข้าเว็บไม่ได้" ทั้งที่เซิร์ฟเวอร์ปกติดี
             * (เกิดจริงมาแล้ว เปิด /admin/notices ไม่ได้ทั้งที่ curl ได้ 200)
             *
             * NetworkFirst แก้สองเรื่องพร้อมกัน
             *   1 precache พังก็ยังเข้าได้ เพราะวิ่งไปเอาจากเซิร์ฟเวอร์ตรง ๆ
             *   2 ได้โค้ดชุดใหม่ทันทีหลัง deploy ไม่ต้องรอ service worker ยอมปล่อย
             *     ซึ่งเป็นสาเหตุที่บ่นกันว่า "มือถือขึ้นแต่คอมไม่ขึ้น" มาตลอด
             *
             * เน็ตในฮับไม่นิ่ง จึงรอแค่ 4 วินาที เกินนั้นใช้ของที่เก็บไว้
             * ออฟไลน์สนิทก็ยังเปิดแอพได้เหมือนเดิม
             */
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // ฟอนต์ Google — cache-first อยู่ได้ยาว
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
  build: { target: 'es2020', sourcemap: false },
})
