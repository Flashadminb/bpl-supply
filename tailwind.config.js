import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// อิงตำแหน่งไฟล์ config เอง ไม่อิง cwd — รันจากโฟลเดอร์ไหนก็สแกนคลาสเจอ
const here = dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
// ทุกค่าที่นี่ mirror มาจาก src/styles/tokens.css — ถ้าแก้ ต้องแก้ทั้งสองที่
export default {
  content: [join(here, 'index.html'), join(here, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      // ค่าเป็น hex ตรง ๆ เพื่อให้ utility แบบ /alpha (เช่น bg-ink/45) ใช้ได้
      // ถ้าแก้ที่นี่ ต้องแก้ src/styles/tokens.css ให้ตรงกันด้วยเสมอ
      colors: {
        brand: {
          500: '#F5B301',
          300: '#F3E2AE',
          100: '#FFF4D1',
          50: '#FFF7E0',
        },
        ink: {
          DEFAULT: '#1A1712',
          700: '#4E4738',
          500: '#6B6558',
          400: '#8E8778',
          300: '#A8A091',
        },
        canvas: '#FAF8F3',
        surface: {
          DEFAULT: '#FFFFFF',
          2: '#F5F2EA',
        },
        line: {
          DEFAULT: '#EDE7D9',
          2: '#E2DBC9',
        },
        success: { DEFAULT: '#1E7A4B', bg: '#E8F2EC', txt: '#17603B' },
        warn: { DEFAULT: '#B4820A', bg: '#FFF4D1', txt: '#8A5A00' },
        danger: { DEFAULT: '#B42318', bg: '#FBE9E7', txt: '#8C2F26' },
        neutralbg: '#F0EBE0',
        dark: {
          DEFAULT: '#1A1712',
          2: '#232220',
          3: '#2C2A26',
          text: '#D8D5CE',
          muted: '#918D84',
        },
      },
      fontFamily: {
        display: ['Kanit', 'system-ui', 'sans-serif'],
        body: ['IBM Plex Sans Thai', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        xs: ['11px', '16px'],
        sm: ['12px', '18px'],
        base: ['14px', '21px'],
        md: ['16px', '24px'],
        lg: ['20px', '28px'],
        xl: ['26px', '34px'],
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '22px',
        6: '32px',
        tap: '44px',
      },
      borderRadius: {
        btn: '11px',
        input: '12px',
        card: '14px',
        panel: '18px',
        pill: '999px',
      },
      maxWidth: { phone: '430px' },
      boxShadow: {
        card: '0 1px 2px rgba(26,23,18,.04)',
        float: '0 -6px 20px rgba(26,23,18,.10)',
        pop: '0 10px 30px rgba(26,23,18,.16)',
      },
    },
  },
  plugins: [],
}
