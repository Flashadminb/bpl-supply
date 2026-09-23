import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { listAssetHoldings, listAssetTypes } from '../../lib/api'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { AssetHolding } from '../../lib/types'

/**
 * เครื่องที่ยังไม่ได้คืน
 *
 * ต่างจากหน้าของค้างคืนของวัสดุตรงที่วัดด้วย "กะ" ไม่ใช่จำนวนชั่วโมงตายตัว
 * เพราะแต่ละคนเลิกกะไม่พร้อมกัน เลยเวลาเลิกกะของตัวเองเมื่อไหร่ถือว่าเกิน
 */

type SortKey = 'late' | 'oldest' | 'person' | 'asset'

const hoursLate = (h: AssetHolding) =>
  h.due_at ? (Date.now() - Date.parse(h.due_at)) / 3_600_000 : -Infinity

const shift = (h: AssetHolding) =>
  h.shift_start && h.shift_end
    ? `${h.shift_start.slice(0, 5)}–${h.shift_end.slice(0, 5)}`
    : '—'

export default function AssetOutstanding() {
  const feed = useAsync(() => listAssetHoldings(false), [])
  const types = useAsync(() => listAssetTypes(), [])

  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [sort, setSort] = useState<SortKey>('late')
  const [lateOnly, setLateOnly] = useState(false)

  const all = feed.data ?? []
  const late = all.filter((h) => hoursLate(h) > 0)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    const out = all.filter((h) => {
      if (type && h.type_code !== type) return false
      if (lateOnly && hoursLate(h) <= 0) return false
      if (!s) return true
      return `${h.asset_code} ${h.holder_name} ${h.holder_code} ${h.holder_dept ?? ''} ${h.ref_no}`
        .toLowerCase()
        .includes(s)
    })
    const by: Record<SortKey, (a: AssetHolding, b: AssetHolding) => number> = {
      late: (a, b) => hoursLate(b) - hoursLate(a),
      oldest: (a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at),
      person: (a, b) => a.holder_name.localeCompare(b.holder_name, 'th'),
      asset: (a, b) => a.asset_code.localeCompare(b.asset_code, 'th'),
    }
    return [...out].sort(by[sort])
  }, [all, search, type, sort, lateOnly])

  /** จับกลุ่มว่าใครถือกี่เครื่อง ไว้ตามคนเดียวจบทีเดียว */
  const worst = useMemo(() => {
    const map = new Map<string, { name: string; code: string; n: number }>()
    for (const h of late) {
      const k = h.holder_code
      const cur = map.get(k) ?? { name: h.holder_name, code: k, n: 0 }
      cur.n++
      map.set(k, cur)
    }
    return [...map.values()].sort((a, b) => b.n - a.n).slice(0, 4)
  }, [late])

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">Asset ที่ยังไม่คืน</h1>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={feed.reload}>
          รีเฟรช
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">ถูกยืมอยู่</p>
          <p className="mt-1 font-display text-xl leading-none">{all.length}</p>
          <p className="mt-1 text-xs text-ink-400">เครื่อง</p>
        </div>
        <div
          className={`rounded-card border p-4 ${
            late.length > 0 ? 'border-danger/25 bg-danger-bg' : 'border-line bg-surface'
          }`}
        >
          <p className="text-sm text-ink-500">เลยเวลาเลิกกะ</p>
          <p className="mt-1 font-display text-xl leading-none">{late.length}</p>
          <p className="mt-1 text-xs text-ink-400">ควรตามถามเจ้าตัว</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 sm:col-span-2">
          <p className="text-sm text-ink-500">คนที่ค้างมากที่สุด</p>
          {worst.length === 0 ? (
            <p className="mt-1 text-sm text-success-txt">ไม่มีใครค้างเกินกะ</p>
          ) : (
            <ul className="mt-1 space-y-[2px] text-sm">
              {worst.map((w) => (
                <li key={w.code}>
                  {w.name} <span className="font-mono text-xs text-ink-400">{w.code}</span> ·{' '}
                  <b className="text-danger-txt">{w.n} เครื่อง</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[260px]"
          type="search"
          placeholder="ค้นหารหัสเครื่อง ชื่อคน หรือรหัสพนักงาน"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input h-tap max-w-[170px]"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="ประเภท"
        >
          <option value="">ทุกประเภท</option>
          {(types.data ?? []).map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className="input h-tap max-w-[180px]"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="เรียงลำดับ"
        >
          <option value="late">เกินกะนานสุดก่อน</option>
          <option value="oldest">เบิกนานสุดก่อน</option>
          <option value="person">เรียงตามคน</option>
          <option value="asset">เรียงตามรหัสเครื่อง</option>
        </select>
        <button
          type="button"
          className={`chip ${lateOnly ? 'chip-on' : ''}`}
          onClick={() => setLateOnly((v) => !v)}
        >
          เฉพาะที่เลยเวลาเลิกกะ
        </button>
      </div>

      {feed.loading && <Loading />}
      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

      {!feed.loading && rows.length === 0 && (
        <EmptyState
          title={all.length === 0 ? 'ไม่มีเครื่องค้างคืน' : 'ไม่พบตามเงื่อนไข'}
          hint={all.length === 0 ? 'เครื่องที่ถูกเบิกออกไปจะขึ้นที่นี่' : 'ลองล้างคำค้นหรือตัวกรอง'}
        />
      )}

      {rows.length > 0 && (
        <>
          <section className="panel overflow-x-auto p-2">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="p-2 font-medium">เครื่อง</th>
                  <th className="p-2 font-medium">ผู้ถือ</th>
                  <th className="p-2 font-medium">กะ</th>
                  <th className="p-2 font-medium">เบิกเมื่อ</th>
                  <th className="p-2 font-medium">ถือมาแล้ว</th>
                  <th className="p-2 font-medium">กำหนดคืน</th>
                  <th className="p-2 font-medium">เลขที่</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const over = hoursLate(h)
                  const isLate = over > 0
                  return (
                    <tr
                      key={h.out_item_id}
                      className={`border-b border-line last:border-0 ${isLate ? 'bg-danger-bg/40' : ''}`}
                    >
                      <td className="p-2">
                        <p className="font-display">{h.asset_code}</p>
                        <p className="text-xs text-ink-400">{h.type_name}</p>
                      </td>
                      <td className="p-2">
                        {h.holder_name}
                        <span className="ml-1 font-mono text-xs text-ink-400">{h.holder_code}</span>
                        <p className="text-xs text-ink-400">
                          {h.holder_dept}
                          {h.holder_sub_dept ? ` · ${h.holder_sub_dept}` : ''}
                        </p>
                      </td>
                      <td className="p-2 font-mono text-xs text-ink-500">{shift(h)}</td>
                      <td className="p-2 text-ink-500">{fmtDateTime(h.taken_at)}</td>
                      <td className="p-2">
                        <span className={isLate ? 'badge-dang' : 'badge-mute'}>
                          {relativeAge(h.taken_at)}
                        </span>
                      </td>
                      <td className="p-2">
                        {h.due_at ? (
                          <>
                            <span className={isLate ? 'text-danger-txt' : 'text-ink-500'}>
                              {fmtDateTime(h.due_at)}
                            </span>
                            {isLate && (
                              <p className="text-xs text-danger-txt">
                                เกินมาแล้ว {relativeAge(h.due_at)}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-300">ยังไม่ได้ตั้งกะ</span>
                        )}
                      </td>
                      <td className="p-2 font-mono text-xs">{h.ref_no}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          <p className="mt-2 text-sm text-ink-500">
            แสดง {rows.length} เครื่อง จากที่ถูกยืมอยู่ {all.length} เครื่อง
          </p>
        </>
      )}

      <p className="mt-4 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
        แถวสีแดงคือเลยเวลาเลิกกะของเจ้าตัวแล้ว — กำหนดคืนคำนวณจากกะที่ตั้งไว้ในบัญชีของแต่ละคน
        <br />
        คนที่ยังไม่ได้ตั้งกะจะไม่มีกำหนดคืน ตั้งได้ที่หน้าผู้ใช้และสิทธิ์
      </p>
    </div>
  )
}
