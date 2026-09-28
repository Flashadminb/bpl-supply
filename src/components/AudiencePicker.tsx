import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { listDepartments, listProfiles } from '../lib/api'
import { ErrorBox, Loading } from './ui'

/**
 * เลือกผู้รับ — ใช้ร่วมกันทั้งป้ายประกาศและนัดประชุม
 *
 * เขียนเป็นตัวเดียวเพราะกติกาเหมือนกันเป๊ะ
 * ถ้าแยกสองตัว วันหนึ่งจะแก้ตัวเดียวแล้วลืมอีกตัว
 * แล้วประกาศกับนัดประชุมจะเลือกคนได้ไม่เหมือนกันโดยไม่มีเหตุผล
 *
 * แผนกกับรายคนเป็น "หรือ" กัน — ใครเข้าข้อใดข้อหนึ่งก็ได้รับ
 * เลือกแผนก OUT 4W แล้วเติมชื่อคนจากแผนกอื่นได้ โดยไม่ต้องเลือกทั้งแผนกเขา
 */

export interface Audience {
  mode: 'all' | 'picked'
  deptCodes: string[]
  userIds: string[]
}

export const EMPTY_AUDIENCE: Audience = { mode: 'all', deptCodes: [], userIds: [] }

export function AudiencePicker({
  value,
  onChange,
  allLabel = 'ทุกคนในระบบ',
  allHint = 'ทุกคนที่ล็อกอินได้จะได้รับ',
}: {
  value: Audience
  onChange: (v: Audience) => void
  allLabel?: string
  allHint?: string
}) {
  const depts = useAsync(listDepartments, [])
  const people = useAsync(listProfiles, [])
  const [find, setFind] = useState('')

  const deptName = useMemo(
    () => new Map((depts.data ?? []).map((d) => [d.code, d.name])),
    [depts.data],
  )
  const personName = useMemo(
    () => new Map((people.data ?? []).map((p) => [p.id, p.full_name])),
    [people.data],
  )

  /** คนที่ปิดใช้งานแล้วไม่ต้องโผล่ ไม่งั้นรายชื่อจะรกขึ้นทุกเดือน */
  const pickable = useMemo(() => (people.data ?? []).filter((p) => p.is_active), [people.data])

  const found = useMemo(() => {
    const q = find.trim().toLowerCase()
    if (!q) return pickable
    return pickable.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        p.employee_code.toLowerCase().includes(q) ||
        (p.dept_code ?? '').toLowerCase().includes(q) ||
        (deptName.get(p.dept_code ?? '') ?? '').toLowerCase().includes(q),
    )
  }, [pickable, find, deptName])

  /** จำนวนคนที่จะได้รับจริง — นับหัวไม่ซ้ำ เพราะคนหนึ่งอาจเข้าทั้งสองเงื่อนไข */
  const reach = useMemo(() => {
    if (value.mode === 'all') return pickable.length
    const set = new Set(value.userIds)
    for (const p of pickable) {
      const mine = [p.dept_code, ...(p.extra_depts ?? [])].filter(Boolean) as string[]
      if (value.deptCodes.includes('ALL') || mine.some((d) => value.deptCodes.includes(d))) {
        set.add(p.id)
      }
    }
    return set.size
  }, [value, pickable])

  const toggleDept = (code: string) =>
    onChange({
      ...value,
      deptCodes: value.deptCodes.includes(code)
        ? value.deptCodes.filter((c) => c !== code)
        : [...value.deptCodes, code],
    })

  const toggleUser = (id: string) =>
    onChange({
      ...value,
      userIds: value.userIds.includes(id)
        ? value.userIds.filter((u) => u !== id)
        : [...value.userIds, id],
    })

  return (
    <div>
      <div className="space-y-2">
        {(
          [
            { key: 'all' as const, label: allLabel, hint: allHint },
            {
              key: 'picked' as const,
              label: 'เลือกเจาะจง',
              hint: 'เลือกเป็นแผนก หรือรายคน ผสมกันได้',
            },
          ]
        ).map((o) => (
          <label
            key={o.key}
            className={`flex cursor-pointer gap-3 rounded-card border p-3 ${
              value.mode === o.key ? 'border-ink bg-surface-2' : 'border-line bg-surface'
            }`}
          >
            <input
              type="radio"
              name="aud-mode"
              className="mt-1 h-5 w-5 shrink-0"
              checked={value.mode === o.key}
              onChange={() => onChange({ ...value, mode: o.key })}
            />
            <span className="min-w-0">
              <span className="block font-display text-base">{o.label}</span>
              <span className="block text-sm text-ink-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {value.mode === 'picked' && (
        <div className="mt-3 rounded-card border border-line p-3">
          <p className="label">แผนก</p>
          {depts.loading && <Loading />}
          <div className="flex flex-wrap gap-2">
            {(depts.data ?? [])
              .filter((d) => d.is_active)
              .map((d) => (
                <button
                  key={d.code}
                  type="button"
                  className={`chip ${value.deptCodes.includes(d.code) ? 'chip-on' : ''}`}
                  onClick={() => toggleDept(d.code)}
                >
                  {d.name}
                </button>
              ))}
          </div>

          <p className="label mt-4">
            รายคน
            {value.userIds.length > 0 && (
              <span className="ml-2 font-normal text-ink-500">
                เลือกแล้ว {value.userIds.length} คน
              </span>
            )}
          </p>

          {value.userIds.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {value.userIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="chip chip-on"
                  onClick={() => toggleUser(id)}
                >
                  {personName.get(id) ?? id.slice(0, 8)} ✕
                </button>
              ))}
            </div>
          )}

          <input
            className="input"
            placeholder="พิมพ์ชื่อ รหัสพนักงาน หรือแผนก เพื่อค้นหา"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />

          {people.loading && <Loading />}
          {people.error && <ErrorBox message={people.error} onRetry={people.reload} />}

          {/* จำกัดความสูง ไม่งั้นรายชื่อ 77 คนจะดันปุ่มบันทึกตกจอ */}
          <ul className="mt-2 max-h-[220px] overflow-y-auto rounded-btn border border-line">
            {found.length === 0 && (
              <li className="px-3 py-3 text-sm text-ink-400">ไม่พบคนที่ค้นหา</li>
            )}
            {found.map((p) => (
              <li key={p.id} className="border-b border-line last:border-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0"
                    checked={value.userIds.includes(p.id)}
                    onChange={() => toggleUser(p.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{p.full_name}</span>
                    <span className="block font-mono text-xs text-ink-400">
                      {p.employee_code}
                      {p.dept_code ? ` · ${deptName.get(p.dept_code) ?? p.dept_code}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <p className="mt-1 text-xs text-ink-400">
            แผนกกับรายคนเป็น “หรือ” กัน — ใครเข้าข้อใดข้อหนึ่งก็ได้รับ
          </p>
        </div>
      )}

      <p
        className={`mt-2 rounded-card px-3 py-2 text-sm ${
          value.mode === 'picked' && reach === 0
            ? 'bg-danger-bg text-danger-txt'
            : 'bg-brand-50 text-ink-700'
        }`}
      >
        {value.mode === 'picked' && reach === 0
          ? 'ยังไม่ได้เลือกใครเลย — ตอนนี้จะไม่มีใครได้รับ'
          : `จะถึงมือ ${reach} คน`}
      </p>
    </div>
  )
}
