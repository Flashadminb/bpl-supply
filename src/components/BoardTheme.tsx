import { useEffect, useState } from 'react'
import { C, applyBoardTheme, boardTheme, setBoardTheme, type BoardTheme } from '../lib/boardTheme'

/**
 * ปุ่มสลับพื้นขาว-ดำของจอกลางคลัง
 *
 * ─────────────────────────────────────────────────────────────────
 * ทำไมต้องมีทั้งสองแบบ
 *
 * จอแขวนในคลังอยู่ในที่ไฟสลัวและเปิดค้างทั้งกะ พื้นดำสบายตากว่าและกินไฟน้อยกว่า
 * แต่คนที่เปิดบนมือถือกลางแดด หรือจะแคปหน้าจอส่งต่อในไลน์ ต้องการพื้นขาว
 * สองความต้องการนี้ขัดกันจริง ๆ เลือกให้ข้างใดข้างหนึ่งคือทำอีกฝั่งใช้ลำบาก
 * ─────────────────────────────────────────────────────────────────
 *
 * ค่าที่เลือกเก็บในเครื่องของแต่ละคน ไม่ได้เก็บในฐานข้อมูล
 * จอในคลังกับมือถือในมือจึงตั้งคนละแบบได้โดยไม่กวนกัน
 */
export default function BoardThemeToggle({ compact = false }: { compact?: boolean }) {
  const [t, setT] = useState<BoardTheme>(() => boardTheme())

  /* เผื่อมีหลายแท็บเปิดอยู่ · สลับที่แท็บหนึ่งแล้วแท็บอื่นตามด้วย
     ไม่งั้นคนจะงงว่าทำไมสลับแล้วอีกจอไม่เปลี่ยน ทั้งที่เป็นเครื่องเดียวกัน */
  useEffect(() => {
    applyBoardTheme(t)
    const onStore = () => {
      const now = boardTheme()
      setT(now)
      applyBoardTheme(now)
    }
    window.addEventListener('storage', onStore)
    return () => window.removeEventListener('storage', onStore)
  }, [t])

  const flip = () => {
    const next: BoardTheme = t === 'dark' ? 'light' : 'dark'
    setBoardTheme(next)
    setT(next)
  }

  return (
    <button
      type="button"
      onClick={flip}
      title={t === 'dark' ? 'สลับเป็นพื้นขาว' : 'สลับเป็นพื้นดำ'}
      aria-label={t === 'dark' ? 'สลับเป็นพื้นขาว' : 'สลับเป็นพื้นดำ'}
      className={`h-tap shrink-0 rounded-btn text-sm ${compact ? 'px-2' : 'px-3'}`}
      style={{ background: C.panel2, color: C.mute, border: `1px solid ${C.line2}` }}
    >
      {t === 'dark' ? '☀' : '☾'}
      {!compact && <span className="ml-1 text-xs">{t === 'dark' ? 'พื้นขาว' : 'พื้นดำ'}</span>}
    </button>
  )
}
