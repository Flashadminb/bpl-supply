import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  addTruck,
  listTruckBoard,
  listTruckBranches,
  kindLabels,
  releaseTruck,
  secondsLeft,
  truckCounts,
  unreleaseTruck,
  type TruckBoardRow,
  type TruckBranch,
  type TruckKind,
} from '../../lib/trucks'
import { Countdown, DAY_TH, Density, dmy, hm, KindTag, p2, tone } from './parts'
import { useAlarmPref, useTruckAlarm } from './alarm'
import { AlarmChip, AlarmGate, EdgeGlow, StageSummary, UrgentRail, worstStage } from './alert-ui'

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

/** ชั่วโมงที่ให้ · หนึ่งชั่วโมงมีจริงสำหรับรถที่แวะสั้น ๆ */
const ALLOW = [60, 120, 180, 240]

/** เวลาตอนนี้ในรูป HH:MM สำหรับช่องกรอกเวลา */
function nowHM(): string {
  const d = new Date()
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/**
 * จัดรูปเวลาที่พิมพ์เข้ามาให้เป็น HH:MM แบบไทย
 *
 * ไม่ใช้ช่องเวลาของเบราว์เซอร์ เพราะมันขึ้นรูปแบบตามภาษาของเครื่อง
 * เครื่องที่ตั้งเป็นอังกฤษจะได้ 12:45 PM ซึ่งหน้างานต้องแปลในหัวทุกครั้ง
 * และแปลผิดตอนตีหนึ่งกับบ่ายโมงได้ง่ายมาก
 *
 * ช่องนี้จึงรับแต่ตัวเลข แล้วใส่จุดคู่ให้เอง · พิมพ์ 0930 ได้ 09:30
 */
function fmtHM(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}:${d.slice(2)}`
}

const HM_OK = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * แปลงเวลาที่กรอก (HH:MM) เป็นเวลาจริง
 *
 * งานรันยี่สิบสี่ชั่วโมง ตีหนึ่งแล้วกรอกย้อนว่า 23:50 คือเมื่อวาน ไม่ใช่คืนนี้
 * ถ้าไม่ดักไว้ เวลาที่ได้จะเป็นอนาคตเกือบยี่สิบสี่ชั่วโมง และรถคันนั้นจะไม่มีวันครบกำหนด
 * เผื่อล่วงหน้าไว้หนึ่งชั่วโมง เพราะนาฬิกาเครื่องหน้างานกับเซิร์ฟเวอร์ไม่ตรงกันเป๊ะ
 */
function hmToDate(hm: string): Date {
  const [h, m] = hm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  if (d.getTime() > Date.now() + 3600_000) d.setDate(d.getDate() - 1)
  return d
}

/** มาจากจอทีวีแล้วไม่ได้แตะอะไรนานเท่านี้ ให้กลับไปจอทีวีเอง */
const IDLE_SEC = 20

export default function TruckBoard() {
  const nav = useNavigate()
  const [qs] = useSearchParams()
  const kiosk = qs.get('kiosk') === '1'
  const [tick, setTick] = useState(0)
  const board = useAsync(() => listTruckBoard(), [tick])
  const branches = useAsync(() => listTruckBranches(), [tick])
  // ตัวเลขชุดเดียวกับจอทีวี · ฐานข้อมูลนับให้ในคำขอเดียว
  const counts = useAsync(() => truckCounts(), [tick])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  /**
   * ดึงข้อมูลใหม่ทุกนาที และหยุดดึงเมื่อไม่มีใครมองอยู่
   *
   * หน้านี้ถูกเปิดค้างไว้ทั้งกะ และอาจเปิดพร้อมกันหลายจอรวมจอทีวี
   * ถ้าดึงทุก 20 วินาทีตลอด 24 ชั่วโมง จอเดียวกินโควตา egress ราว 2.5 GB ต่อเดือน
   * จากโควตาฟรี 5 GB ซึ่งแปลว่าเปิดสองจอก็เต็มแล้ว
   *
   * นาฬิกานับถอยหลังเดินในเครื่องอยู่แล้ว ตัวเลขจึงไม่ค้างแม้จะยังไม่ได้ดึงใหม่
   * สิ่งเดียวที่ช้าลงคือการเห็นว่าคนอื่นเพิ่งกดปล่อยรถ ซึ่งรอหนึ่งนาทีได้
   */
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1)
    }, 60_000)
    // กลับมาดูอีกทีต้องเห็นของสดทันที ไม่ใช่รออีกหนึ่งนาที
    const wake = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1)
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  /**
   * กลับจอทีวีเองเมื่อไม่มีใครแตะ
   *
   * เครื่องที่ต่อจอในคลังเป็นเครื่องเดียวกับที่ใช้กรอกรถเข้า
   * ถ้าไม่เด้งกลับเอง จอจะค้างอยู่หน้ากรอกข้อมูลทั้งกะ แล้วไม่มีใครเห็นเวลาอีกเลย
   * นับเฉพาะตอนเข้ามาจากจอทีวี · เปิดหน้านี้ตรง ๆ จากมือถือไม่โดนเด้ง
   */
  const [idle, setIdle] = useState(IDLE_SEC)
  useEffect(() => {
    if (!kiosk) return
    const wake = () => setIdle(IDLE_SEC)
    const evs: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input']
    evs.forEach((e) => document.addEventListener(e, wake, { passive: true }))
    const t = setInterval(() => setIdle((n) => n - 1), 1000)
    return () => {
      evs.forEach((e) => document.removeEventListener(e, wake))
      clearInterval(t)
    }
  }, [kiosk])
  useEffect(() => {
    if (kiosk && idle <= 0) nav('/trucks/tv', { replace: true })
  }, [kiosk, idle, nav])

  /**
   * ตั้งต้นที่ทั้งหมด ไม่ใช่เฉพาะคันที่ต้องรีบ
   *
   * คนเปิดหน้านี้มาเพื่อกดปล่อยรถคันที่จอดอยู่ตรงหน้า ไม่ใช่มาดูว่าคันไหนด่วนที่สุด
   * ถ้าตั้งต้นที่ต้องรีบ คันที่เขาจะกดมักไม่อยู่ในรายการ แล้วต้องกดชิปก่อนทุกครั้ง
   */
  const [filter, setFilter] = useState<'urgent' | 'all'>('all')
  /** ช่องค้นในคลัง · คนละช่องกับช่องกรอกสาขาเข้าใหม่ */
  const [find, setFind] = useState('')
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(() => Number(localStorage.getItem('truck.min')) || 120)
  const [kind, setKind] = useState<TruckKind>('main')
  /** เวลาถึงคลัง · ตั้งต้นเป็นเวลาตอนนี้ และเดินตามนาฬิกาจนกว่าจะมีคนแก้เอง */
  const [atHM, setAtHM] = useState(nowHM)
  const [atTouched, setAtTouched] = useState(false)
  useEffect(() => {
    if (atTouched) return
    const t = setInterval(() => setAtHM(nowHM()), 20_000)
    return () => clearInterval(t)
  }, [atTouched])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ id: number; name: string } | null>(null)
  const [dup, setDup] = useState<{ name: string; hits: TruckBoardRow[] } | null>(null)
  /**
   * ป้ายยืนยันหลังกดบันทึก
   *
   * เน็ตในฮับไม่นิ่ง และปุ่มบันทึกเดิมแค่ล้างช่องแล้วเงียบ
   * คนกรอกจึงไม่มีทางแยกระหว่าง "บันทึกติดแล้ว" กับ "กดไม่ติด ช่องมันล้างเองเพราะอะไรสักอย่าง"
   * ผลคือกดซ้ำเผื่อไว้ แล้วได้รถผีเพิ่มมาอีกคัน
   *
   * ข้อมูลทุกตัวบนป้ายนี้มาจากสิ่งที่เรารู้อยู่แล้วตอนกด ไม่ได้ถามเซิร์ฟเวอร์เพิ่มสักคำขอ
   */
  const [saved, setSaved] = useState<{
    name: string
    code: string | null
    due: number
    isNew: boolean
    kind: TruckKind
  } | null>(null)

  const rows = board.data ?? []
  const live = useMemo(
    () => rows.map((r) => ({ r, sec: secondsLeft(r.due_at, now) })).sort((a, b) => a.sec - b.sec),
    [rows, now],
  )
  // ป้ายรถหลัก/รถเสริม ของสาขานั้น
  const tags = useMemo(() => kindLabels(rows), [rows])
  const over = live.filter((x) => x.sec < 0).length
  // ยี่สิบนาที ไม่ใช่สามสิบ · ให้ตรงกับจังหวะที่เสียงแรกดัง
  const soon = live.filter((x) => x.sec >= 0 && x.sec <= 20 * 60).length

  /* เสียงเตือน · ดังเฉพาะตอนมีคันข้ามเส้น ไม่ใช่ตอนเปิดหน้ามาเจอ */
  const pref = useAlarmPref()
  const alarmItems = live.map((x) => ({ id: x.r.id, sec: x.sec }))
  useTruckAlarm(alarmItems, pref.on)
  const urgent = live.map((x) => ({
    id: x.r.id,
    code: x.r.branch_code,
    name: x.r.branch_name,
    due: x.r.due_at,
    sec: x.sec,
    zone: x.r.zone,
    tag: tags.get(x.r.id),
  }))
  /**
   * พิมพ์ค้นแล้วค้นทั้งคลังเสมอ ไม่สนใจชิปที่เลือกไว้
   *
   * คนพิมพ์ชื่อสาขาลงไปแปลว่ารู้อยู่แล้วว่าจะหาคันไหน
   * ถ้ายังติดกรองของชิปอยู่ เขาจะได้ผลลัพธ์ว่างทั้งที่รถคันนั้นอยู่ในคลังจริง ๆ
   */
  const q2 = find.trim().toLowerCase()
  const shown = useMemo(() => {
    const base = q2 || filter === 'all' ? live : live.filter((x) => x.sec <= 20 * 60)
    if (!q2) return base
    return base.filter((x) =>
      `${x.r.branch_name} ${x.r.branch_code ?? ''} ${x.r.zone ?? ''}`.toLowerCase().includes(q2),
    )
  }, [live, filter, q2])

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

  /**
   * สาขาเดียวกันที่ยังไม่ได้ปล่อย
   *
   * รถสองคันจากสาขาเดียวกันจอดพร้อมกันเป็นเรื่องปกติ ระบบจึงต้องรับได้
   * แต่การกดบันทึกซ้ำเพราะคิดว่าครั้งแรกไม่ติด ก็หน้าตาเหมือนกันเป๊ะ
   * ถามหนึ่งครั้งจึงแยกสองกรณีนี้ออกจากกันได้ โดยไม่ขวางกรณีที่ถูกต้อง
   */
  function openDuplicates(q: string): TruckBoardRow[] {
    const k = q.trim().toLowerCase()
    return rows.filter(
      (r) =>
        r.branch_name.trim().toLowerCase() === k ||
        (r.branch_code ?? '').trim().toLowerCase() === k,
    )
  }

  async function save(force = false) {
    const q = name.trim()
    if (!q) return
    if (!HM_OK.test(atHM)) {
      setErr('เวลาที่รถถึงคลังต้องอยู่ในรูป ชั่วโมง:นาที แบบ 24 ชั่วโมง เช่น 09:30 หรือ 21:05')
      return
    }
    if (!force) {
      const hits = openDuplicates(q)
      if (hits.length > 0) {
        setDup({ name: q, hits })
        return
      }
    }
    localStorage.setItem('truck.min', String(minutes))
    setDup(null)
    const known = (branches.data ?? []).find(
      (x) =>
        x.name.trim().toLowerCase() === q.toLowerCase() ||
        (x.code ?? '').trim().toLowerCase() === q.toLowerCase(),
    )
    const at = hmToDate(atHM)
    await run(async () => {
      const res = await addTruck({ name: q, minutes, kind, arrivedAt: at.toISOString() })
      setName('')
      setAtTouched(false)
      setAtHM(nowHM())
      setSaved({
        name: res.branch,
        code: known?.code ?? null,
        due: at.getTime() + minutes * 60_000,
        isNew: !known,
        kind,
      })
      window.setTimeout(() => setSaved(null), 8_000)
    })
  }

  const clock = new Date(now)
  const openSecs = live.map((x) => x.sec)

  return (
    <div className="min-h-dvh" style={{ background: '#0B0E11', color: '#F0F4F9' }}>
      <EdgeGlow stage={worstStage(live)} />
      <AlarmGate open={!pref.on && !pref.asked} onEnable={() => void pref.turnOn()} onSkip={pref.decline} />
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
          {DAY_TH[clock.getDay()]} {dmy(clock)}
        </span>
        <span className="font-mono text-xl font-bold" style={{ color: '#FFC400' }}>
          {hm(clock)}:{p2(clock.getSeconds())}
        </span>
      </header>

      {kiosk && (
        <div
          className="flex items-center gap-3 px-4 py-2 text-sm"
          style={{ background: '#1B2430', color: '#AFC0D4' }}
        >
          <span className="flex-1">
            กลับจอทีวีเองใน <b style={{ color: '#FFC400' }}>{Math.max(0, idle)}</b> วินาที ·
            แตะอะไรก็ได้เพื่อเริ่มนับใหม่
          </span>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 font-bold"
            style={{ background: '#0B0E11', color: '#F0F4F9' }}
            onClick={() => nav('/trucks/tv', { replace: true })}
          >
            กลับเลย
          </button>
        </div>
      )}

      {/* ───────── ตัวเลขรวม ─────────
          ชุดเดียวกับจอทีวีเป๊ะ ๆ ไม่ให้สองจอบอกคนละเลข
          เพิ่มปล่อยไปแล้วกับรอนานสุด เพราะคนที่ยืนกรอกอยู่ตรงนี้คือคนที่ต้องตอบว่า
          กะนี้ทำได้เท่าไหร่แล้ว ซึ่งเดิมต้องเดินไปดูที่จอทีวีหรือเปิดหน้าสถิติ */}
      <div
        className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5"
        style={{ background: '#243040' }}
      >
        {[
          ['อยู่ในคลังตอนนี้', `${counts.data?.in_hub ?? live.length} คัน`, '#F0F4F9', null],
          ['เลยกำหนด', `${counts.data?.late ?? over} คัน`, '#FF5C5C', null],
          ['ใกล้หมดเวลา', `${counts.data?.soon ?? soon} คัน`, '#FFB038', null],
          [
            'ปล่อยไปแล้ว',
            `${counts.data?.done ?? 0} คัน`,
            '#35D98A',
            counts.data && counts.data.done > 0
              ? `ตรงเวลา ${counts.data.on_time} คัน · ${Math.round((counts.data.on_time / counts.data.done) * 100)}%`
              : 'เริ่มนับใหม่ได้ที่หลังบ้าน',
          ],
          [
            'รอนานสุด',
            live.length ? fmtWait(live[0].sec) : '—',
            '#AFC0D4',
            live.length ? live[0].r.branch_name : null,
          ],
        ].map(([a, b, c, d]) => (
          <div key={a as string} className="px-4 py-3" style={{ background: '#0B0E11' }}>
            <div className="text-xs" style={{ color: '#AFC0D4' }}>
              {a}
            </div>
            <div className="text-2xl font-extrabold" style={{ color: c as string }}>
              {b}
            </div>
            {d && (
              <div className="truncate text-xs" style={{ color: '#5A646F' }}>
                {d}
              </div>
            )}
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

      {/* ───────── เร่งด่วน ───────── */}
      {urgent.some((x) => x.sec <= 20 * 60) && (
        <div className="space-y-2 px-4 pt-4">
          <StageSummary items={live} />
          <UrgentRail items={urgent} />
        </div>
      )}

      {/* ───────── รถครบกำหนดช่วงไหน ───────── */}
      {live.length > 0 && (
        <div className="px-4 pt-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <span className="text-base font-bold">รถครบกำหนดช่วงไหนบ้าง</span>
            <span className="text-xs" style={{ color: '#AFC0D4' }}>
              แท่งละ 15 นาที · ตัวเลขคือจำนวนคัน
            </span>
          </div>
          <div className="rounded-xl p-3" style={{ background: '#121820' }}>
            <Density secs={openSecs} now={now} />
          </div>
        </div>
      )}

      {/* ───────── เพิ่มรถ ─────────
          ตีกรอบเหลืองไว้ชัด ๆ เพราะหน้านี้มีของเยอะขึ้นเรื่อย ๆ
          ทั้งการ์ดตัวเลข กราฟ ชิป ช่องค้น และรายการรถ
          คนที่เพิ่งเดินมาถึงต้องรู้ภายในวินาทีเดียวว่าต้องพิมพ์ตรงไหน
          ไม่ใช่กวาดตาหาช่องที่หน้าตาเหมือนช่องค้นอีกช่องหนึ่ง */}
      <div className="px-4 pt-4">
        <div
          className="rounded-2xl p-4"
          style={{
            background: '#151C26',
            border: '2px solid #FFC400',
            boxShadow: '0 0 0 4px rgba(255,196,0,.10)',
          }}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className="rounded-md px-2.5 py-1 text-sm font-extrabold"
              style={{ background: '#FFC400', color: '#0B0E11' }}
            >
              กรอกตรงนี้
            </span>
            <span className="text-base font-bold">รถเข้าคลัง</span>
            <span className="text-xs" style={{ color: '#AFC0D4' }}>
              พิมพ์สาขา เลือกชั่วโมง แล้วกดบันทึก
            </span>
          </div>

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
                    {b.code && (
                      <span className="mr-2 font-mono text-sm font-extrabold" style={{ color: '#FFC400' }}>
                        {b.code}
                      </span>
                    )}
                    <span className="text-sm">{b.name}</span>
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
              ถึงคลังเมื่อ
            </div>
            <TimeField
              value={atHM}
              touched={atTouched}
              onChange={(v) => {
                setAtHM(v)
                setAtTouched(true)
              }}
              onNow={() => {
                setAtHM(nowHM())
                setAtTouched(false)
              }}
            />
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

          <div>
            <div className="mb-1 text-xs" style={{ color: '#AFC0D4' }}>
              ประเภทรถ
            </div>
            <div className="flex gap-2">
              {(['main', 'extra'] as TruckKind[]).map((k) => {
                const on = kind === k
                const c = k === 'extra' ? '#7FD1FF' : '#FFC400'
                return (
                  <button
                    key={k}
                    type="button"
                    className="h-tap rounded-lg px-4 text-base font-bold"
                    style={
                      on
                        ? { background: c, color: '#0B0E11' }
                        : { background: '#141920', border: '1px solid #2A313B', color: c }
                    }
                    onClick={() => setKind(k)}
                  >
                    {on ? '✓ ' : ''}
                    {k === 'main' ? 'รถหลัก' : 'รถเสริม'}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            className="h-tap rounded-lg px-6 text-base font-extrabold"
            style={{ background: '#FFC400', color: '#0B0E11', opacity: busy ? 0.6 : 1 }}
            disabled={busy || !name.trim()}
            onClick={() => void save()}
          >
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>

          </div>

          {saved ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 text-sm"
              style={{ background: 'rgba(53,217,138,.14)', border: '1px solid #35D98A55', color: '#8FE8BC' }}
            >
              <span className="text-base font-extrabold" style={{ color: '#35D98A' }}>
                ✓ บันทึกแล้ว
              </span>
              {saved.code && (
                <span className="font-mono text-base font-extrabold" style={{ color: '#FFC400' }}>
                  {saved.code}
                </span>
              )}
              <span className="text-base font-bold" style={{ color: '#F0F4F9' }}>
                {saved.name}
              </span>
              <KindTag tag={saved.kind === 'extra' ? 'รถเสริม' : 'รถหลัก'} size={13} />
              <span style={{ color: '#AFC0D4' }}>
                ควรออก{' '}
                <b className="font-mono text-base" style={{ color: '#F0F4F9' }}>
                  {hm(new Date(saved.due))}
                </b>{' '}
                {dmy(new Date(saved.due))}
              </span>
              {saved.isNew && (
                <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ background: '#FFB03822', color: '#FFB038' }}>
                  สาขานี้ยังไม่เคยมีในระบบ · สร้างให้ใหม่แล้ว
                </span>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs" style={{ color: '#AFC0D4' }}>
              ช่องเวลาเป็นแบบ 24 ชั่วโมง · พิมพ์ตัวเลขได้เลย เช่น 0930 หรือกดรูปนาฬิกาเพื่อเลือก ·
              ตั้งต้นเป็นเวลาตอนนี้และเดินตามนาฬิกาเอง
              <br />
              กรอกเวลาที่มากกว่าตอนนี้ ระบบถือว่าเป็นเมื่อวาน เพราะงานรันยี่สิบสี่ชั่วโมง ·
              ระบบจำชั่วโมงที่เลือกล่าสุดไว้ให้
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <AlarmChip on={pref.on} onClick={() => void pref.turnOn()} />
          <a
            href="/trucks/stats"
            className="h-tap rounded-lg px-4 text-sm font-bold leading-[44px]"
            style={{ background: '#1B2430', color: '#AFC0D4' }}
          >
            สถิติ
          </a>
          <a
            href="/trucks/tv"
            className="h-tap rounded-lg px-4 text-sm font-bold leading-[44px]"
            style={{ background: '#1B2430', color: '#AFC0D4' }}
          >
            จอทีวี
          </a>
        </div>
      </div>

      {/* ───────── ชิปกรองและช่องค้น ───────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-5">
        <Chip on={!q2 && filter === 'all'} onClick={() => { setFilter('all'); setFind('') }} color="#AFC0D4">
          ทั้งหมด {live.length}
        </Chip>
        <Chip on={!q2 && filter === 'urgent'} onClick={() => { setFilter('urgent'); setFind('') }} color="#FF5C5C">
          ต้องรีบ {over + soon}
        </Chip>

        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[320px] sm:flex-none">
          <input
            className="h-tap w-full rounded-lg pl-3 pr-10 text-base outline-none"
            style={{ background: '#141920', border: '1px solid #2A313B', color: '#F0F4F9' }}
            type="search"
            value={find}
            placeholder="ค้นรถในคลัง · ชื่อ รหัส หรือโซน"
            onChange={(e) => setFind(e.target.value)}
          />
          {find && (
            <button
              type="button"
              aria-label="ล้างคำค้น"
              className="absolute right-1 top-1 h-tap w-tap rounded-lg text-lg"
              style={{ color: '#AFC0D4' }}
              onClick={() => setFind('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {q2 && (
        <p className="px-4 pt-2 text-xs" style={{ color: '#AFC0D4' }}>
          ค้นในรถทุกคันที่อยู่ในคลัง · เจอ {shown.length} คัน
        </p>
      )}

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
            {live.length === 0
              ? 'ยังไม่มีรถในคลัง'
              : q2
                ? `ไม่เจอสาขาที่ตรงกับ “${find.trim()}” ในคลังตอนนี้`
                : 'ไม่มีคันที่ต้องรีบตอนนี้'}
          </p>
        )}

        <div className="space-y-2">
          {shown.map(({ r, sec }) => (
            <Row key={r.id} row={r} sec={sec} tag={tags.get(r.id)} busy={busy} onRelease={() =>
              void run(async () => {
                await releaseTruck(r.id)
                setUndo({ id: r.id, name: r.branch_name })
                window.setTimeout(() => setUndo(null), 10_000)
              })
            } />
          ))}
        </div>
      </div>

      {/* ───────── ถามก่อนใส่ซ้ำ ───────── */}
      {dup && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center p-4 sm:items-center"
          style={{ background: 'rgba(0,0,0,.65)' }}
          onClick={() => setDup(null)}
        >
          <div
            className="w-full max-w-[460px] rounded-2xl p-5"
            style={{ background: '#141920', border: '1px solid #2A313B' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-bold" style={{ color: '#FFB038' }}>
              {dup.name} มีรถอยู่ในคลังแล้ว {dup.hits.length} คัน
            </p>
            <p className="mt-1 text-sm" style={{ color: '#AFC0D4' }}>
              กดยืนยันแล้วคันนี้จะขึ้นเป็น{' '}
              <b style={{ color: kind === 'extra' ? '#7FD1FF' : '#FFC400' }}>
                {kind === 'extra' ? 'รถเสริม' : 'รถหลัก'}
                {dup.hits.filter((h) => h.kind === kind).length > 0
                  ? ' ' + (dup.hits.filter((h) => h.kind === kind).length + 1)
                  : ''}
              </b>{' '}
              ของสาขานี้ ทั้งบนกระดานและบนจอทีวี
              <br />
              ถ้าเพิ่งกดบันทึกไปแล้วไม่แน่ใจว่าติดไหม ให้กดยกเลิก
            </p>
            <ul className="mt-3 space-y-1">
              {dup.hits.map((h) => (
                <li
                  key={h.id}
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ background: '#0B0E11', color: '#F0F4F9' }}
                >
                  <KindTag tag={tags.get(h.id)} size={12} /> ถึงคลัง{' '}
                  <b className="font-mono">{hm(new Date(h.arrived_at))}</b> {dmy(new Date(h.arrived_at))}{' '}
                  · ควรออก <b className="font-mono">{hm(new Date(h.due_at))}</b>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="h-tap flex-1 rounded-lg text-base font-bold"
                style={{ background: '#1B2430', color: '#F0F4F9' }}
                onClick={() => setDup(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="h-tap flex-1 rounded-lg text-base font-extrabold"
                style={{ background: '#FFC400', color: '#0B0E11' }}
                disabled={busy}
                onClick={() => void save(true)}
              >
                ยืนยัน เพิ่มอีกคัน
              </button>
            </div>
          </div>
        </div>
      )}
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
  tag,
  busy,
  onRelease,
}: {
  row: TruckBoardRow
  sec: number
  /** ป้ายประเภทรถของสาขานี้ เช่น รถหลัก · รถเสริม 2 */
  tag?: string
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
      {/* ตัวย่อตัวเท่าชื่อไทยและมาก่อน · หน้างานอ่านตัวย่อเป็นหลัก */}
      <div className="min-w-[150px] flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {row.zone && (
            <span
              className="rounded-md px-1.5 font-mono text-sm font-extrabold"
              style={{ background: '#1B2430', color: '#7FD1FF' }}
            >
              {row.zone}
            </span>
          )}
          {row.branch_code && (
            <span className="font-mono text-base font-extrabold" style={{ color: '#FFC400' }}>
              {row.branch_code}
            </span>
          )}
          <span className="text-base font-bold">{row.branch_name}</span>
          <KindTag tag={tag} size={13} />
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

      <Countdown sec={sec} size={46} showSec />

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

/**
 * ช่องเวลา · กดเลือกก็ได้ พิมพ์ก็ได้
 *
 * ไม่ใช้ช่องเวลาของเบราว์เซอร์ เพราะมันขึ้นรูปแบบตามภาษาของเครื่อง
 * เครื่องที่ตั้งเป็นอังกฤษจะได้ AM PM ซึ่งหน้างานต้องแปลในหัวทุกครั้ง
 *
 * คนรีบ ๆ พิมพ์สี่ตัวเลขเร็วกว่ากดเลือกสองที
 * คนที่ใส่ถุงมือหรือจำเวลาไม่แม่น กดเลือกง่ายกว่าพิมพ์
 * สองแบบนี้จึงต้องมีคู่กัน ไม่ใช่เลือกอย่างใดอย่างหนึ่งแทนคนอื่น
 *
 * นาทีให้เลือกทีละห้านาที เพราะหกสิบปุ่มคือตารางที่หาของไม่เจอ
 * ส่วนนาทีที่ไม่ลงตัวพิมพ์เอาได้อยู่แล้ว
 */
function TimeField({
  value,
  touched,
  onChange,
  onNow,
}: {
  value: string
  touched: boolean
  onChange: (v: string) => void
  onNow: () => void
}) {
  const [open, setOpen] = useState(false)
  const h = value.slice(0, 2)
  const m = value.slice(3, 5)
  const okH = /^([01]\d|2[0-3])$/.test(h)
  const okM = /^[0-5]\d$/.test(m)

  const pickH = (v: string) => onChange(`${v}:${okM ? m : '00'}`)
  const pickM = (v: string) => onChange(`${okH ? h : p2(new Date().getHours())}:${v}`)

  return (
    <div className="relative flex items-center gap-2">
      <div className="flex">
        <input
          type="text"
          inputMode="numeric"
          maxLength={5}
          aria-label="เวลาที่รถถึงคลัง"
          className="h-tap w-[96px] rounded-l-lg px-3 text-center font-mono text-xl font-bold outline-none"
          style={{
            background: '#141920',
            border: `1px solid ${touched ? (HM_OK.test(value) ? '#FFC400' : '#FF5C5C') : '#2A313B'}`,
            borderRight: 'none',
            color: '#F0F4F9',
          }}
          value={value}
          onChange={(e) => onChange(fmtHM(e.target.value))}
        />
        <button
          type="button"
          aria-label="เลือกเวลา"
          className="h-tap w-tap rounded-r-lg"
          style={{
            background: open ? '#FFC400' : '#1B2430',
            border: `1px solid ${touched ? '#FFC400' : '#2A313B'}`,
            color: open ? '#0B0E11' : '#AFC0D4',
          }}
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" className="mx-auto" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
      </div>

      {touched && (
        <button
          type="button"
          className="h-tap rounded-lg px-3 text-sm font-bold"
          style={{ background: '#1B2430', color: '#AFC0D4' }}
          onClick={() => {
            onNow()
            setOpen(false)
          }}
        >
          ตอนนี้
        </button>
      )}

      {open && (
        <>
          {/* กดที่อื่นแล้วปิด · จอทีวีกับมือถือไม่มีปุ่ม Esc ให้กด */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full z-40 mt-2 w-[300px] rounded-xl p-3"
            style={{ background: '#141920', border: '1px solid #2A313B', boxShadow: '0 10px 30px rgba(0,0,0,.6)' }}
          >
            <p className="mb-1 text-xs" style={{ color: '#AFC0D4' }}>
              ชั่วโมง
            </p>
            <div className="grid grid-cols-6 gap-1">
              {Array.from({ length: 24 }, (_, i) => p2(i)).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="rounded-md py-2 font-mono text-sm font-bold"
                  style={
                    v === h
                      ? { background: '#FFC400', color: '#0B0E11' }
                      : { background: '#1B2430', color: '#F0F4F9' }
                  }
                  onClick={() => pickH(v)}
                >
                  {v}
                </button>
              ))}
            </div>

            <p className="mb-1 mt-3 text-xs" style={{ color: '#AFC0D4' }}>
              นาที · ไม่ลงตัวให้พิมพ์เอาในช่อง
            </p>
            <div className="grid grid-cols-6 gap-1">
              {Array.from({ length: 12 }, (_, i) => p2(i * 5)).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="rounded-md py-2 font-mono text-sm font-bold"
                  style={
                    v === m
                      ? { background: '#FFC400', color: '#0B0E11' }
                      : { background: '#1B2430', color: '#F0F4F9' }
                  }
                  onClick={() => pickM(v)}
                >
                  {v}
                </button>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="h-tap flex-1 rounded-lg text-sm font-bold"
                style={{ background: '#1B2430', color: '#AFC0D4' }}
                onClick={() => {
                  onNow()
                  setOpen(false)
                }}
              >
                เวลาตอนนี้
              </button>
              <button
                type="button"
                className="h-tap flex-1 rounded-lg text-sm font-extrabold"
                style={{ background: '#FFC400', color: '#0B0E11' }}
                onClick={() => setOpen(false)}
              >
                เสร็จ
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** รอมานานเท่าไหร่แล้ว · ใช้กับคันที่ค้างนานที่สุด */
function fmtWait(sec: number): string {
  const a = Math.abs(sec)
  return `${p2(Math.floor(a / 3600))}:${p2(Math.floor(a / 60) % 60)}`
}
