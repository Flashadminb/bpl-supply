import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { listProfiles } from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import {
  deleteBreakBan,
  getBreakSettings,
  hhmmToMin,
  minToHHMM,
  saveBreakBan,
  saveBreakReason,
  setBreakAlertSub,
} from '../../lib/breakPass'

/**
 * ตั้งค่าบัตรเบรค — เฉพาะเจ้าของระบบ
 *
 * สามเรื่องที่คุมหัวหน้างานโดยตรง จึงไม่เปิดให้ผู้ตรวจสอบด้วยซ้ำ
 *   ช่วงห้ามเบรค   ไม่ปิดตาย ปล่อยได้ถ้าฉุกเฉิน แต่เด้งเตือนทันที
 *   นาทีเริ่มต้น   เป็นเวลาไปกลับรวม เผื่อเวลาเดินไว้ในนั้นแล้ว
 *   ใครได้เตือน    ใช้กับทั้งเรื่องช่วงห้ามและเรื่องคนเข้าไม่ครบ
 *
 * ส่วนแผนกกับตัวบัตรอยู่อีกหน้า เพราะเป็นงานที่ทำตอนตั้งระบบครั้งแรก
 * ไม่ใช่งานที่กลับมาแก้บ่อยเหมือนสามเรื่องนี้
 */
export default function BreakSettings() {
  const s = useAsync(() => getBreakSettings(), [])
  const people = useAsync(() => listProfiles(), [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // ฟอร์มเพิ่มช่วงห้าม
  const [bFrom, setBFrom] = useState('04:00')
  const [bTo, setBTo] = useState('04:30')
  const [bNote, setBNote] = useState('')

  const data = s.data
  const staff = (people.data ?? []).filter((p) => p.is_active)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await fn()
      setMsg(ok)
      s.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (s.loading && !data) return <Loading />
  if (s.error) return <ErrorBox message={s.error} onRetry={s.reload} />
  if (!data) return null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl">ตั้งค่าบัตรเบรค</h1>
        <p className="mt-1 text-sm text-ink-500">
          แผนกและตัวบัตรอยู่ที่เมนู &ldquo;แผนก บัตร และพิมพ์&rdquo; · หน้านี้เป็นของที่กลับมาแก้บ่อย
        </p>
      </div>

      {err && <ErrorBox message={err} />}
      {msg && (
        <p className="rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">{msg}</p>
      )}

      {/* ───────── ช่วงห้ามเบรค ───────── */}
      <section className="rounded-card border border-line p-4">
        <h2 className="font-display text-md">ช่วงห้ามเบรค</h2>
        <p className="mb-3 text-xs text-ink-500">
          ไม่ได้ปิดตาย หัวหน้ายังปล่อยได้ถ้าฉุกเฉิน แต่ต้องพิมพ์เหตุผล
          แล้วคนที่คุณเลือกไว้ข้างล่างจะได้แจ้งเตือนทันที และใบนั้นติดป้ายถาวร
          <br />
          ช่วงที่คร่อมเที่ยงคืนใส่ได้ เช่น 23:40 ถึง 00:20 — กะดึกใช้ได้ตามปกติ
        </p>

        {data.bans.length === 0 ? (
          <p className="mb-3 text-sm text-ink-500">ยังไม่ได้ตั้งช่วงห้ามไว้เลย ปล่อยเบรคได้ตลอดเวลา</p>
        ) : (
          <ul className="mb-3 space-y-1.5">
            {data.bans.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-2 rounded-btn border border-line px-3 py-2 text-sm"
              >
                <span className="font-mono font-bold">
                  {minToHHMM(b.start_min)} – {minToHHMM(b.end_min)}
                </span>
                {b.start_min > b.end_min && <span className="badge-mute">ข้ามเที่ยงคืน</span>}
                <span className="min-w-0 flex-1 text-ink-500">{b.note ?? '—'}</span>
                {!b.active && <span className="badge-mute">ปิดอยู่</span>}
                <button
                  type="button"
                  className="btn-ghost px-3 py-1 text-xs"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        saveBreakBan({
                          id: b.id,
                          startMin: b.start_min,
                          endMin: b.end_min,
                          note: b.note,
                          active: !b.active,
                        }),
                      b.active ? 'ปิดช่วงนี้แล้ว' : 'เปิดช่วงนี้แล้ว',
                    )
                  }
                >
                  {b.active ? 'ปิดใช้' : 'เปิดใช้'}
                </button>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1 text-xs text-danger-txt"
                  disabled={busy}
                  onClick={() => void run(() => deleteBreakBan(b.id), 'ลบช่วงนี้แล้ว')}
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor="b-from">
              ตั้งแต่
            </label>
            <input
              id="b-from"
              type="time"
              className="input"
              value={bFrom}
              onChange={(e) => setBFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="b-to">
              ถึง
            </label>
            <input
              id="b-to"
              type="time"
              className="input"
              value={bTo}
              onChange={(e) => setBTo(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="b-note">
              เหตุผล (ไม่บังคับ)
            </label>
            <input
              id="b-note"
              className="input"
              placeholder="เช่น ช่วงรถเข้า"
              value={bNote}
              onChange={(e) => setBNote(e.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary mt-3 px-4 py-2 text-sm"
          disabled={busy}
          onClick={() => {
            const a = hhmmToMin(bFrom)
            const b = hhmmToMin(bTo)
            if (a === null || b === null) {
              setErr('รูปแบบเวลาไม่ถูกต้อง')
              return
            }
            void run(async () => {
              await saveBreakBan({ startMin: a, endMin: b, note: bNote })
              setBNote('')
            }, 'เพิ่มช่วงห้ามแล้ว')
          }}
        >
          เพิ่มช่วงห้าม
        </button>
      </section>

      {/* ───────── นาทีเริ่มต้น ───────── */}
      <section className="rounded-card border border-line p-4">
        <h2 className="font-display text-md">นาทีเริ่มต้นของแต่ละเหตุผล</h2>
        <p className="mb-3 text-xs text-ink-500">
          เป็น <b>เวลาไปกลับรวม</b> ไม่ใช่เวลาเบรคสุทธิ เพราะนาฬิกาเริ่มเดินตั้งแต่หัวหน้ากดยื่นบัตร
          ต้องเผื่อเวลาเดินไปกลับไว้ในตัวเลขนี้ ไม่งั้นจะเกินเวลาแทบทุกใบ
        </p>
        <ul className="space-y-2">
          {data.reasons.map((r) => (
            <li key={r.code} className="flex flex-wrap items-center gap-2">
              <span className="w-28 text-sm">{r.label}</span>
              <input
                type="number"
                min={1}
                max={120}
                aria-label={`นาทีของ ${r.label}`}
                className="input w-24"
                defaultValue={r.default_minutes}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (v === r.default_minutes || !v) return
                  void run(
                    () =>
                      saveBreakReason({
                        code: r.code,
                        label: r.label,
                        minutes: v,
                        sort: r.sort,
                        active: r.active,
                      }),
                    `${r.label} = ${v} นาที`,
                  )
                }}
              />
              <span className="text-sm text-ink-500">นาที</span>
              <button
                type="button"
                className="btn-ghost ml-auto px-3 py-1 text-xs"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      saveBreakReason({
                        code: r.code,
                        label: r.label,
                        minutes: r.default_minutes,
                        sort: r.sort,
                        active: !r.active,
                      }),
                    r.active ? 'ซ่อนเหตุผลนี้แล้ว' : 'เปิดเหตุผลนี้แล้ว',
                  )
                }
              >
                {r.active ? 'ซ่อน' : 'เปิด'}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-400">แก้ตัวเลขแล้วคลิกออกจากช่อง ระบบบันทึกให้เอง</p>
      </section>

      {/* ───────── คนที่ได้แจ้งเตือน ───────── */}
      <section className="rounded-card border border-line p-4">
        <h2 className="font-display text-md">ใครได้แจ้งเตือน</h2>
        <p className="mb-3 text-xs text-ink-500">
          ใช้กับสองเรื่อง — มีคนปล่อยเบรคในช่วงห้าม และ รปภ แจ้งว่าคนเข้าไม่ครบ
          <br />
          <b>ผู้ตรวจสอบกับเจ้าของระบบได้รับเสมอ</b> ไม่ต้องติ๊กที่นี่ · ช่องนี้ไว้เพิ่มคนนอกเหนือจากนั้น
          <br />
          หัวหน้าที่ปล่อยใบนั้นก็ได้รับด้วยเมื่อลูกน้องเข้าไม่ครบ
        </p>
        <div className="flex flex-wrap gap-1.5">
          {staff.map((p) => {
            const on = data.alert_subs.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                className={`rounded-btn border px-2.5 py-1 text-xs ${
                  on ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-700'
                }`}
                onClick={() =>
                  void run(
                    () => setBreakAlertSub(p.id, !on),
                    on ? `เอา ${p.full_name} ออกแล้ว` : `เพิ่ม ${p.full_name} แล้ว`,
                  )
                }
              >
                {p.full_name}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
