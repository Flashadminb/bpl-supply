import { useEffect, useState } from 'react'
import type { MeetingWindow } from '../lib/types'
import { fmtDateTime } from '../lib/format'

/**
 * กล่องนับถอยหลังของนัดประชุม
 *
 * เวลาทั้งหมดมาจากเซิร์ฟเวอร์เป็น "อีกกี่วินาที" แล้วหน้าจอเดินนาฬิกาต่อเอง
 * ไม่ได้เอาเวลานัดมาลบกับนาฬิกาในเครื่อง เพราะเครื่องหน้างานตั้งเวลาเพี้ยนกันเยอะ
 * บางคนเร็วไปห้านาที บางคนช้าไปสิบ ถ้าเชื่อเครื่องเขาจะเห็นคนละเลขกันทั้งฮับ
 *
 * ตัวตัดสินว่าสายจริงหรือไม่อยู่ที่ฐานข้อมูลตอนกดส่งอยู่ดี
 * กล่องนี้ทำหน้าที่เดียวคือบอกให้รู้ตัวก่อน ไม่ได้เป็นคนตัดสิน
 */

function clock(sec: number) {
  const s = Math.max(sec, 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`
}

export function MeetingWindowCard({ win }: { win: MeetingWindow }) {
  // เดินนาฬิกาจากค่าตั้งต้นที่เซิร์ฟเวอร์ให้มา ไม่แตะนาฬิกาเครื่องเลย
  const [tick, setTick] = useState(0)
  useEffect(() => {
    setTick(0)
    const t = window.setInterval(() => setTick((v) => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [win.id, win.phase])

  const opensIn = win.opens_in_sec - tick
  const closesIn = win.closes_in_sec - tick
  const lateBy = win.late_by_sec + tick

  const head = (
    <>
      <p className="font-display text-base">{win.title}</p>
      <p className="mt-[2px] text-sm text-ink-500">
        {fmtDateTime(win.meet_at)}
        {win.place ? ` · ${win.place}` : ''}
      </p>
      {win.audience && <p className="text-xs text-ink-400">ผู้เข้าร่วม: {win.audience}</p>}
    </>
  )

  if (win.checked_in) {
    return (
      <section className="mb-3 rounded-card border border-success/30 bg-success-bg p-3">
        {head}
        <p className="mt-2 font-display text-md text-success-txt">✓ เช็คชื่อแล้ว</p>
      </section>
    )
  }

  if (win.phase === 'soon') {
    return (
      <section className="mb-3 rounded-card border border-line bg-surface-2 p-3">
        {head}
        <div className="mt-2 rounded-btn bg-brand-50 px-3 py-3 text-center">
          <p className="text-sm text-ink-700">เปิดให้เช็คชื่อในอีก</p>
          <p className="font-mono text-2xl font-semibold">{clock(opensIn)}</p>
          <p className="mt-1 text-xs text-ink-500">ยังกดเช็คชื่อไม่ได้ รอให้ถึงเวลาก่อน</p>
        </div>
      </section>
    )
  }

  if (win.phase === 'open' && closesIn > 0) {
    return (
      <section className="mb-3 rounded-card border border-success/40 bg-surface-2 p-3">
        {head}
        <div className="mt-2 rounded-btn bg-success-bg px-3 py-3 text-center">
          <p className="text-sm text-success-txt">เหลือเวลาเช็คชื่อ</p>
          <p className="font-mono text-2xl font-semibold text-success-txt">{clock(closesIn)}</p>
          <p className="mt-1 text-xs text-success-txt">ถ่ายหลังจากนี้จะบันทึกว่าสาย</p>
        </div>
      </section>
    )
  }

  const mins = Math.floor(lateBy / 60)
  return (
    <section className="mb-3 rounded-card border border-danger/40 bg-surface-2 p-3">
      {head}
      <div className="mt-2 rounded-btn bg-danger-bg px-3 py-3 text-center">
        <p className="text-sm text-danger-txt">เลยเวลามาแล้ว</p>
        <p className="font-mono text-2xl font-semibold text-danger-txt">
          {mins > 0 ? `${mins} นาที` : clock(lateBy)}
        </p>
        <p className="mt-1 text-xs text-danger-txt">เช็คชื่อได้ แต่จะบันทึกว่าสาย</p>
      </div>
    </section>
  )
}
