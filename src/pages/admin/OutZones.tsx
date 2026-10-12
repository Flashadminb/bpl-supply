import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { EmptyState, ErrorBox, Loading, Spinner } from '../../components/ui'
import { readableError } from '../../lib/supabase'
import {
  deleteOutZone,
  hideOutZoneMany,
  outZoneRows,
  seedOutZones,
  setOutZone,
  setOutZoneMany,
  type OutZoneRow,
} from '../../lib/hubOut'

/**
 * สาขาปลายทางและโซน D0x
 *
 * ตารางของตัวเอง ไม่ผูกกับรายชื่อสาขาของงานปล่อยรถตามที่เจ้าของระบบสั่ง
 * ดึงมาครั้งแรกได้ 80 จาก 104 สาขา เพราะสองระบบเรียกชื่อสาขาคนละแบบ
 * ที่เหลือตั้งเองที่หน้านี้ และหลังจากนั้นสองระบบไม่ยุ่งกันอีก
 *
 * ตั้งที่เดียวใช้สองจอ ทั้งของค้างส่งออกและพัสดุค้างเกิน 24 ชม
 *
 * หน้านี้อยู่หลังบ้าน ไม่ใช่บนจอ เพราะเป็นงานตั้งค่าที่ทำครั้งเดียวแล้วนาน ๆ แก้ที
 * ของแบบนั้นไม่ควรอยู่บนจอที่เปิดค้างทั้งกะ
 */

const SRC_TH: Record<OutZoneRow['src'], string> = {
  out: 'ของค้างส่งออก',
  p24: 'พัสดุ 24 ชม',
  both: 'ทั้งสองไฟล์',
  manual: 'เพิ่มเอง',
}

/** สายหลักไม่ต้องมีโซน เพราะเป็นรถหลัก ไม่ได้ขึ้นสายพานคัดแยก จึงไม่นับเป็นงานค้าง */
const needsZone = (r: OutZoneRow) => r.dir !== 'LH' && !r.hidden && !r.zone?.trim()

export default function OutZones() {
  const feed = useAsync(() => outZoneRows(), [])
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'' | 'blank' | 'hidden'>('')
  const [picked, setPicked] = useState<string[]>([])
  const [bulkZone, setBulkZone] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newZone, setNewZone] = useState('')
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
      const k = r.hidden ? '(ปิดโชว์)' : r.zone?.trim() || (r.dir === 'LH' ? 'LH · รถหลัก' : '(ยังไม่ตั้ง)')
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    const rank = (k: string) => (k === '(ปิดโชว์)' ? 2 : k === '(ยังไม่ตั้ง)' ? 1 : 0)
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  }, [all])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter(
      (r) =>
        (only === '' || (only === 'blank' ? needsZone(r) : r.hidden)) &&
        (!s || r.station.toLowerCase().includes(s) || (r.zone ?? '').toLowerCase().includes(s)),
    )
  }, [all, q, only])

  const blanks = all.filter(needsZone).length
  const hiddens = all.filter((r) => r.hidden).length

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
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-4">
        <h1 className="font-display text-xl">สาขาปลายทางและโซน D0x</h1>
        <p className="mt-1 text-sm text-ink-500">
          ตั้งที่นี่ที่เดียว ใช้ทั้งหน้า <b>ของค้างส่งออก</b> และ <b>พัสดุค้างเกิน 24 ชม</b>
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
          hint="ต้องอัปไฟล์ที่หน้าของค้างส่งออกหรือพัสดุ 24 ชมก่อน แล้วรายชื่อสาขาจะขึ้นที่นี่ · หรือกดเพิ่มสาขาเองก็ได้"
        />
      )}

      {/* ---------------------------------------------------- สรุปและเครื่องมือ */}
      <section className="panel mb-3 p-3">
        <p className="label mb-2">ตอนนี้แบ่งได้แบบนี้</p>
        <div className="flex flex-wrap gap-2">
          {counts.map(([z, n]) => (
            <button
              key={z}
              type="button"
              className={`chip ${q === z ? 'chip-on' : ''}`}
              onClick={() => {
                setOnly(z === '(ยังไม่ตั้ง)' ? 'blank' : z === '(ปิดโชว์)' ? 'hidden' : '')
                setQ(z.startsWith('(') || z.startsWith('LH') ? '' : z)
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
          <button type="button" className="btn-soft h-tap px-4 text-sm" onClick={() => setAdding((v) => !v)}>
            {adding ? 'ปิดช่องเพิ่มสาขา' : 'เพิ่มสาขาเอง'}
          </button>
          <span className="text-xs text-ink-500">
            ตัวดึงเติมเฉพาะช่องที่ยังว่าง ไม่ทับของที่ตั้งเองไว้แล้ว · กดซ้ำได้ไม่เสียหาย
          </span>
        </div>

        {adding && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-card border border-line-2 p-3">
            <label className="block">
              <span className="label">ชื่อสาขา · ต้องตรงกับที่เขียนในไฟล์เป๊ะ ๆ</span>
              <input
                className="input h-tap w-[320px]"
                placeholder="เช่น 2BLT_BDC-บางพลีตำหรุ"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">โซน</span>
              <input
                className="input h-tap w-[120px]"
                list="zone-list"
                placeholder="เช่น D05"
                value={newZone}
                onChange={(e) => setNewZone(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-primary h-tap px-4"
              disabled={busy || newName.trim() === ''}
              onClick={() =>
                run(async () => {
                  await setOutZone(newName.trim(), newZone)
                  setNewName('')
                  setNewZone('')
                }, `เพิ่ม ${newName.trim()} แล้ว`)
              }
            >
              เพิ่ม
            </button>
            <p className="w-full text-xs text-ink-500">
              ชื่อที่พิมพ์ต้องตรงกับในไฟล์ทุกตัวอักษร ไม่งั้นจะกลายเป็นอีกสาขาที่ไม่มีวันจับคู่กับของจริง
              · เพิ่มไว้ล่วงหน้าได้ แม้รอบนี้สาขานั้นยังไม่มีของ
            </p>
          </div>
        )}
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
            checked={only === 'blank'}
            onChange={(e) => setOnly(e.target.checked ? 'blank' : '')}
          />
          เฉพาะที่ยังไม่ตั้ง ({blanks})
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm text-ink-500">
          <input
            type="checkbox"
            className="h-[18px] w-[18px]"
            checked={only === 'hidden'}
            onChange={(e) => setOnly(e.target.checked ? 'hidden' : '')}
          />
          เฉพาะที่ปิดโชว์ ({hiddens})
        </label>
        <span className="text-sm text-ink-500">
          แสดง {rows.length} จาก {all.length} สาขา
        </span>
      </div>

      {/* ------------------------------------------- ทำทีละหลายสาขา */}
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
          <span className="w-px self-stretch bg-line" />
          <button
            type="button"
            className="btn-soft h-tap px-4 text-sm"
            disabled={busy}
            onClick={() => run(() => hideOutZoneMany(picked, true), `ปิดโชว์ ${picked.length} สาขาแล้ว`)}
          >
            ปิดโชว์
          </button>
          <button
            type="button"
            className="btn-soft h-tap px-4 text-sm"
            disabled={busy}
            onClick={() => run(() => hideOutZoneMany(picked, false), `เปิดโชว์ ${picked.length} สาขาแล้ว`)}
          >
            เปิดโชว์
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
      {all.length > 0 && (
        <section className="panel overflow-x-auto p-2">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="w-[44px] px-3 py-2" />
                <th className="px-3 py-2 font-medium">สาขาปลายทาง</th>
                <th className="w-[66px] px-3 py-2 font-medium">สาย</th>
                <th className="w-[96px] px-3 py-2 text-right font-medium">ค้างส่งออก</th>
                <th className="w-[96px] px-3 py-2 text-right font-medium">พัสดุ 24 ชม</th>
                <th className="w-[150px] px-3 py-2 font-medium">โซน</th>
                <th className="w-[86px] px-3 py-2 text-center font-medium">ปิดโชว์</th>
                <th className="px-3 py-2 font-medium">หมายเหตุ</th>
                <th className="w-[72px] px-3 py-2" />
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
                  onSave={(zone, note, hidden) =>
                    run(() => setOutZone(r.station, zone, note, hidden), `บันทึก ${r.station} แล้ว`)
                  }
                  onDelete={() => run(() => deleteOutZone(r.station), `ลบ ${r.station} แล้ว`)}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-ink-400">
                    ไม่พบสาขาตามเงื่อนไข
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {hiddens > 0 && (
        <p className="mt-3 text-xs text-ink-500">
          ตอนนี้ปิดโชว์ไว้ {hiddens} สาขา · ของสาขาเหล่านี้จะไม่ขึ้นบนจอ
          <b> และไม่ถูกนับในยอดรวมด้วย</b> ทั้งสองจอมีตัวเลขบอกว่าซ่อนอยู่กี่สาขา
          จะได้ไม่มีใครงงว่าทำไมยอดไม่ตรงกับไฟล์
        </p>
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
  onDelete,
}: {
  r: OutZoneRow
  busy: boolean
  picked: boolean
  onPick: () => void
  onSave: (zone: string, note: string, hidden: boolean) => void
  onDelete: () => void
}) {
  const [zone, setZone] = useState(r.zone ?? '')
  const [note, setNote] = useState(r.note ?? '')
  const [sure, setSure] = useState(false)
  const dirty = zone !== (r.zone ?? '') || note !== (r.note ?? '')

  return (
    <tr className={`border-b border-line-2 last:border-0 ${picked ? 'bg-surface-2' : ''} ${r.hidden ? 'opacity-55' : ''}`}>
      <td className="px-3 py-2">
        <input type="checkbox" className="h-[18px] w-[18px]" checked={picked} onChange={onPick} aria-label={`เลือก ${r.station}`} />
      </td>
      <td className="px-3 py-2">
        <span className="block">{r.station}</span>
        <span className="block text-xs text-ink-400">
          {SRC_TH[r.src]}
          {r.dir === 'LH' && ' · รถหลัก ไม่ต้องมีโซน'}
          {r.from_seed && ' · ดึงมาจากงานปล่อยรถ ยังไม่เคยแก้เอง'}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-ink-500">{r.dir || '—'}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">{(r.in_wh + r.on_truck).toLocaleString('th-TH')}</td>
      <td className="px-3 py-2 text-right font-mono text-xs">{r.p24.toLocaleString('th-TH')}</td>
      <td className="px-3 py-2">
        <input
          className={`input h-tap w-[120px] ${!r.hidden && r.dir !== 'LH' && !r.zone ? 'border-warn' : ''}`}
          list="zone-list"
          placeholder="เช่น D05"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) onSave(zone, note, r.hidden)
          }}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          className="h-[18px] w-[18px]"
          checked={r.hidden}
          disabled={busy}
          aria-label={`ปิดโชว์ ${r.station}`}
          onChange={(e) => onSave(zone, note, e.target.checked)}
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
              if (e.key === 'Enter' && dirty) onSave(zone, note, r.hidden)
            }}
          />
          {dirty && (
            <button
              type="button"
              className="btn-primary h-tap shrink-0 px-3 text-sm"
              disabled={busy}
              onClick={() => onSave(zone, note, r.hidden)}
            >
              บันทึก
            </button>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        {sure ? (
          <span className="flex items-center gap-1">
            <button type="button" className="btn-danger h-tap px-2 text-xs" disabled={busy} onClick={onDelete}>
              ลบจริง
            </button>
            <button type="button" className="btn-ghost h-tap px-2 text-xs" onClick={() => setSure(false)}>
              ยกเลิก
            </button>
          </span>
        ) : (
          <button type="button" className="btn-ghost h-tap px-2 text-xs text-danger-txt" onClick={() => setSure(true)}>
            ลบ
          </button>
        )}
      </td>
    </tr>
  )
}
