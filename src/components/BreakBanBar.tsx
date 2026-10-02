import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { breakBanSet, breakBanStop, countdown, type BreakBanNow } from '../lib/breakPass'
import { Spinner } from './ui'

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * แปลง "14:30" เป็นเวลาจริง
 *
 * ถ้าเวลานั้นผ่านไปแล้ววันนี้ แปลว่าเขาหมายถึงพรุ่งนี้
 * กะดึกคร่อมเที่ยงคืนเป็นปกติ ถ้าไม่เดาวันให้ คนตั้ง 00:30 ตอนตีสองจะโดนด่าว่าเวลาผ่านไปแล้ว
 */
function atClock(v: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  const d = new Date()
  d.setHours(h, mi, 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

/**
 * ห้ามเบรค — แถบบนหน้าเบรค
 *
 * ไม่มีช่วงห้ามประจำวันแล้ว เจ้าของระบบไม่เอา เพราะต้องมาตั้งทุกวัน
 * ไม่กดห้าม = เบรคได้ตลอด · กดห้าม = เลือกเองว่าตั้งแต่กี่โมงถึงกี่โมง แล้วปลดเอง
 *
 * สามสถานะ และสองอันแรก **ทุกคนเห็น ไม่ใช่เฉพาะคนที่กดห้ามได้**
 *   ห้ามอยู่        แดง
 *   ตั้งไว้ล่วงหน้า  เหลือง พร้อมนับถอยหลังว่าอีกกี่นาทีจะห้าม
 *   ว่าง            ปุ่มห้ามเบรค (เฉพาะคนที่มีสิทธิ์)
 *
 * อันกลางสำคัญที่สุด หัวหน้างานที่กำลังจะปล่อยเบรคต้องรู้ล่วงหน้าว่าอีก 10 นาทีจะห้ามแล้ว
 * ไม่ใช่ปล่อยไปแล้วค่อยมารู้ว่าคนออกไปตอนที่ไม่ควรออก
 */
export function BreakBanBar({
  ban,
  next,
  onChanged,
  now,
}: {
  ban: BreakBanNow | null
  next?: BreakBanNow | null
  onChanged: () => void
  now: number
}) {
  const { profile } = useAuth()
  const may = profile?.role === 'admin' || Boolean(profile?.can_break_ban)
  const [open, setOpen] = useState(false)
  const [fromT, setFromT] = useState('')
  const [toT, setToT] = useState('')
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
      setFromT('')
      setToT('')
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /* ───────── กำลังห้ามอยู่ ───────── */
  if (ban) {
    const left = ban.ends_at ? countdown(ban.ends_at, now) : null
    return (
      <div className="mb-4 rounded-card border border-danger/30 bg-danger-bg p-3">
        <p className="font-display text-sm text-danger-txt">
          🔴 ตอนนี้ห้ามเบรค{ban.note ? ` · ${ban.note}` : ''}
        </p>
        <p className="mt-1 text-xs text-danger-txt">
          {ban.ends_at ? `ถึง ${hhmm(ban.ends_at)}` : ''}
          {left ? ` · เหลืออีก ${left.text} แล้วปลดเอง` : ''}
          <br />
          หัวหน้ายังปล่อยได้ถ้าฉุกเฉิน แต่ต้องพิมพ์เหตุผล และจะเตือนผู้ตรวจสอบทันที
        </p>
        {may && (
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

  /* ───────── ตั้งไว้ล่วงหน้า · ทุกคนเห็น ───────── */
  const soon =
    next && next.starts_at && next.ends_at
      ? Math.max(0, Math.round((new Date(next.starts_at).getTime() - now) / 60000))
      : null

  return (
    <div className="mb-4">
      {next && next.starts_at && next.ends_at && (
        <div className="mb-2 rounded-card border border-warn/40 bg-warn-bg p-3">
          <p className="font-display text-sm text-warn-txt">
            ⏳ อีก {soon} นาทีจะห้ามเบรค
          </p>
          <p className="mt-1 text-xs text-warn-txt">
            ห้าม {hhmm(next.starts_at)} ถึง {hhmm(next.ends_at)}
            {next.note ? ` · ${next.note}` : ''}
            <br />
            ตอนนี้ยังปล่อยได้ปกติ แต่ใบที่ปล่อยตอนนี้อาจกลับไม่ทันก่อนห้าม
          </p>
          {may && (
            <button
              type="button"
              className="btn-ghost mt-2 w-full py-2 text-xs"
              disabled={busy}
              onClick={() => void run(() => breakBanStop())}
            >
              ยกเลิกที่ตั้งไว้
            </button>
          )}
        </div>
      )}

      {may && !open && (
        <button
          type="button"
          className="w-full rounded-card border border-danger/30 bg-surface py-2.5 text-sm font-semibold text-danger-txt"
          onClick={() => setOpen(true)}
        >
          {next ? 'แก้ช่วงห้ามเบรค' : 'ตั้งห้ามเบรค'}
        </button>
      )}

      {may && open && (
        <div className="rounded-card border border-danger/30 bg-surface p-3">
          <p className="mb-1 font-display text-sm text-danger-txt">ห้ามเบรคช่วงไหน</p>
          <p className="mb-2 text-xs text-ink-500">
            ตั้งล่วงหน้าได้ · ครบเวลาแล้วปลดเอง ไม่ต้องกลับมาปิด · ยกเลิกกลางคันได้ตลอด
          </p>

          <input
            className="input mb-3"
            placeholder="เหตุผล เช่น ช่วงรถเข้า (ไม่บังคับ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="ban-from">
                ตั้งแต่
              </label>
              <input
                id="ban-from"
                type="time"
                className="input w-32"
                value={fromT}
                onChange={(e) => setFromT(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="ban-to">
                ถึง
              </label>
              <input
                id="ban-to"
                type="time"
                className="input w-32"
                value={toT}
                onChange={(e) => setToT(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="rounded-btn bg-danger px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              disabled={busy || !toT}
              onClick={() => {
                const end = atClock(toT)
                if (!end) {
                  setErr('เวลาจบไม่ถูกต้อง')
                  return
                }
                // เว้นช่องเริ่มว่าง = ห้ามตั้งแต่เดี๋ยวนี้
                let startIso: string | null = null
                if (fromT.trim()) {
                  startIso = atClock(fromT)
                  if (!startIso) {
                    setErr('เวลาเริ่มไม่ถูกต้อง')
                    return
                  }
                  // atClock เลื่อนเป็นพรุ่งนี้ให้เมื่อเวลาผ่านไปแล้ว
                  // ถ้าเริ่มถูกเลื่อนไปพรุ่งนี้แต่จบยังเป็นวันนี้ จะกลายเป็นจบก่อนเริ่ม
                  if (new Date(startIso) >= new Date(end)) {
                    setErr('เวลาจบต้องอยู่หลังเวลาเริ่ม')
                    return
                  }
                }
                void run(() => breakBanSet({ startAt: startIso, endAt: end, note }))
              }}
            >
              {busy ? <Spinner /> : null}ตั้งห้ามเบรค
            </button>
            <button
              type="button"
              className="btn-ghost ml-auto px-3 py-2.5 text-sm"
              onClick={() => setOpen(false)}
            >
              ยกเลิก
            </button>
          </div>

          <p className="mt-2 text-xs text-ink-400">
            เว้นช่อง &ldquo;ตั้งแต่&rdquo; ว่างไว้ = ห้ามตั้งแต่เดี๋ยวนี้
            <br />
            ใส่เวลาที่ผ่านไปแล้ววันนี้ ระบบเข้าใจว่าหมายถึงพรุ่งนี้ — กะดึกใช้ได้ตามปกติ
          </p>

          {err && <p className="mt-2 text-xs text-danger-txt">{err}</p>}
        </div>
      )}
    </div>
  )
}
