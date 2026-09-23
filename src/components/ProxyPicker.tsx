import { useEffect, useMemo, useState } from 'react'
import { listProxyTargets, type ProxyTarget } from '../lib/api'
import { readableError } from '../lib/supabase'
import { Sheet, Spinner } from './ui'

/**
 * "เบิกให้ใคร" — ขึ้นหน้าสุดของการเบิกอุปกรณ์
 *
 * ปกติเบิกให้ตัวเอง ปุ่มนี้จึงเริ่มที่ตัวเองเสมอ กดเปลี่ยนเมื่อจะเบิกแทนคนอื่น
 * เห็นเฉพาะแอดมิน เจ้าของระบบ และผู้จ่ายอุปกรณ์
 *
 * ของที่เบิกแทนจะไปค้างชื่อคนที่รับ ไม่ใช่ชื่อคนกด
 * กำหนดคืนก็คิดจากกะของคนที่รับ เพราะเขาคือคนที่ต้องเอามาคืน
 */

const shiftText = (t: ProxyTarget) =>
  t.shift_start && t.shift_end
    ? `กะ ${t.shift_start.slice(0, 5)}–${t.shift_end.slice(0, 5)}`
    : 'ยังไม่ได้ตั้งกะ'

export function ProxyPicker({
  value,
  onChange,
  myName,
}: {
  value: ProxyTarget | null
  onChange: (t: ProxyTarget | null) => void
  myName: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<ProxyTarget[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(null)
    listProxyTargets()
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(readableError(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [open])

  // กรองในเครื่อง รายชื่อไม่กี่สิบคน ไม่ต้องยิงถามทุกตัวอักษร
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) =>
      `${r.full_name} ${r.employee_code} ${r.dept_code ?? ''} ${r.sub_dept ?? ''}`
        .toLowerCase()
        .includes(s),
    )
  }, [rows, q])

  return (
    <>
      <div
        className={`mb-3 rounded-card border p-3 ${
          value ? 'border-warn/40 bg-warn-bg' : 'border-line bg-surface'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-ink-500">เบิกให้</p>
            <p className="truncate font-display text-base">
              {value ? value.full_name : `${myName} (ตัวเอง)`}
            </p>
            {value && (
              <p className="truncate text-xs text-warn-txt">
                <span className="font-mono">{value.employee_code}</span>
                {value.dept_code ? ` · ${value.dept_code}` : ''} · {shiftText(value)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {value && (
              <button
                type="button"
                className="btn-ghost h-tap px-3 text-sm"
                onClick={() => onChange(null)}
              >
                เบิกเอง
              </button>
            )}
            <button
              type="button"
              className="btn-soft h-tap px-3 text-sm"
              onClick={() => setOpen(true)}
            >
              {value ? 'เปลี่ยนคน' : 'เบิกให้คนอื่น'}
            </button>
          </div>
        </div>

        {value && (
          <p className="mt-2 text-xs text-warn-txt">
            ของจะไปค้างชื่อ {value.full_name} และกำหนดคืนคิดจากกะของเขา
          </p>
        )}
      </div>

      <Sheet open={open} title="เบิกให้ใคร" onClose={() => setOpen(false)}>
        <input
          className="input mb-3"
          type="search"
          placeholder="ค้นหาชื่อ รหัสพนักงาน หรือแผนก"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />

        {loading && (
          <p className="py-4 text-center text-sm text-ink-500">
            <Spinner /> กำลังโหลดรายชื่อ
          </p>
        )}
        {error && <p className="rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>}

        <ul className="max-h-[52vh] space-y-1 overflow-y-auto">
          <li>
            <button
              type="button"
              className="w-full rounded-card border border-line px-3 py-3 text-left"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              <span className="font-display">{myName} (ตัวเอง)</span>
            </button>
          </li>
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`w-full rounded-card border px-3 py-3 text-left ${
                  value?.id === t.id ? 'border-ink bg-ink text-white' : 'border-line'
                }`}
                onClick={() => {
                  onChange(t)
                  setOpen(false)
                }}
              >
                <span className="block truncate font-display">{t.full_name}</span>
                <span
                  className={`block truncate text-xs ${
                    value?.id === t.id ? 'text-white/70' : 'text-ink-400'
                  }`}
                >
                  <span className="font-mono">{t.employee_code}</span>
                  {t.dept_code ? ` · ${t.dept_code}` : ''}
                  {t.sub_dept ? ` · ${t.sub_dept}` : ''} · {shiftText(t)}
                </span>
              </button>
            </li>
          ))}
          {!loading && shown.length === 0 && (
            <li className="py-6 text-center text-sm text-ink-400">ไม่พบชื่อตามคำค้น</li>
          )}
        </ul>
      </Sheet>
    </>
  )
}
