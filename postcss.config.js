import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ชี้ไปที่ tailwind.config.js ด้วย path เต็ม ไม่พึ่ง cwd
// ไม่งั้นถ้ารัน vite จากโฟลเดอร์แม่ Tailwind จะหา config ไม่เจอ แล้วออกแต่ preflight
const here = dirname(fileURLToPath(import.meta.url))

export default {
  plugins: {
    tailwindcss: { config: join(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
}
