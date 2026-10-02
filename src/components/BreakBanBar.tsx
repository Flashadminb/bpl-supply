import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { breakBanQuick, breakBanStop, countdown, type BreakBanNow } from '../lib/breakPass'
import { Spinner } from './ui'

const QUICK = [10, 15, 30, 45, 60]

/**
 * ห้ามเบรคเดี๋ยวนี้ — แถบที่โผล่บนหน้าเบรคของคนที่มีสิทธิ์
 *
 * ของที่ตั้งเป็นช่วงประจำวันแก้ปัญหาจริงไม่ได้ เพราะหน้างานใช้เป็นครั้งคราว
 * บางวันไม่ใช้ บางวันเปลี่ยนเวลา ไม่มีใครมานั่งแก้ตั้งค่าทันหรอก
 *
 * ตัวนี้กดแล้ว **หมดอายุเอง** ซึ่งสำคัญกว่าที่คิด
 * ของที่ต้องกลับมาปิดเองจะมีคนลืมปิดเสมอ แล้วจะกลายเป็นห้ามยาวทั้งวัน
 * โดยที่ไม่มีใครรู้ว่าทำไมหัวหน้าปล่อยเบรคไม่ได้
 */
export function BreakBanBar({
  ban,
  onChanged,
  now,
}: {
  ban: BreakBanNow | null
  onChanged: () => void
  now: number
}) {
  const { profile } = useAuth()
  const may = profile?.role === 'admin' || Boolean(profile?.can_break_ban)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      setOpen(false)
      setNote('')
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // กำลังห้ามอยู่ · ทุกคนในหน้านี้เห็นเหมือนกัน คนมีสิทธิ์ได้ปุ่มยกเลิกเพิ่ม
  if (ban) {
    const left = ban.kind === 'once' && ban.ends_at ? countdown(ban.ends_at, now) : null
    return (
      <div className="mb-4 rounded-card border border-danger/30 bg-danger-bg p-3">
        <p className="font-display text-sm text-danger-txt">
          🔴 ตอนนี้ห้ามเบรค{ban.note ? ` · ${ban.note}` : ''}
        </p>
        <p className="mt-1 text-xs text-danger-txt">
          {left
            ? `เหลืออีก ${left.text} แล้วปลดเอง`
            : 'ช่วงห้ามประจำวันที่ตั้งไว้ · แก้ได้ที่หน้าจัดการบัตรเบรค'}
          <br />
          หัวหน้ายังปล่อยได้ถ้าฉุกเฉิน แต่ต้องพิมพ์เหตุผล และจะเตือนผู้ตรวจสอบทันที
        </p>
        {may && ban.kind === 'once' && (
          <button
            type="button"
            className="btn-ghost mt-2 w-full py-2.5 text-sm"
            disabled={busy}
            onClick={() => void run(() => breakBanStop())}
          >
            {busy ? <Spinner /> : null}ยกเลิกห้ามเบรคเดี๋ยวนี้
          </button>
        )}
        {err && <p className="mt-2 text-xs text-danger-txt">{err}</p>}
      </div>
    )
  }

  if (!may) return null

  if (!open) {
    return (
      <button
        type="button"
        className="mb-4 w-full rounded-card border border-danger/30 bg-surface py-2.5 text-sm font-semibold text-danger-txt"
        onClick={() => setOpen(true)}
      >
        ห้ามเบรคเดี๋ยวนี้
      </button>
    )
  }

  return (
    <div className="mb-4 rounded-card border border-danger/30 bg-surface p-3">
      <p className="mb-1 font-display text-sm text-danger-txt">ห้ามเบรคนานแค่ไหน</p>
      <p className="mb-2 text-xs text-ink-500">
        ครบเวลาแล้วปลดเอง ไม่ต้องกลับมาปิด · กดซ้ำได้ถ้าอยากต่อเวลา · ยกเลิกกลางคันได้ตลอด
      </p>
      <input
        className="input mb-2"
        placeholder="เหตุผล เช่น ช่วงรถเข้า (ไม่บังคับ)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {QUICK.map((m) => (
          <button
            key={m}
            type="button"
            className="rounded-btn border border-danger/40 px-3.5 py-2 text-sm font-semibold text-danger-txt"
            disabled={busy}
            onClick={() => void run(() => breakBanQuick(m, note))}
          >
            {m} นาที
          </button>
        ))}
        <button
          type="button"
          className="btn-ghost ml-auto px-3 py-2 text-sm"
          onClick={() => setOpen(false)}
        >
          ยกเลิก
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-danger-txt">{err}</p>}
    </div>
  )
}
