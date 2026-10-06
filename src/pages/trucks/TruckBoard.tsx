import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import {
  addTruck,
  listTruckBoard,
  listTruckBranches,
  releaseTruck,
  secondsLeft,
  seqByBranch,
  truckCounts,
  unreleaseTruck,
  type TruckBoardRow,
  type TruckBranch,
} from '../../lib/trucks'
import { Countdown, DAY_TH, Density, dmy, hm, p2, tone } from './parts'

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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ id: number; name: string } | null>(null)
  const [dup, setDup] = useState<{ name: string; hits: TruckBoardRow[] } | null>(null)

  const rows = board.data ?? []
  const live = useMemo(
    () => rows.map((r) => ({ r, sec: secondsLeft(r.due_at, now) })).sort((a, b) => a.sec - b.sec),
    [rows, now],
  )
  // คันที่เท่าไหร่ของสาขานั้น · คันแรกไม่ติดป้าย
  const seq = useMemo(() => seqByBranch(rows), [rows])
  const over = live.filter((x) => x.sec < 0).length
  const soon = live.filter((x) => x.sec >= 0 && x.sec <= 30 * 60).length
  /**
   * พิมพ์ค้นแล้วค้นทั้งคลังเสมอ ไม่สนใจชิปที่เลือกไว้
   *
   * คนพิมพ์ชื่อสาขาลงไปแปลว่ารู้อยู่แล้วว่าจะหาคันไหน
   * ถ้ายังติดกรองของชิปอยู่ เขาจะได้ผลลัพธ์ว่างทั้งที่รถคันนั้นอยู่ในคลังจริง ๆ
   */
  const q2 = find.trim().toLowerCase()
  const shown = useMemo(() => {
    const base = q2 || filter === 'all' ? live : live.filter((x) => x.sec <= 30 * 60)
    if (!q2) return base
    return base.filter((x) =>
      `${x.r.branch_name} ${x.r.branch_code ?? ''}`.toLowerCase().includes(q2),
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
    if (!force) {
      const hits = openDuplicates(q)
      if (hits.length > 0) {
        setDup({ name: q, hits })
        return
      }
    }
    localStorage.setItem('truck.min', String(minutes))
    setDup(null)
    await run(async () => {
      await addTruck({ name: q, minutes })
      setName('')
    })
  }

  const clock = new Date(now)
  const openSecs = live.map((x) => x.sec)

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

        <div className="mt-3 flex flex-wrap gap-2">
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
            placeholder="ค้นรถในคลัง · ชื่อหรือรหัสสาขา"
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
            <Row key={r.id} row={r} sec={sec} seq={seq.get(r.id)} busy={busy} onRelease={() =>
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
              <b style={{ color: '#FFC400' }}>คันที่ {dup.hits.length + 1}</b> ของสาขานี้
              ทั้งบนกระดานและบนจอทีวี
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
                  ถึงคลัง{' '}
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
  seq,
  busy,
  onRelease,
}: {
  row: TruckBoardRow
  sec: number
  /** คันที่เท่าไหร่ของสาขานี้ · ไม่ส่งมาหรือเป็น 1 แปลว่าไม่ต้องติดป้าย */
  seq?: number
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
          {row.branch_code && (
            <span className="font-mono text-base font-extrabold" style={{ color: '#FFC400' }}>
              {row.branch_code}
            </span>
          )}
          <span className="text-base font-bold">{row.branch_name}</span>
          {seq && seq > 1 && (
            <span
              className="rounded-md px-2 py-0.5 text-sm font-extrabold"
              style={{ background: '#FFC400', color: '#0B0E11' }}
            >
              คันที่ {seq}
            </span>
          )}
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

/** รอมานานเท่าไหร่แล้ว · ใช้กับคันที่ค้างนานที่สุด */
function fmtWait(sec: number): string {
  const a = Math.abs(sec)
  return `${p2(Math.floor(a / 3600))}:${p2(Math.floor(a / 60) % 60)}`
}
