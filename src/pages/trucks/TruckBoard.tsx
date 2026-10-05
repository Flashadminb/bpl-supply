import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  addTruck,
  listTruckBoard,
  listTruckBranches,
  releaseTruck,
  secondsLeft,
  unreleaseTruck,
  type TruckBoardRow,
  type TruckBranch,
} from '../../lib/trucks'

/**
 * ตารางปล่อยรถ — หน้าเต็มจอ พื้นดำ ไม่ใช้กรอบของแอพเบิกของ
 *
 * หน้านี้ถูกเปิดค้างไว้ทั้งกะ และคนอ่านจากระยะไกลกว่าหน้าจออื่นในระบบ
 * ตัวอักษรจึงใหญ่กว่าปกติทุกจุด และสีพื้นเป็นดำเพื่อให้ตัวเลขเด้ง
 *
 * กฎการอ่านมีประโยคเดียว — ตัวเลขนับถอยหลังติดลบเมื่อไหร่คือเลยกำหนด
 *
 * เวลาถึงคลังกับเวลาที่ควรออกเป็นค่าที่บันทึกไว้แล้ว ต้องนิ่งสนิท
 * มีแต่ตัวนับถอยหลังที่เดิน · ถ้าสองช่องนั้นขยับแปลว่าโค้ดผิด
 */

const ALLOW = [120, 180, 240]
const DAY = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

const p2 = (n: number) => String(n).padStart(2, '0')
const hm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`
const dmy = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`

/** สีเดียวกันทั้งหน้า · เขียวยังมีเวลา ส้มเหลือไม่ถึง 30 นาที แดงเลยกำหนด */
function tone(sec: number) {
  if (sec < 0) return '#FF5C5C'
  if (sec <= 30 * 60) return '#FFB038'
  return '#35D98A'
}

/**
 * ป้ายตัวเลขแบบป้ายพับ
 *
 * พื้นขาวตัวดำบนจอดำอ่านได้จากไกลที่สุดเท่าที่ทำได้ด้วยตัวอักษรอย่างเดียว
 * เลยกำหนดแล้วสลับเป็นพื้นแดงตัวขาว เพราะตอนนั้นต้องสะดุดตา ไม่ใช่แค่อ่านออก
 */
function Flip({ v, label, size, late }: { v: string; label?: string; size: number; late: boolean }) {
  return (
    <span className="inline-flex flex-col items-center" style={{ gap: Math.round(size * 0.1) }}>
      <span
        className="relative inline-flex items-center justify-center"
        style={{
          width: size,
          height: Math.round(size * 0.82),
          background: late ? '#FF4040' : '#FBFBFB',
          borderRadius: Math.round(size * 0.11),
          boxShadow: '0 2px 0 rgba(0,0,0,.45)',
        }}
      >
        <span
          className="font-mono font-extrabold leading-none"
          style={{ fontSize: Math.round(size * 0.62), color: late ? '#fff' : '#101316', letterSpacing: -1 }}
        >
          {v}
        </span>
        <span className="absolute inset-x-0 top-1/2 h-[2px]" style={{ background: 'rgba(0,0,0,.22)' }} />
      </span>
      {label && (
        <span className="text-[11px] font-bold tracking-widest" style={{ color: '#AFC0D4' }}>
          {label}
        </span>
      )}
    </span>
  )
}

function Countdown({ sec, size }: { sec: number; size: number }) {
  const late = sec < 0
  const a = Math.abs(sec)
  return (
    <span className="inline-flex items-center gap-[6px]">
      {late && (
        <span className="font-extrabold" style={{ fontSize: size * 0.6, color: '#FF4040' }}>
          −
        </span>
      )}
      <Flip v={p2(Math.floor(a / 3600))} size={size} late={late} />
      <span className="font-extrabold" style={{ fontSize: size * 0.45, color: late ? '#FF4040' : '#5A646F' }}>
        :
      </span>
      <Flip v={p2(Math.floor(a / 60) % 60)} size={size} late={late} />
    </span>
  )
}

export default function TruckBoard() {
  const nav = useNavigate()
  const [tick, setTick] = useState(0)
  const board = useAsync(() => listTruckBoard(), [tick])
  const branches = useAsync(() => listTruckBranches(), [tick])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  // กระดานต้องสดพอจะเชื่อได้ · คนอื่นกดปล่อยแล้วต้องหายไปเองภายในไม่กี่วินาที
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20_000)
    return () => clearInterval(t)
  }, [])

  const [filter, setFilter] = useState<'urgent' | 'all'>('urgent')
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(() => Number(localStorage.getItem('truck.min')) || 120)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ id: number; name: string } | null>(null)

  const rows = board.data ?? []
  const live = useMemo(
    () => rows.map((r) => ({ r, sec: secondsLeft(r.due_at, now) })).sort((a, b) => a.sec - b.sec),
    [rows, now],
  )
  const over = live.filter((x) => x.sec < 0).length
  const soon = live.filter((x) => x.sec >= 0 && x.sec <= 30 * 60).length
  const shown = filter === 'all' ? live : live.filter((x) => x.sec <= 30 * 60)

  // ค้นได้ทั้งรหัสและชื่อไทย · กลางดึกคนจำชื่อไทยได้ง่ายกว่ารหัส
  const hits = useMemo(() => {
    const q = name.trim().toLowerCase()
    if (q.length < 1) return [] as TruckBranch[]
    return (branches.data ?? [])
      .filter((b) => `${b.name} ${b.code ?? ''} ${b.full_name ?? ''}`.toLowerCase().includes(q))
      .slice(0, 6)
  }, [branches.data, name])
  const exact = (branches.data ?? []).some(
    (b) => b.name.trim().toLowerCase() === name.trim().toLowerCase(),
  )

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      setTick((n) => n + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!name.trim()) return
    localStorage.setItem('truck.min', String(minutes))
    await run(async () => {
      await addTruck({ name: name.trim(), minutes })
      setName('')
    })
  }

  const clock = new Date(now)

  return (
    <div className="min-h-dvh" style={{ background: '#0B0E11', color: '#F0F4F9' }}>
      {/* ───────── หัว ───────── */}
      <header
        className="safe-t sticky top-0 z-20 flex flex-wrap items-center gap-3 px-4 py-3"
        style={{ background: '#0B0E11', borderBottom: '1px solid #243040' }}
      >
        <button
          type="button"
          aria-label="ย้อนกลับ"
          className="h-tap w-tap rounded-btn text-xl"
          style={{ color: '#AFC0D4' }}
          onClick={() => nav('/')}
        >
          ←
        </button>
        <span
          className="rounded-md px-2.5 py-1 text-sm font-extrabold"
          style={{ background: '#FFC400', color: '#0B0E11' }}
        >
          FLASH
        </span>
        <span className="text-lg font-bold">ตารางปล่อยรถ · 21BPL</span>
        <span className="flex-1" />
        <span className="text-sm" style={{ color: '#AFC0D4' }}>
          {DAY[clock.getDay()]} {dmy(clock)}
        </span>
        <span className="font-mono text-xl font-bold" style={{ color: '#FFC400' }}>
          {hm(clock)}:{p2(clock.getSeconds())}
        </span>
      </header>

      {/* ───────── ตัวเลขรวม ───────── */}
      <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: '#243040' }}>
        {[
          ['อยู่ในคลังตอนนี้', `${live.length} คัน`, '#F0F4F9'],
          ['เลยกำหนด', `${over} คัน`, '#FF5C5C'],
          ['ใกล้หมดเวลา', `${soon} คัน`, '#FFB038'],
          ['รอนานสุด', live.length ? fmtWait(live[0].sec) : '—', '#AFC0D4'],
        ].map(([a, b, c]) => (
          <div key={a} className="px-4 py-3" style={{ background: '#0B0E11' }}>
            <div className="text-xs" style={{ color: '#AFC0D4' }}>
              {a}
            </div>
            <div className="text-2xl font-extrabold" style={{ color: c }}>
              {b}
            </div>
          </div>
        ))}
      </div>

      {err && (
        <p className="mx-4 mt-3 rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(255,92,92,.12)', color: '#FF9A9A' }}>
          {err}
        </p>
      )}

      {undo && (
        <div
          className="mx-4 mt-3 flex items-center gap-3 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'rgba(53,217,138,.12)', color: '#8FE8BC' }}
        >
          <span className="flex-1">ปล่อย {undo.name} แล้ว</span>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 font-bold"
            style={{ background: '#1B2430', color: '#F0F4F9' }}
            onClick={() => void run(() => unreleaseTruck(undo.id)).then(() => setUndo(null))}
          >
            เลิกทำ
          </button>
        </div>
      )}

      {/* ───────── เพิ่มรถ ───────── */}
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px] flex-1">
            <div className="mb-1 text-xs" style={{ color: '#AFC0D4' }}>
              สาขา · พิมพ์รหัสหรือชื่อไทยก็ได้
            </div>
            <input
              className="w-full rounded-lg px-3 py-2.5 text-base outline-none"
              style={{ background: '#141920', border: '1px solid #2A313B', color: '#F0F4F9' }}
              value={name}
              placeholder="เช่น บางนา หรือ 2BNA01"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
            />
            {name.trim() && (
              <div
                className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg"
                style={{ background: '#141920', border: '1px solid #2A313B' }}
              >
                {hits.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left"
                    style={{ borderBottom: '1px solid #222A33' }}
                    onClick={() => setName(b.name)}
                  >
                    <span className="text-sm">{b.name}</span>
                    {b.code && (
                      <span className="ml-2 font-mono text-xs" style={{ color: '#AFC0D4' }}>
                        {b.code}
                      </span>
                    )}
                    {!b.is_open && (
                      <span className="ml-2 text-xs" style={{ color: '#FFB038' }}>
                        ปิดบริการ
                      </span>
                    )}
                    {(b.province || b.district) && (
                      <span className="block text-xs" style={{ color: '#AFC0D4' }}>
                        {[b.province, b.district, b.subdistrict].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                ))}
                {!exact && (
                  <div className="px-3 py-2 text-sm" style={{ color: '#FFC400' }}>
                    + เพิ่ม “{name.trim()}” เป็นสาขาใหม่
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs" style={{ color: '#AFC0D4' }}>
              ให้เวลา
            </div>
            <select
              className="h-tap rounded-lg px-3 text-base outline-none"
              style={{ background: '#141920', border: '1px solid #2A313B', color: '#F0F4F9' }}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {ALLOW.map((m) => (
                <option key={m} value={m}>
                  {m / 60} ชั่วโมง
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="h-tap rounded-lg px-6 text-base font-extrabold"
            style={{ background: '#FFC400', color: '#0B0E11' }}
            disabled={busy || !name.trim()}
            onClick={() => void save()}
          >
            บันทึก
          </button>
        </div>
        <p className="mt-2 text-xs" style={{ color: '#AFC0D4' }}>
          เวลาถึงคลังใช้เวลาที่กดบันทึก · ระบบจำชั่วโมงที่เลือกล่าสุดไว้ให้
        </p>
      </div>

      {/* ───────── ชิปกรอง ───────── */}
      <div className="flex flex-wrap gap-2 px-4 pt-5">
        <Chip on={filter === 'urgent'} onClick={() => setFilter('urgent')} color="#FF5C5C">
          ต้องรีบ {over + soon}
        </Chip>
        <Chip on={filter === 'all'} onClick={() => setFilter('all')} color="#AFC0D4">
          ทั้งหมด {live.length}
        </Chip>
      </div>

      {/* ───────── รายการ ───────── */}
      <div className="px-4 pb-10 pt-3">
        {board.loading && rows.length === 0 && (
          <p className="py-10 text-center" style={{ color: '#AFC0D4' }}>
            กำลังโหลด…
          </p>
        )}
        {board.error && (
          <p className="py-10 text-center" style={{ color: '#FF9A9A' }}>
            {board.error}
          </p>
        )}
        {!board.loading && shown.length === 0 && (
          <p className="py-10 text-center" style={{ color: '#AFC0D4' }}>
            {live.length === 0 ? 'ยังไม่มีรถในคลัง' : 'ไม่มีคันที่ต้องรีบตอนนี้'}
          </p>
        )}

        <div className="space-y-2">
          {shown.map(({ r, sec }) => (
            <Row key={r.id} row={r} sec={sec} busy={busy} onRelease={() =>
              void run(async () => {
                await releaseTruck(r.id)
                setUndo({ id: r.id, name: r.branch_name })
                window.setTimeout(() => setUndo(null), 10_000)
              })
            } />
          ))}
        </div>
      </div>
    </div>
  )
}

function Chip({
  on,
  color,
  onClick,
  children,
}: {
  on: boolean
  color: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="rounded-full px-4 py-2 text-sm font-bold"
      style={on ? { background: color, color: '#0B0E11' } : { background: '#1B2430', color }}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Row({
  row,
  sec,
  busy,
  onRelease,
}: {
  row: TruckBoardRow
  sec: number
  busy: boolean
  onRelease: () => void
}) {
  const c = tone(sec)
  const arr = new Date(row.arrived_at)
  const due = new Date(row.due_at)
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl px-4 py-3"
      style={{ background: '#121820', borderLeft: `5px solid ${c}` }}
    >
      <div className="min-w-[150px] flex-1">
        <div className="text-base font-bold">{row.branch_name}</div>
        <div className="font-mono text-xs" style={{ color: '#AFC0D4' }}>
          {row.branch_code ?? '—'}
        </div>
      </div>

      <div className="text-sm" style={{ color: '#AFC0D4' }}>
        ถึงคลัง{' '}
        <b className="font-mono text-base" style={{ color: '#F0F4F9' }}>
          {hm(arr)}
        </b>{' '}
        {dmy(arr)}
        <br />
        ควรออก{' '}
        <b className="font-mono text-base" style={{ color: '#F0F4F9' }}>
          {hm(due)}
        </b>{' '}
        {dmy(due)}
      </div>

      <Countdown sec={sec} size={46} />

      <button
        type="button"
        className="h-tap rounded-lg px-5 text-base font-extrabold"
        style={{ background: '#FFC400', color: '#0B0E11' }}
        disabled={busy}
        onClick={onRelease}
      >
        ปล่อยรถ
      </button>
    </div>
  )
}

/** รอมานานเท่าไหร่แล้ว · ใช้กับคันที่ค้างนานที่สุด */
function fmtWait(sec: number): string {
  const a = Math.abs(sec)
  return `${p2(Math.floor(a / 3600))}:${p2(Math.floor(a / 60) % 60)}`
}
