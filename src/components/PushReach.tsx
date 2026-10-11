import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { listPushCoverage } from '../lib/api'
import { deptName } from '../lib/deptNames'
import { roleLabel } from '../lib/roles'
import { fmtDateTime } from '../lib/format'
import { EmptyState, ErrorBox, Loading, Spinner } from './ui'

/**
 * ใครรับแจ้งเตือนได้บ้าง
 *
 * ประกาศแล้วคนไม่รู้เรื่อง มักไม่ใช่เพราะระบบไม่ส่ง
 * แต่เพราะเครื่องของเขาไม่เคยเปิดรับ ซึ่งเป็นเรื่องที่มองไม่เห็นจากหน้าไหนเลย
 * คนประกาศเห็นแค่ว่า "ประกาศแล้ว" ซึ่งจริง แต่ไม่ได้แปลว่าถึงมือใคร
 *
 * หน้านี้ไม่ได้บอกว่าเขาเห็นแจ้งเตือนหรือยัง เพราะระบบไม่มีทางรู้
 * พอส่งออกจากเซิร์ฟเวอร์ไปถึง Google หรือ Apple แล้วก็จบหน้าที่เรา
 * บอกได้แค่ด่านแรกคือเครื่องของเขาพร้อมรับหรือยัง ซึ่งเป็นด่านที่คนตกเยอะที่สุด
 *
 * เรียงคนที่ยังไม่เปิดไว้บนสุดเสมอ เพราะนั่นคือรายการงานที่ต้องไปทำ
 * ส่วนคนที่เปิดแล้วมีไว้ให้เทียบว่าตามครบหรือยังเท่านั้น
 */
export function PushReach() {
  const rows = useAsync(listPushCoverage, [])
  const [only, setOnly] = useState<'off' | 'on' | 'all'>('off')
  const [q, setQ] = useState('')

  const all = rows.data ?? []
  const off = all.filter((r) => r.devices === 0)

  const shown = useMemo(() => {
    const base = only === 'off' ? off : only === 'on' ? all.filter((r) => r.devices > 0) : all
    const s = q.trim().toLowerCase()
    if (!s) return base
    return base.filter(
      (r) =>
        r.full_name.toLowerCase().includes(s) ||
        r.employee_code.toLowerCase().includes(s) ||
        deptName(r.dept_code, '').toLowerCase().includes(s),
    )
  }, [all, off, only, q])

  /** จัดกลุ่มตามแผนก · เดินตามคนทีละแผนกง่ายกว่าไล่ตามรายชื่อยาวพรืด */
  const byDept = useMemo(() => {
    const m = new Map<string, typeof shown>()
    for (const r of shown) {
      const k = deptName(r.dept_code, 'ไม่สังกัดแผนก')
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [shown])

  const pct = all.length ? Math.round(((all.length - off.length) / all.length) * 100) : 0

  return (
    <section className="panel p-4">
      {/*
        ปุ่มโหลดใหม่ · สถานะเปลี่ยนทันทีที่เจ้าตัวกดเปิด แต่หน้านี้อ่านครั้งเดียวตอนเปิดแท็บ
        เวลาไปยืนให้เขากดเปิดต่อหน้า แล้วอยากเห็นว่าขึ้นจริงไหม ต้องมีปุ่มให้กดตรงนี้
      */}
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-display text-md">ใครรับแจ้งเตือนได้</h2>
        <button
          type="button"
          className="ml-auto btn-soft h-tap px-3 text-sm"
          disabled={rows.loading}
          onClick={rows.reload}
        >
          {rows.loading ? <Spinner /> : null} โหลดใหม่
        </button>
      </div>
      <p className="mb-3 text-sm text-ink-500">
        คนที่ยังไม่เปิด จะไม่ได้รับทั้งนัดประชุมและป้ายประกาศ ไม่ว่าจะประกาศกี่รอบ
        <br />
        หน้านี้บอกว่าเครื่องพร้อมรับหรือยัง ไม่ได้บอกว่าเขาเห็นแล้วหรือยัง
      </p>

      {rows.loading && <Loading />}
      {rows.error && <ErrorBox message={rows.error} onRetry={rows.reload} />}

      {rows.data && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Tile n={off.length} label="ยังไม่เปิด" tone="bad" />
            <Tile n={all.length - off.length} label="เปิดแล้ว" tone="ok" />
            <Tile n={`${pct}%`} label="ครอบคลุม" tone="plain" />
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            {(
              [
                ['off', `ยังไม่เปิด ${off.length}`],
                ['on', `เปิดแล้ว ${all.length - off.length}`],
                ['all', `ทั้งหมด ${all.length}`],
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
          </div>

          <input
            className="input mb-3"
            placeholder="พิมพ์ชื่อ รหัสพนักงาน หรือแผนก เพื่อค้นหา"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {shown.length === 0 ? (
            <EmptyState
              title={only === 'off' ? 'เปิดครบทุกคนแล้ว' : 'ไม่พบคนที่ค้นหา'}
              hint={only === 'off' ? 'ทุกคนที่ยังใช้งานอยู่มีเครื่องรับแจ้งเตือนแล้ว' : undefined}
            />
          ) : (
            <div className="space-y-3">
              {byDept.map(([dept, list]) => (
                <div key={dept}>
                  <p className="label mb-1">
                    {dept}
                    <span className="ml-2 font-normal text-ink-400">{list.length} คน</span>
                  </p>
                  <ul className="rounded-card border border-line">
                    {list.map((r) => (
                      <li
                        key={r.user_id}
                        className="flex items-center gap-3 border-b border-line-2 px-3 py-2 last:border-0"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">{r.full_name}</span>
                          <span className="block font-mono text-xs text-ink-400">
                            {r.employee_code} · {roleLabel(r)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {r.devices === 0 ? (
                            <span className="badge bg-danger-bg text-danger-txt">ยังไม่เปิด</span>
                          ) : (
                            <>
                              <span className="badge bg-success-bg text-success-txt">
                                {r.devices} เครื่อง
                              </span>
                              {r.last_push_at && (
                                <span className="mt-[2px] block text-[11px] text-ink-400">
                                  ส่งล่าสุด {fmtDateTime(r.last_push_at)}
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <p className="mt-3 text-xs text-ink-400">
            วิธีเปิด: ให้เจ้าตัวเข้า <b>บัญชีของฉัน</b> แล้วกดปุ่มเปิดแจ้งเตือนบนเครื่องที่จะใช้รับ
            <br />
            บนมือถือต้องติดตั้งแอพลงเครื่องก่อน ไม่งั้นปุ่มจะไม่มีให้กด · หนึ่งคนเปิดได้หลายเครื่อง
            <br />
            “ส่งล่าสุด” นับจากใบเสร็จที่ระบบเก็บไว้ 90 วัน เก่ากว่านั้นจะไม่ขึ้น
          </p>
        </>
      )}
    </section>
  )
}

function Tile({ n, label, tone }: { n: number | string; label: string; tone: 'ok' | 'bad' | 'plain' }) {
  const cls =
    tone === 'bad'
      ? 'bg-danger-bg text-danger-txt'
      : tone === 'ok'
        ? 'bg-success-bg text-success-txt'
        : 'bg-surface-2 text-ink-700'
  return (
    <div className={`rounded-card px-3 py-2 ${cls}`}>
      <p className="font-display text-xl font-bold leading-none">{n}</p>
      <p className="mt-1 text-xs font-bold opacity-80">{label}</p>
    </div>
  )
}
