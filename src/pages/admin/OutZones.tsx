import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { EmptyState, ErrorBox, Loading, Spinner } from '../../components/ui'
import { readableError } from '../../lib/supabase'
import { outZoneRows, seedOutZones, setOutZone, setOutZoneMany, type OutZoneRow } from '../../lib/hubOut'

/**
 * โซน D0x ของสาขาปลายทาง
 *
 * ตารางของตัวเอง ไม่ผูกกับรายชื่อสาขาของงานปล่อยรถตามที่เจ้าของระบบสั่ง
 * ดึงมาครั้งแรกได้ 80 จาก 104 สาขา เพราะสองระบบเรียกชื่อสาขาคนละแบบ
 * ที่เหลือตั้งเองที่หน้านี้ และหลังจากนั้นสองระบบไม่ยุ่งกันอีก
 *
 * หน้านี้อยู่หลังบ้าน ไม่ใช่บนจอของค้างส่งออก เพราะเป็นงานตั้งค่า
 * ที่ทำครั้งเดียวแล้วนาน ๆ แก้ที — ของแบบนั้นไม่ควรอยู่บนจอที่เปิดค้างทั้งกะ
 */
/**
 * สายหลักไม่ต้องมีโซน เพราะเป็นรถหลัก ไม่ได้ขึ้นสายพานคัดแยก
 * จึงไม่นับเป็นงานค้าง และไม่ขึ้นกรอบเตือนให้ไปตั้ง
 */
const needsZone = (r: OutZoneRow) => r.dir !== 'LH' && !r.zone?.trim()

export default function OutZones() {
  const feed = useAsync(() => outZoneRows(), [])
  const [q, setQ] = useState('')
  const [onlyBlank, setOnlyBlank] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [bulkZone, setBulkZone] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const all = feed.data ?? []

  /** โซนที่มีอยู่แล้ว · เอาไปทำตัวเลือกให้พิมพ์น้อยลง และกันพิมพ์ผิดเป็นโซนใหม่โดยไม่ตั้งใจ */
  const zones = useMemo(
    () => [...new Set(all.map((r) => r.zone).filter((z): z is string => Boolean(z && z.trim())))].sort(),
    [all],
  )

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of all) {
      const k = r.zone?.trim() || (r.dir === 'LH' ? 'LH · รถหลัก' : '(ยังไม่ตั้ง)')
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => (a[0] === '(ยังไม่ตั้ง)' ? 1 : b[0] === '(ยังไม่ตั้ง)' ? -1 : a[0].localeCompare(b[0])))
  }, [all])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter(
      (r) =>
        (!onlyBlank || needsZone(r)) &&
        (!s || r.station.toLowerCase().includes(s) || (r.zone ?? '').toLowerCase().includes(s)),
    )
  }, [all, q, onlyBlank])

  const blanks = all.filter(needsZone).length

  function run(job: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    void job()
      .then(() => {
        setMsg(ok)
        setPicked([])
        feed.reload()
      })
      .catch((e) => setErr(readableError(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-4">
        <h1 className="font-display text-xl">โซน D0x ของสาขาปลายทาง</h1>
        <p className="mt-1 text-sm text-ink-500">
          ใช้กับหน้า <b>ของค้างส่งออก</b> เพื่อแยกยอดตามสายพาน
          <br />
          ตารางนี้แยกจากรายชื่อสาขาของงานปล่อยรถ · ดึงมาครั้งแรกครั้งเดียว แล้วแก้ที่นี่ได้เลย
          แก้ฝั่งโน้นไม่กระทบฝั่งนี้ และกลับกันด้วย
          <br />
          สายหลัก LH ไม่ต้องตั้งโซน เพราะเป็นรถหลักที่ไม่ได้ขึ้นสายพาน · บนกระดานจะขึ้นว่า LH
        </p>
      </div>

      {feed.loading && <Loading />}
      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}
      {err && (
        <div className="mb-3">
          <ErrorBox message={err} />
        </div>
      )}
      {msg && <p className="mb-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">{msg}</p>}

      {feed.data && all.length === 0 && (
        <EmptyState
          title="ยังไม่มีรายชื่อสาขา"
          hint="ต้องอัปไฟล์ที่หน้าของค้างส่งออกก่อน แล้วรายชื่อสาขาของรอบล่าสุดจะขึ้นที่นี่"
        />
      )}

      {all.length > 0 && (
        <>
          {/* ---------------------------------------------------- สรุปโซน */}
          <section className="panel mb-3 p-3">
            <p className="label mb-2">ตอนนี้แบ่งได้แบบนี้</p>
            <div className="flex flex-wrap gap-2">
              {counts.map(([z, n]) => (
                <button
                  key={z}
                  type="button"
                  className={`chip ${q === z ? 'chip-on' : ''}`}
                  onClick={() => {
                    setOnlyBlank(z === '(ยังไม่ตั้ง)')
                    setQ(z === '(ยังไม่ตั้ง)' || z === 'LH · รถหลัก' ? '' : z)
                  }}
                >
                  {z} · {n}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-soft h-tap px-4 text-sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await seedOutZones()
                    setMsg(`ดึงจากงานปล่อยรถแล้ว · เติมใหม่ ${r.added} สาขา · ยังว่างอีก ${r.left}`)
                  }, 'ดึงจากงานปล่อยรถแล้ว')
                }
              >
                {busy ? <Spinner /> : null} ดึงจากงานปล่อยรถอีกครั้ง
              </button>
              <span className="text-xs text-ink-500">
                เติมเฉพาะช่องที่ยังว่าง ไม่ทับของที่ตั้งเองไว้แล้ว · กดซ้ำได้ไม่เสียหาย
              </span>
            </div>
          </section>

          {/* ---------------------------------------------------- ตัวกรอง */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="input h-tap max-w-[280px]"
              type="search"
              placeholder="ค้นหาชื่อสาขา หรือโซน"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="flex min-h-tap items-center gap-2 text-sm text-ink-500">
              <input
                type="checkbox"
                className="h-[18px] w-[18px]"
                checked={onlyBlank}
                onChange={(e) => setOnlyBlank(e.target.checked)}
              />
              เฉพาะที่ยังไม่ตั้ง ({blanks})
            </label>
            <span className="text-sm text-ink-500">แสดง {rows.length} จาก {all.length} สาขา</span>
          </div>

          {/* ------------------------------------------- ตั้งทีละหลายสาขา */}
          {picked.length > 0 && (
            <div className="panel sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 border-2 border-ink p-3">
              <span className="text-sm font-semibold">เลือกไว้ {picked.length} สาขา</span>
              <input
                className="input h-tap max-w-[140px]"
                list="zone-list"
                placeholder="โซน เช่น D05"
                value={bulkZone}
                onChange={(e) => setBulkZone(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary h-tap px-4"
                disabled={busy || bulkZone.trim() === ''}
                onClick={() =>
                  run(() => setOutZoneMany(picked, bulkZone), `ตั้งโซน ${bulkZone.toUpperCase()} ให้ ${picked.length} สาขาแล้ว`)
                }
              >
                ตั้งให้ทั้งหมด
              </button>
              <button type="button" className="btn-ghost h-tap px-3 text-sm" onClick={() => setPicked([])}>
                ล้างที่เลือก
              </button>
            </div>
          )}

          <datalist id="zone-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>

          {/* ---------------------------------------------------- ตาราง */}
          <section className="panel overflow-x-auto p-2">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="w-[44px] px-3 py-2" />
                  <th className="px-3 py-2 font-medium">สาขาปลายทาง</th>
                  <th className="w-[70px] px-3 py-2 font-medium">สาย</th>
                  <th className="w-[130px] px-3 py-2 text-right font-medium">ค้างรวม</th>
                  <th className="w-[160px] px-3 py-2 font-medium">โซน</th>
                  <th className="px-3 py-2 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ZoneRow
                    key={r.station}
                    r={r}
                    busy={busy}
                    picked={picked.includes(r.station)}
                    onPick={() =>
                      setPicked((p) => (p.includes(r.station) ? p.filter((x) => x !== r.station) : [...p, r.station]))
                    }
                    onSave={(zone, note) => run(() => setOutZone(r.station, zone, note), `ตั้ง ${r.station} แล้ว`)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-ink-400">
                      ไม่พบสาขาตามเงื่อนไข
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}

function ZoneRow({
  r,
  busy,
  picked,
  onPick,
  onSave,
}: {
  r: OutZoneRow
  busy: boolean
  picked: boolean
  onPick: () => void
  onSave: (zone: string, note: string) => void
}) {
  const [zone, setZone] = useState(r.zone ?? '')
  const [note, setNote] = useState(r.note ?? '')
  const dirty = zone !== (r.zone ?? '') || note !== (r.note ?? '')

  return (
    <tr className={`border-b border-line-2 last:border-0 ${picked ? 'bg-surface-2' : ''}`}>
      <td className="px-3 py-2">
        <input type="checkbox" className="h-[18px] w-[18px]" checked={picked} onChange={onPick} aria-label={`เลือก ${r.station}`} />
      </td>
      <td className="px-3 py-2">
        <span className="block">{r.station}</span>
        {r.dir === 'LH' && <span className="block text-xs text-ink-400">รถหลัก ไม่ต้องมีโซน · บนกระดานขึ้นว่า LH</span>}
        {r.from_seed && <span className="block text-xs text-ink-400">ดึงมาจากงานปล่อยรถ ยังไม่เคยแก้เอง</span>}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-ink-500">{r.dir}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {(r.in_wh + r.on_truck).toLocaleString('th-TH')}
      </td>
      <td className="px-3 py-2">
        <input
          className={`input h-tap w-[120px] ${needsZone(r) ? 'border-warn' : ''}`}
          list="zone-list"
          placeholder="เช่น D05"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) onSave(zone, note)
          }}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input h-tap min-w-0 flex-1"
            placeholder="ไม่บังคับ"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty) onSave(zone, note)
            }}
          />
          {dirty && (
            <button type="button" className="btn-primary h-tap shrink-0 px-3 text-sm" disabled={busy} onClick={() => onSave(zone, note)}>
              บันทึก
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
