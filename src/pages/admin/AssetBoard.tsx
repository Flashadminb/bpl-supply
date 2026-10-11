import { useEffect, useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { assetBoard } from '../../lib/api'
import { deptName } from '../../lib/deptNames'
import { EmptyState, ErrorBox, Loading, Spinner } from '../../components/ui'
import { AssetDeviceBox } from './AssetDeviceBox'
import type { TransferCandidate } from '../../components/AssetTransfer'
import { AssetStats } from './AssetStats'
import type { AssetBoardRow } from '../../lib/types'

/**
 * กระดานเครื่อง Asset · หน้าจอเดียวจบ
 *
 * ของเดิมต้องเปิดสองหน้าถึงจะตอบได้ว่า "เครื่องนี้อยู่กับใคร"
 * ทะเบียนเครื่องบอกว่ามีเครื่องอะไรบ้าง · Asset ที่ยังไม่คืนบอกว่าอะไรค้าง
 * แต่ไม่มีหน้าไหนบอกพร้อมกันว่าอะไรว่าง อะไรไม่ว่าง และไม่ว่างเพราะใคร
 *
 * อ่านจาก assets.held_item_id ซึ่งชี้ไปที่แถวตอนเบิกที่ยังไม่ถูกคืนอยู่แล้ว
 * จึงไม่ต้องไล่ประวัติ 3,957 แถวทุกครั้งที่โหลด · โครงเดียวกับกระดานปล่อยรถ
 *
 * ประวัติของแต่ละเครื่องโหลดตอนกดเปิดดูเท่านั้น ไม่ได้ติดมากับกระดาน
 * ถ้าติดมาด้วย การโหลดหนึ่งครั้งจะใหญ่ขึ้นหลายสิบเท่าเพื่อของที่แทบไม่มีใครเปิด
 */

const TONE: Record<string, { bg: string; txt: string; label: string }> = {
  free: { bg: '#25A35A', txt: '#fff', label: 'ว่าง' },
  held: { bg: '#E8B931', txt: '#1A1405', label: 'ถืออยู่' },
  late: { bg: '#E5484D', txt: '#fff', label: 'เลยกำหนด' },
  off: { bg: '#55616F', txt: '#fff', label: 'ปิดใช้งาน' },
  broken: { bg: '#7C2D12', txt: '#fff', label: 'แจ้งเสีย' },
  moving: { bg: '#6D28D9', txt: '#fff', label: 'รอรับโอน' },
}

/** เหลือเวลาอีกเท่าไหร่ถึงกำหนดคืน · ติดลบแปลว่าเลยมาแล้ว */
function leftTH(due: string | null, now: number): string {
  if (!due) return ''
  const ms = new Date(due).getTime() - now
  const t = Math.abs(ms)
  const h = Math.floor(t / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = h > 0 ? h + ' ชม. ' + m + ' นาที' : m + ' นาที'
  return ms < 0 ? 'เลยมา ' + s : 'อีก ' + s
}

export default function AssetBoard() {
  const rows = useAsync(assetBoard, [])
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'held' | 'free' | 'late' | 'broken' | 'moving'>('all')
  const [showOff, setShowOff] = useState(false)
  const [pick, setPick] = useState<AssetBoardRow | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [view, setView] = useState<'board' | 'stats'>('board')

  /**
   * ถามซ้ำทุก 60 วินาที · ไม่ได้ใช้ Realtime แบบต่อสายค้างไว้
   * เพราะเน็ตในฮับสะดุดบ่อย และสายที่หลุดเงียบ ๆ คือกระดานที่ค้างโดยไม่มีใครรู้
   * ถามซ้ำแล้วพลาดรอบหนึ่งก็แค่ช้าไปหนึ่งนาที ไม่ได้ค้างถาวร
   */
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 20_000)
    const poll = setInterval(() => rows.reload(), 60_000)
    return () => {
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [rows.reload])

  const all = rows.data ?? []
  const live = all.filter((r) => r.is_enabled)

  const tally = useMemo(
    () => ({
      held: live.filter((r) => r.state === 'held').length,
      late: live.filter((r) => r.state === 'late').length,
      free: live.filter((r) => r.state === 'free').length,
      off: all.length - live.length,
      broken: live.filter((r) => r.open_issues > 0).length,
      moving: live.filter((r) => r.pending_transfer_id).length,
    }),
    [all, live],
  )

  const shown = useMemo(() => {
    const base = showOff ? all : live
    const byState =
      only === 'all'
        ? base
        : only === 'held'
          ? base.filter((r) => r.state === 'held' || r.state === 'late')
          : only === 'late'
            ? base.filter((r) => r.state === 'late')
            : only === 'broken'
              ? base.filter((r) => r.open_issues > 0)
              : only === 'moving'
                ? base.filter((r) => r.pending_transfer_id)
                : base.filter((r) => r.state === 'free')
    const s = q.trim().toLowerCase()
    if (!s) return byState
    return byState.filter(
      (r) =>
        r.code.toLowerCase().includes(s) ||
        (r.holder_name ?? '').toLowerCase().includes(s) ||
        (r.holder_code ?? '').toLowerCase().includes(s) ||
        r.type_name.toLowerCase().includes(s) ||
        (r.issue_symptom ?? '').toLowerCase().includes(s) ||
        deptName(r.dept_code, '').toLowerCase().includes(s),
    )
  }, [all, live, only, q, showOff])

  /**
   * เครื่องที่โอนไปพร้อมกันได้ · เอาทั้งกระดาน ไม่ใช่แค่ที่กรองอยู่
   * ให้เหมือนหน้าทะเบียนเครื่อง จะได้โอนทีเดียวหลายคันโดยไม่ต้องเปิดทีละเครื่อง
   */
  const moveCandidates = useMemo<TransferCandidate[]>(
    () =>
      live.map((x) => ({
        code: x.code,
        type_name: x.type_name,
        dept: x.dept_code,
        holder: x.holder_name,
        holderId: x.holder_id,
      })),
    [live],
  )

  /** จัดกลุ่มตามประเภทเครื่อง · คนหาของมองหาประเภทก่อนเสมอ ไม่ได้มองหารหัส */
  const groups = useMemo(() => {
    const m = new Map<string, AssetBoardRow[]>()
    for (const r of shown) m.set(r.type_name, [...(m.get(r.type_name) ?? []), r])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th'))
  }, [shown])

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-xl">กระดานเครื่อง Asset</h1>
        <button
          type="button"
          className="ml-auto btn-soft text-sm"
          disabled={rows.loading}
          onClick={rows.reload}
        >
          {rows.loading ? <Spinner /> : null} โหลดใหม่
        </button>
      </div>
      <p className="mb-3 text-sm text-ink-400">
        อัปเดตเองทุกนาที · กดที่เครื่องเพื่อดูประวัติ โอน คืนแทน หรือยกเลิกการโอน
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ['board', 'กระดานตอนนี้'],
            ['stats', 'สถิติย้อนหลัง'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`h-tap rounded-btn px-3 text-sm ${view === k ? 'bg-ink text-white' : 'btn-soft'}`}
            onClick={() => setView(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'stats' && <AssetStats />}

      {view === 'board' && rows.loading && all.length === 0 && <Loading />}
      {view === 'board' && rows.error && <ErrorBox message={rows.error} onRetry={rows.reload} />}

      {view === 'board' && rows.data && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Tile n={tally.held} label="ถืออยู่" tone="held" />
            <Tile n={tally.late} label="เลยกำหนด" tone="late" />
            <Tile n={tally.free} label="ว่าง" tone="free" />
            <Tile n={tally.broken} label="แจ้งเสียค้าง" tone="broken" />
            <Tile n={tally.moving} label="รอรับโอน" tone="moving" />
            <Tile n={tally.off} label="ปิดใช้งาน" tone="off" />
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            {(
              [
                ['all', 'ทั้งหมด'],
                ['held', 'ถืออยู่'],
                ['late', 'เลยกำหนด'],
                ['free', 'ว่าง'],
                ['broken', 'แจ้งเสียค้าง'],
                ['moving', 'รอรับโอน'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`chip ${only === k ? 'chip-on' : ''}`}
                onClick={() => setOnly(k)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${showOff ? 'chip-on' : ''}`}
              onClick={() => setShowOff(!showOff)}
            >
              รวมเครื่องที่ปิดใช้งาน
            </button>
          </div>

          <input
            className="input mb-3"
            placeholder="พิมพ์รหัสเครื่อง ชื่อคนถือ ประเภท หรือแผนก"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {shown.length === 0 ? (
            <EmptyState title="ไม่พบเครื่องที่ค้นหา" />
          ) : (
            <div className="space-y-4">
              {groups.map(([type, list]) => (
                <section key={type}>
                  <p className="label mb-1">
                    {type}
                    <span className="ml-2 font-normal text-ink-400">{list.length} เครื่อง</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                    {list.map((r) => (
                      <Tiny key={r.code} r={r} now={now} onOpen={() => setPick(r)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {pick && (
        <AssetDeviceBox
          r={pick}
          candidates={moveCandidates}
          onClose={() => setPick(null)}
          onDone={rows.reload}
        />
      )}
    </div>
  )
}

function Tile({ n, label, tone }: { n: number; label: string; tone: string }) {
  const t = TONE[tone]
  return (
    <div className="rounded-card px-3 py-2" style={{ background: t.bg, color: t.txt }}>
      <p className="font-display text-2xl font-bold leading-none">{n}</p>
      <p className="mt-1 text-xs font-bold opacity-90">{label}</p>
    </div>
  )
}

/** ไทล์เครื่องหนึ่งเครื่อง · เล็กพอให้เห็น 143 เครื่องโดยไม่ต้องเลื่อนทั้งวัน */
function Tiny({ r, now, onOpen }: { r: AssetBoardRow; now: number; onOpen: () => void }) {
  const t = TONE[r.state] ?? TONE.free
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-card border border-line bg-surface p-2 text-left"
    >
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.bg }} />
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-bold">{r.code}</span>
        <span
          className="shrink-0 rounded-pill px-2 py-[2px] text-[10px] font-extrabold"
          style={{ background: t.bg, color: t.txt }}
        >
          {t.label}
        </span>
      </span>
      {r.holder_name ? (
        <>
          <span className="mt-1 block truncate text-xs">{r.holder_name}</span>
          <span className="block truncate text-[11px] text-ink-400">{leftTH(r.due_at, now)}</span>
        </>
      ) : (
        <span className="mt-1 block text-xs text-ink-400">
          {deptName(r.dept_code, 'ส่วนกลาง')}
          {r.sub_dept ? ' · ' + r.sub_dept : ''}
        </span>
      )}

      {/*
        ป้ายเสียกับป้ายโอน อยู่คนละแกนกับสถานะการถือ
        เครื่องเสียอาจว่างอยู่ก็ได้ · เครื่องที่รอปลายทางมารับก็ยังนับว่าว่าง
        ถ้ายุบรวมเป็นสถานะเดียว จะมีเรื่องหนึ่งหายไปจากจอเสมอ
      */}
      {(r.open_issues > 0 || r.pending_transfer_id) && (
        <span className="mt-1 flex flex-wrap gap-1">
          {r.open_issues > 0 && (
            <span
              className="rounded-pill px-2 py-[2px] text-[10px] font-extrabold"
              style={{ background: '#7C2D12', color: '#fff' }}
              title={r.issue_symptom ?? ''}
            >
              เสีย{r.open_issues > 1 ? ' ' + r.open_issues : ''}
            </span>
          )}
          {r.pending_transfer_id && (
            <span
              className="rounded-pill px-2 py-[2px] text-[10px] font-extrabold"
              style={{ background: '#6D28D9', color: '#fff' }}
            >
              รอรับโอน
            </span>
          )}
        </span>
      )}
    </button>
  )
}

