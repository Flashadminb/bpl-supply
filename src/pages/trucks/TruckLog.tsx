import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { EVENT_TH, KIND_TH, listTruckLog, type TruckEvent } from '../../lib/trucks'
import { dmy, hm, KindTag } from './parts'

/**
 * ประวัติการแก้ไขของตารางปล่อยรถ
 *
 * สามเหตุการณ์อยู่รายการเดียวกัน เพิ่มรถ ปล่อยรถ ยกเลิก
 * แยกเป็นสามหน้าแปลว่าคนที่สงสัยว่า "รถคันนั้นหายไปไหน"
 * ต้องเดาเองก่อนว่าจะไปหาที่หน้าไหน ซึ่งเป็นคำถามที่เขาตอบไม่ได้
 *
 * ยกเลิกไม่ได้ลบแถวทิ้ง แถวยังอยู่ครบพร้อมเหตุผลและชื่อคนกด
 * ของที่ลบจริงจะไม่มีอะไรให้ตอบในวันที่มีคนถาม
 */

const DAYS = [1, 3, 7, 14, 30]

const COLOR: Record<TruckEvent, string> = {
  add: '#49A9FF',
  release: '#35D98A',
  cancel: '#FF5C5C',
}

export default function TruckLog() {
  const nav = useNavigate()
  const [qs, setQs] = useSearchParams()
  const ev = (qs.get('e') ?? '') as TruckEvent | ''
  const [days, setDays] = useState(7)
  const [q, setQ] = useState('')

  const span = useMemo(
    () => ({
      from: new Date(Date.now() - days * 86400_000).toISOString(),
      to: new Date(Date.now() + 86400_000).toISOString(),
    }),
    [days],
  )
  const log = useAsync(
    () => listTruckLog({ ...span, event: ev || undefined }),
    [span, ev],
  )

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase()
    const all = log.data ?? []
    if (!k) return all
    return all.filter((r) =>
      `${r.branch_name} ${r.branch_code ?? ''} ${r.zone ?? ''} ${r.who ?? ''} ${r.reason ?? ''}`
        .toLowerCase()
        .includes(k),
    )
  }, [log.data, q])

  const n = (e: TruckEvent) => (log.data ?? []).filter((r) => r.event === e).length

  return (
    <div className="min-h-dvh px-4 py-4 sm:px-6" style={{ background: '#0B0E11', color: '#F0F4F9' }}>
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label="ย้อนกลับ"
          className="h-tap w-tap rounded-btn text-xl"
          style={{ color: '#AFC0D4' }}
          onClick={() => nav('/trucks')}
        >
          ←
        </button>
        <span
          className="rounded-md px-2.5 py-1 text-sm font-extrabold"
          style={{ background: '#FFC400', color: '#0B0E11' }}
        >
          FLASH
        </span>
        <span className="text-xl font-bold">ประวัติการแก้ไข · ตารางปล่อยรถ</span>
        <span className="flex-1" />
        <button
          type="button"
          className="h-tap rounded-lg px-4 text-sm font-bold"
          style={{ background: '#1B2430', color: '#F0F4F9' }}
          onClick={() => nav('/trucks')}
        >
          กลับไปกระดาน
        </button>
      </header>

      {/* ───────── ตัวกรอง ───────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([['', 'ทั้งหมด'], ['add', 'เพิ่มรถ'], ['release', 'ปล่อยรถ'], ['cancel', 'ยกเลิก']] as [
          string,
          string,
        ][]).map(([k, label]) => {
          const on = ev === k
          const c = k === '' ? '#AFC0D4' : COLOR[k as TruckEvent]
          return (
            <button
              key={k || 'all'}
              type="button"
              className="h-tap rounded-full px-4 text-sm font-bold"
              style={on ? { background: c, color: '#0B0E11' } : { background: '#1B2430', color: c }}
              onClick={() => {
                const next = new URLSearchParams(qs)
                if (k) next.set('e', k)
                else next.delete('e')
                setQs(next, { replace: true })
              }}
            >
              {label}
              {!ev && k && (log.data ?? []).length > 0 ? ` ${n(k as TruckEvent)}` : ''}
            </button>
          )
        })}

        <span className="flex-1" />

        <select
          className="h-tap rounded-lg px-3 text-sm outline-none"
          style={{ background: '#141920', border: '1px solid #2A313B', color: '#F0F4F9' }}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {DAYS.map((d) => (
            <option key={d} value={d}>
              ย้อนหลัง {d} วัน
            </option>
          ))}
        </select>

        <input
          className="h-tap min-w-[200px] rounded-lg px-3 text-base outline-none sm:max-w-[280px]"
          style={{ background: '#141920', border: '1px solid #2A313B', color: '#F0F4F9' }}
          type="search"
          value={q}
          placeholder="ค้นสาขา โซน คนกด หรือเหตุผล"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {log.loading && <p className="py-6" style={{ color: '#AFC0D4' }}>กำลังโหลด…</p>}
      {log.error && <p className="py-6" style={{ color: '#FF9A9A' }}>{log.error}</p>}
      {!log.loading && rows.length === 0 && (
        <p className="py-10 text-center" style={{ color: '#5A646F' }}>
          ไม่มีรายการในช่วงนี้
        </p>
      )}

      <div className="space-y-2">
        {rows.map((r) => {
          const c = COLOR[r.event]
          const at = new Date(r.at)
          return (
            <div
              key={`${r.run_id}-${r.event}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3"
              style={{ background: '#121820', borderLeft: `5px solid ${c}` }}
            >
              <span
                className="w-[86px] shrink-0 rounded-md px-2 py-1 text-center text-sm font-extrabold"
                style={{ background: `${c}22`, color: c }}
              >
                {EVENT_TH[r.event]}
              </span>

              <span className="font-mono text-base" style={{ color: '#AFC0D4' }}>
                {dmy(at)} <b style={{ color: '#F0F4F9' }}>{hm(at)}</b>
              </span>

              <span className="flex min-w-[180px] flex-1 flex-wrap items-center gap-x-2">
                {r.zone && (
                  <span
                    className="rounded px-1.5 font-mono text-xs font-extrabold"
                    style={{ background: '#1B2430', color: '#7FD1FF' }}
                  >
                    {r.zone}
                  </span>
                )}
                {r.branch_code && (
                  <span className="font-mono text-base font-extrabold" style={{ color: '#FFC400' }}>
                    {r.branch_code}
                  </span>
                )}
                <span className="truncate text-base font-bold">{r.branch_name}</span>
                <KindTag tag={KIND_TH[r.kind]} size={12} />
              </span>

              {r.reason && (
                <span className="text-sm" style={{ color: r.event === 'cancel' ? '#FF9A9A' : '#AFC0D4' }}>
                  {r.reason}
                </span>
              )}

              <span className="text-sm" style={{ color: '#7D8B9B' }}>
                {r.who ?? '—'}
              </span>
            </div>
          )
        })}
      </div>

      {rows.length > 0 && (
        <p className="mt-4 text-center text-xs" style={{ color: '#5A646F' }}>
          แสดง {rows.length} รายการ · เก่าสุด 500 รายการต่อการค้นหนึ่งครั้ง
        </p>
      )}
    </div>
  )
}
