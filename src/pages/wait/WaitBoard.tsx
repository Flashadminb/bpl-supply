import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { readableError } from '../../lib/supabase'
import {
  cancelWaitTruck,
  doneWaitTruck,
  listWaitBoard,
  listWaitDone,
  undoneWaitTruck,
  WAIT_CANCEL_REASONS,
  type WaitTruckRow,
} from '../../lib/waitTrucks'
import { Modal } from '../../components/ui'
import { useAlarmPref, useTruckAlarm } from '../trucks/alarm'
import { AlarmGate, EdgeGlow, worstStage } from '../trucks/alert-ui'
import { playWaitAlarm, WAIT_ALARM_PREF } from './waitAlarm'
import {
  BG,
  CARD,
  clock,
  Chip,
  DIM,
  Field,
  Inset,
  INSET,
  LINE,
  liveState,
  nf,
  PhoneIcon,
  Pill,
  secLeft,
  STATE_COLOR,
  Strip,
  Timer,
  FLASH_MS,
  FlashBell,
  WaitAlarmChip,
  WaitLogo,
} from './parts'

/**
 * กระดานรถรอลงงาน
 *
 * ของเดิมคือไฟล์ Excel ที่มีสูตรนับถอยหลังกับ VBA ซึ่งพังสองทาง
 * ต้องกดปุ่มเริ่มนาฬิกาเอง ลืมกดแล้วตัวเลขค้างทั้งวัน
 * และช่องทัน-ไม่ทันเป็นช่องให้ติ๊กมือ ซึ่งติ๊กให้สวยได้ สถิติจึงเชื่อไม่ได้
 *
 * ของใหม่ไม่มีปุ่มเริ่ม นาฬิกาเดินตั้งแต่เวลารถถึงที่อยู่ในไฟล์อยู่แล้ว
 * และมีปุ่มเดียวคือลงงานเสร็จ ทัน-ไม่ทันตัดสินจากนาฬิกาตอนกด
 *
 * ไม่มีขั้น "กำลังลงงาน" โดยตั้งใจ · ปุ่มที่ต้องกดสองครั้ง
 * คือปุ่มที่หน้างานจะลืมกดครั้งแรก แล้วตัวเลขทั้งกระดานก็เชื่อไม่ได้อีก
 */

export default function WaitBoard() {
  const nav = useNavigate()
  const board = useAsync(listWaitBoard, [])
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [phone, setPhone] = useState<WaitTruckRow | null>(null)
  const [cancelling, setCancelling] = useState<WaitTruckRow | null>(null)
  const [showDone, setShowDone] = useState(false)
  const alarm = useAlarmPref(WAIT_ALARM_PREF)

  // นาฬิกาเดินในเครื่อง ไม่ได้ถามเซิร์ฟเวอร์ทุกวินาที
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // ดึงของใหม่ทุกนาที และหยุดดึงเมื่อหน้าถูกพับไว้ ไม่ให้กินโควตาเปล่า
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') board.reload()
    }, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = board.data ?? []

  const live = useMemo(
    () => rows.map((r) => ({ r, sec: secLeft(r, now) })).sort((a, b) => a.sec - b.sec),
    [rows, now],
  )

  /**
   * คันที่เพิ่งโผล่มาครั้งแรกจะถูกจำไว้เงียบ ๆ ไม่ปลุกเสียง
   * ซึ่งคือสิ่งที่ต้องการพอดี — ไฟล์รายชั่วโมงมักมีคันที่เลยเวลามาตั้งแต่ก่อนอัป
   * ปลุกย้อนหลังใส่คนที่เพิ่งกดอัปไฟล์ไม่ได้ช่วยอะไร เขาเห็นสีแดงอยู่แล้ว
   */
  const fired = useTruckAlarm(
    useMemo(() => live.map(({ r, sec }) => ({ id: r.id, sec })), [live]),
    alarm.on,
    playWaitAlarm,
  )

  /** คันที่เพิ่งเตือน · หายเองหลัง FLASH_MS เพราะ now เดินทุกวินาที */
  const flashing = useMemo(
    () => new Set(now - fired.at < FLASH_MS ? fired.ids : []),
    [fired, now],
  )

  const count = useMemo(() => {
    let over = 0
    let warn = 0
    let wait = 0
    let pcs = 0
    for (const { r, sec } of live) {
      const st = liveState(r, sec)
      if (st === 'overdue') over++
      else if (st === 'warn') warn++
      else wait++
      pcs += r.parcels ?? 0
    }
    return { over, warn, wait, pcs }
  }, [live])

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusy(id)
    setErr(null)
    try {
      await fn()
      board.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="min-h-dvh pb-24 text-white" style={{ background: BG }}>
      <EdgeGlow stage={worstStage(live.map(({ sec }) => ({ sec })))} />
      <AlarmGate open={!alarm.asked} onEnable={() => void alarm.turnOn()} onSkip={alarm.decline} />

      <header className="sticky top-0 z-20 px-3 pb-2 pt-3" style={{ background: BG }}>
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              <WaitLogo size={20} />
            </span>
            <WaitAlarmChip on={alarm.on} onTurnOn={() => void alarm.turnOn()} compact />
            <HeadBtn onClick={() => nav('/wait/upload')} tone="go">
              อัปไฟล์
            </HeadBtn>
            <HeadBtn onClick={() => nav('/wait/tv')}>ทีวี</HeadBtn>
          </div>

          <div className="flex gap-2">
            <Chip label="เกินเวลา" n={count.over} color="#E5484D" />
            <Chip label="เฝ้าระวัง" n={count.warn} color="#E8B931" />
            <Chip label="กำลังรอ" n={count.wait} color="#2F7FE0" />
            <Chip label="พัสดุยังไม่ลง" n={nf(count.pcs)} color="#1C2430" sub="ชิ้น" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-3">
        {err && (
          <div
            className="mb-3 rounded-xl p-3 text-sm font-bold"
            style={{ background: '#3A1416', border: '1px solid #E5484D', color: '#FFD9DA' }}
          >
            {err}
          </div>
        )}

        {board.loading && rows.length === 0 && (
          <p className="py-16 text-center text-sm" style={{ color: DIM }}>
            กำลังโหลดกระดาน…
          </p>
        )}

        {board.error && (
          <div className="rounded-2xl p-4 text-center" style={{ background: CARD }}>
            <p className="text-sm font-bold" style={{ color: '#FFB4B6' }}>
              {board.error}
            </p>
            <button
              onClick={board.reload}
              className="mt-3 h-11 rounded-xl px-5 text-sm font-bold"
              style={{ background: INSET, border: `1px solid ${LINE}` }}
            >
              ลองใหม่
            </button>
          </div>
        )}

        {!board.loading && !board.error && rows.length === 0 && (
          <div className="rounded-2xl p-8 text-center" style={{ background: CARD }}>
            <p className="text-base font-bold">ยังไม่มีรถรอลงงาน</p>
            <p className="mt-1 text-sm" style={{ color: DIM }}>
              โหลดไฟล์รายงานจากระบบบริษัทแล้วโยนเข้ามาได้เลย
            </p>
            <button
              onClick={() => nav('/wait/upload')}
              className="mt-4 h-12 rounded-xl px-6 text-sm font-extrabold"
              style={{ background: '#2F7FE0' }}
            >
              อัปไฟล์
            </button>
          </div>
        )}

        <div className="space-y-3">
          {live.map(({ r, sec }) => (
            <TruckCard
              key={r.id}
              r={r}
              sec={sec}
              busy={busy === r.id}
              flash={flashing.has(r.id)}
              onDone={() => void act(r.id, () => doneWaitTruck(r.id))}
              onPhone={() => setPhone(r)}
              onCancel={() => setCancelling(r)}
            />
          ))}
        </div>

        <button
          onClick={() => setShowDone(true)}
          className="mt-6 h-12 w-full rounded-xl text-sm font-bold"
          style={{ background: CARD, border: `1px solid ${LINE}`, color: DIM }}
        >
          ดูคันที่ลงงานเสร็จแล้ว
        </button>
      </main>
      </div>

      {/*
        กล่องเด้งอยู่นอก div ที่ตั้ง text-white ไว้ โดยตั้งใจ
        Modal ใช้พื้นขาวของแอพปกติ ถ้าอยู่ข้างในจะสืบสีขาวลงไปด้วย
        แล้วชื่อกับเบอร์คนขับจะกลายเป็นตัวขาวบนพื้นขาว ซึ่งมองไม่เห็นเลย
      */}
      {phone && <PhoneCard r={phone} onClose={() => setPhone(null)} />}

      {cancelling && (
        <CancelBox
          r={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(reason) => {
            const id = cancelling.id
            setCancelling(null)
            void act(id, () => cancelWaitTruck(id, reason))
          }}
        />
      )}

      {showDone && (
        <DoneList onClose={() => setShowDone(false)} onChanged={board.reload} />
      )}
    </>
  )
}

function HeadBtn({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'go'
}) {
  return (
    <button
      onClick={onClick}
      className="h-11 shrink-0 rounded-xl px-3 text-[13px] font-extrabold"
      style={
        tone === 'go'
          ? { background: '#2F7FE0', color: '#fff' }
          : { background: CARD, border: `1px solid ${LINE}`, color: '#EAF0F7' }
      }
    >
      {children}
    </button>
  )
}

/**
 * การ์ดหนึ่งคัน
 *
 * ลำดับความเด่นที่เจ้าของระบบเคาะไว้ · เวลารถถึงจริง แล้วสถานีก่อนหน้ากับจำนวนพัสดุ
 * แล้วทะเบียนกับบาร์โค้ดกับประเภทรถ แล้วชื่อกับเบอร์คนขับ
 * ข้อมูลครบทั้งแปดช่องบนทุกการ์ด ชื่อสถานีขึ้นเต็มไม่ตัดคำ
 *
 * ชื่อคนขับกับเบอร์อยู่หลังปุ่มรูปโทรศัพท์ ไม่ได้อยู่บนการ์ด
 * เพราะมันเป็นข้อมูลที่ใช้ตอนต้องโทรเท่านั้น ซึ่งไม่ใช่ตอนที่กำลังกวาดสายตาหากระดาน
 */
function TruckCard({
  r,
  sec,
  busy,
  flash,
  onDone,
  onPhone,
  onCancel,
}: {
  r: WaitTruckRow
  sec: number
  busy: boolean
  /** เพิ่งมีเสียงเตือนเพราะคันนี้ · ขึ้นกระดิ่งกระพริบให้รู้ว่าคันไหน */
  flash: boolean
  onDone: () => void
  onPhone: () => void
  onCancel: () => void
}) {
  const st = liveState(r, sec)
  const color = STATE_COLOR[st]

  return (
    <article
      className="relative overflow-hidden rounded-2xl"
      style={{ background: CARD, border: `1px solid ${LINE}` }}
    >
      <Strip color={color} />

      <div className="py-3 pl-5 pr-3">
        <div className="mb-2 flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[17px] font-extrabold leading-tight">
            {r.from_station ?? 'ไม่ระบุสถานีก่อนหน้า'}
          </h2>
          {flash && <FlashBell size={18} />}
          <Pill state={st} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Inset className="shrink-0">
            <div className="flex gap-4">
              <Field label="รถถึงจริง" value={clock(r.arrived_at)} size={22} />
              <Field
                label="ต้องเสร็จก่อน"
                value={clock(r.due_at)}
                size={22}
                color={sec < 0 ? '#FF8A8A' : '#EAF0F7'}
              />
            </div>
          </Inset>

          <div className="flex min-w-0 flex-1 justify-end">
            <Timer sec={sec} size={44} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className="rounded-md px-2 py-[3px] text-[12px] font-extrabold"
            style={{ background: '#1C2430', color: '#9FB4CC' }}
          >
            {r.vehicle_type ?? '—'}
          </span>
          <span className="text-[13px] font-bold">ทะเบียน {r.plate ?? '—'}</span>
          <span className="text-[12px]" style={{ color: DIM }}>
            {r.truck_barcode}
          </span>
          <span className="text-[13px] font-extrabold" style={{ color: '#FFD479' }}>
            {nf(r.parcels)} ชิ้น
          </span>

          <button
            onClick={onPhone}
            aria-label="ดูชื่อและเบอร์พนักงานขับรถ"
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ background: INSET, border: `1px solid ${LINE}` }}
          >
            <PhoneIcon />
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            disabled={busy}
            onClick={onDone}
            className="h-12 flex-1 rounded-xl text-[15px] font-extrabold disabled:opacity-50"
            style={{ background: '#25A35A', color: '#fff' }}
          >
            {busy ? 'กำลังบันทึก…' : 'ลงงานเสร็จ'}
          </button>
          <button
            disabled={busy}
            onClick={onCancel}
            className="h-12 shrink-0 rounded-xl px-4 text-[13px] font-bold disabled:opacity-50"
            style={{ background: INSET, border: `1px solid ${LINE}`, color: '#FFB4B6' }}
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </article>
  )
}

/** ชื่อและเบอร์คนขับ · เปิดเมื่อต้องโทรเท่านั้น */
function PhoneCard({ r, onClose }: { r: WaitTruckRow; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const tel = (r.driver_phone ?? '').replace(/[^0-9+]/g, '')

  return (
    <Modal open onClose={onClose} title="พนักงานขับรถ">
      <div className="space-y-3">
        <p className="text-xl font-extrabold">{r.driver_name ?? 'ไม่มีชื่อในไฟล์'}</p>
        <p className="font-mono text-2xl font-extrabold tracking-wide">{r.driver_phone ?? '—'}</p>

        <div className="rounded-xl p-3 text-sm" style={{ background: '#F3F5F8' }}>
          <Line k="บริษัทรถ" v={r.carrier} />
          <Line k="ทะเบียน" v={r.plate} />
          <Line k="บาร์โค้ดรถ" v={r.truck_barcode} />
          <Line k="เส้นทาง" v={r.route_name} />
        </div>

        {tel !== '' && (
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`tel:${tel}`}
              className="flex h-12 items-center justify-center rounded-xl text-sm font-extrabold text-white"
              style={{ background: '#25A35A' }}
            >
              โทรเลย
            </a>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(tel).then(() => setCopied(true))
              }}
              className="h-12 rounded-xl text-sm font-bold"
              style={{ background: '#E8ECF2' }}
            >
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกเบอร์'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Line({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-ink-500">{k}</span>
      <span className="min-w-0 break-all text-right font-bold">{v ?? '—'}</span>
    </div>
  )
}

/**
 * ยกเลิกพร้อมเหตุผล
 *
 * บังคับใส่เหตุผลเหมือนตารางปล่อยรถ เพราะปุ่มที่กดแล้วของหายโดยไม่ต้องอธิบาย
 * คือปุ่มที่วันหนึ่งจะถูกใช้ลบสิ่งที่ไม่อยากให้ใครเห็น · แถวไม่ถูกลบจริง
 */
function CancelBox({
  r,
  onClose,
  onDone,
}: {
  r: WaitTruckRow
  onClose: () => void
  onDone: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Modal open onClose={onClose} title={`ยกเลิก ${r.truck_barcode}`}>
      <p className="mb-3 text-sm text-ink-500">
        แถวนี้ไม่ถูกลบ ยังอยู่ในสถิติว่าถูกยกเลิกพร้อมเหตุผลและชื่อคนกด
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {WAIT_CANCEL_REASONS.map((x) => (
          <button
            key={x}
            onClick={() => setReason(x)}
            className="h-11 rounded-xl px-3 text-sm font-bold"
            style={
              reason === x
                ? { background: '#1F2937', color: '#fff' }
                : { background: '#EEF1F5', color: '#1F2937' }
            }
          >
            {x}
          </button>
        ))}
      </div>

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="หรือพิมพ์เหตุผลเอง"
        className="w-full rounded-xl border p-3 text-sm"
      />

      <button
        disabled={reason.trim() === ''}
        onClick={() => onDone(reason.trim())}
        className="mt-3 h-12 w-full rounded-xl text-sm font-extrabold text-white disabled:opacity-40"
        style={{ background: '#E5484D' }}
      >
        {reason.trim() === '' ? 'ต้องใส่เหตุผลก่อน' : 'ยืนยันยกเลิก'}
      </button>
    </Modal>
  )
}

/**
 * คันที่จบไปแล้วในรอบนี้
 *
 * มีไว้เพื่ออย่างเดียวคือกดเสร็จผิดคันแล้วเอากลับขึ้นกระดาน
 * ไม่ได้ทำเป็นหน้าประวัติ เพราะประวัติจริงอยู่ที่หน้าสถิติหลังบ้าน
 */
function DoneList({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), [])
  const done = useAsync(() => listWaitDone(since), [since])
  const rows = done.data ?? []
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  /**
   * เอากลับขึ้นกระดานแล้วโหลดรายการนี้ใหม่ด้วย ไม่ใช่โหลดแค่กระดานข้างหลัง
   * ไม่งั้นคันที่เพิ่งเอากลับไปแล้วยังค้างอยู่ในรายการนี้ แล้วคนจะกดซ้ำ
   */
  async function undo(id: number) {
    setBusy(id)
    setErr(null)
    try {
      await undoneWaitTruck(id)
      done.reload()
      onChanged()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open onClose={onClose} title="ลงงานเสร็จแล้ว 24 ชั่วโมงที่ผ่านมา">
      {done.loading && <p className="py-6 text-center text-sm text-ink-500">กำลังโหลด…</p>}
      {done.error && <p className="py-6 text-center text-sm text-danger">{done.error}</p>}
      {err && <p className="py-2 text-center text-sm text-danger">{err}</p>}
      {!done.loading && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-ink-500">ยังไม่มีคันที่กดเสร็จ</p>
      )}

      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-xl border p-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{r.from_station ?? r.truck_barcode}</p>
              <p className="truncate text-[12px] text-ink-500">
                {r.vehicle_type} · ถึง {clock(r.arrived_at)} · เสร็จ{' '}
                {r.done_at ? clock(r.done_at) : '—'} ·{' '}
                <span
                  className="font-bold"
                  style={{ color: r.state === 'done_ontime' ? '#167C45' : '#C32F34' }}
                >
                  {r.state === 'done_ontime' ? 'ทันเวลา' : 'ไม่ทัน'}
                </span>
              </p>
            </div>
            <button
              disabled={busy === r.id}
              onClick={() => void undo(r.id)}
              className="h-11 shrink-0 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
              style={{ background: '#EEF1F5' }}
            >
              {busy === r.id ? 'กำลังเอากลับ…' : 'เอากลับขึ้นกระดาน'}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
