import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  deleteAudienceGroup,
  listAudienceGroups,
  listDepartments,
  listProfiles,
  saveAudienceGroup,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { positionName, positionSuffix } from '../lib/deptNames'
import { MANAGER_ROLES } from '../lib/roles'
import type { AudienceGroup } from '../lib/types'
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
 *
 * กลุ่มที่บันทึกไว้คือทางลัดของวงที่นัดซ้ำทุกรอบ เช่นหัวหน้ากะทั้งฮับ
 * กดกลุ่มแล้ว "เพิ่ม" เข้าไปในที่เลือกอยู่ ไม่ใช่ "แทนที่"
 * เพราะงานจริงคือเอาวงเดิมมาตั้งต้นแล้วเติมคนอีกสองสามคน
 * ถ้าแทนที่ทั้งก้อน คนที่ติ๊กมือไว้ก่อนจะหายไปเงียบ ๆ แล้วไม่มีใครรู้
 *
 * ปุ่มแผนกนับหัวให้เห็นบนตัวปุ่มเลย เพราะเคยมีคนติ๊ก "ทุกแผนก" โดยคิดว่าเป็นแผนกหนึ่ง
 * แล้วนัดประชุม W39 ก็กลายเป็นเชิญทั้งฮับ 85 คน คนที่ไม่รู้เรื่องขึ้นขาดกันหมด
 * ตัวเลขข้างชื่อแผนกทำให้เห็นก่อนกดว่ากำลังจะลากใครเข้ามากี่คน
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
  pickedOnly = false,
}: {
  value: Audience
  onChange: (v: Audience) => void
  allLabel?: string
  allHint?: string
  /**
   * ซ่อนปุ่มเลือกโหมด เหลือแค่ให้ติ๊กแผนกกับรายคน
   *
   * ใช้ตอนแก้รายชื่อของนัดที่ประกาศไปแล้ว ซึ่งฝั่งฐานข้อมูลรับได้แค่แบบเจาะจง
   * โชว์ปุ่ม "ทุกคนในระบบ" ไว้แล้วกดไม่ติด แย่กว่าไม่โชว์
   */
  pickedOnly?: boolean
}) {
  const { can } = useAuth()
  const mayEdit = can(...MANAGER_ROLES)

  const depts = useAsync(listDepartments, [])
  const people = useAsync(listProfiles, [])
  const groups = useAsync(listAudienceGroups, [])
  const [find, setFind] = useState('')

  /** ชื่อที่กำลังพิมพ์ตอนบันทึกกลุ่มใหม่ · null = ยังไม่ได้กดบันทึก */
  const [newName, setNewName] = useState<string | null>(null)
  /** เปิดโหมดจัดการ · ปกติซ่อนไว้ เพราะ 99% ของการใช้คือกดกลุ่มแล้วไปต่อ */
  const [manage, setManage] = useState(false)
  const [gBusy, setGBusy] = useState(false)
  const [gErr, setGErr] = useState<string | null>(null)
  const [gNote, setGNote] = useState<string | null>(null)

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
        (deptName.get(p.dept_code ?? '') ?? '').toLowerCase().includes(q) ||
        positionName(p.position_code, '').toLowerCase().includes(q),
    )
  }, [pickable, find, deptName])

/**
   * คนในแผนกนั้น ๆ
   *
   * เทียบกับ dept_code ของตัวเองเท่านั้น ไม่เอา extra_depts มาปน
   * เพราะ extra_depts แปลว่า "คนนี้มองเห็นของแผนกอื่นได้" ไม่ใช่ "สังกัดแผนกอื่น"
   * ของเดิมเอามาปน แปลว่าวันไหนเปิดให้ใครเห็นของแผนก QC เขาจะถูกเรียกเข้าประชุม QC ด้วย
   * ตรงกับกติกาฝั่งฐานข้อมูลใน meeting_audience_members ตั้งแต่ 119
   */
  const headcount = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pickable) {
      const d = p.dept_code ?? 'ALL'
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    return m
  }, [pickable])

  /**
   * จำนวนคนที่จะได้รับจริง แยกเป็นสองกอง
   *
   * ติ๊กชื่อไว้เอง กับ โดนแผนกลากเข้ามาทั้งที่ไม่ได้ติ๊กชื่อ
   *
   * ต้องแยกให้เห็น เพราะเคยเกิดจริงกับนัด W39 — ติ๊กชื่อไว้ 28 คน
   * แล้วติ๊กแผนกไปด้วยอีกสี่แผนก รายชื่อจริงกลายเป็น 53 คน
   * เจ้าของระบบเห็นแล้วงงว่าคนที่ไม่ได้ติ๊กโผล่มาได้ยังไง
   * ของเดิมบอกแค่ยอดรวม ซึ่งไม่ได้ผิด แต่ไม่ได้บอกว่าส่วนเกินมาจากไหน
   */
  const reach = useMemo(() => {
    if (value.mode === 'all') return { total: pickable.length, picked: pickable.length, byDept: 0 }
    const named = new Set(value.userIds)
    const set = new Set(named)
    for (const p of pickable) {
      if (value.deptCodes.includes(p.dept_code ?? 'ALL')) set.add(p.id)
    }
    return { total: set.size, picked: named.size, byDept: set.size - named.size }
  }, [value, pickable])

  /**
   * กดกลุ่ม = รวมเข้ากับที่เลือกอยู่
   *
   * คนที่ปิดบัญชีไปแล้วถูกคัดออกตรงนี้ ไม่ใช่ตอนบันทึก
   * เพราะกลุ่มที่บันทึกไว้เมื่อสามเดือนก่อนย่อมมีคนลาออกไปแล้ว
   * ถ้าปล่อยเข้าไป รายชื่อผู้ต้องเข้าประชุมจะมีคนที่ล็อกอินไม่ได้ติดอยู่ตลอด
   */
  function applyGroup(g: AudienceGroup) {
    const live = new Set(pickable.map((p) => p.id))
    const okDept = new Set((depts.data ?? []).filter((d) => d.is_active).map((d) => d.code))
    const dropped = g.user_ids.filter((id) => !live.has(id)).length
    onChange({
      ...value,
      mode: 'picked',
      deptCodes: [...new Set([...value.deptCodes, ...g.dept_codes.filter((c) => okDept.has(c))])],
      userIds: [...new Set([...value.userIds, ...g.user_ids.filter((id) => live.has(id))])],
    })
    setGErr(null)
    setGNote(
      dropped > 0
        ? `เพิ่มกลุ่ม ${g.name} แล้ว · ข้าม ${dropped} คนที่ปิดบัญชีไปแล้ว`
        : `เพิ่มกลุ่ม ${g.name} เข้าไปในที่เลือกอยู่แล้ว`,
    )
  }

  function runGroup(job: () => Promise<unknown>, done: string) {
    setGBusy(true)
    setGErr(null)
    setGNote(null)
    void job()
      .then(() => {
        setGNote(done)
        groups.reload()
      })
      .catch((e) => setGErr((e as Error).message))
      .finally(() => setGBusy(false))
  }

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
      <div className={`space-y-2 ${pickedOnly ? 'hidden' : ''}`}>
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

      {(pickedOnly || value.mode === 'picked') && (
        <div className="mt-3 rounded-card border border-line p-3">
          <GroupBar
            groups={groups}
            mayEdit={mayEdit}
            picked={value}
            manage={manage}
            setManage={setManage}
            newName={newName}
            setNewName={setNewName}
            busy={gBusy}
            err={gErr}
            note={gNote}
            onApply={applyGroup}
            onSave={(name, id) =>
              runGroup(
                () =>
                  saveAudienceGroup({
                    name,
                    deptCodes: value.deptCodes,
                    userIds: value.userIds,
                    id,
                  }),
                id ? `อัปเดตกลุ่ม ${name} แล้ว` : `บันทึกกลุ่ม ${name} แล้ว`,
              )
            }
            onRename={(g, name) =>
              runGroup(
                () =>
                  saveAudienceGroup({
                    name,
                    deptCodes: g.dept_codes,
                    userIds: g.user_ids,
                    id: g.id,
                  }),
                `เปลี่ยนชื่อเป็น ${name} แล้ว`,
              )
            }
            onDelete={(g) => runGroup(() => deleteAudienceGroup(g.id), `ลบกลุ่ม ${g.name} แล้ว`)}
          />

          <p className="label mt-4">แผนก</p>
          {depts.loading && <Loading />}
          <div className="flex flex-wrap gap-2">
            {(depts.data ?? [])
              .filter((d) => d.is_active)
              .map((d) => {
                const n = headcount.get(d.code) ?? 0
                return (
                  <button
                    key={d.code}
                    type="button"
                    className={`chip ${value.deptCodes.includes(d.code) ? 'chip-on' : ''} ${
                      n === 0 ? 'opacity-50' : ''
                    }`}
                    onClick={() => toggleDept(d.code)}
                  >
                    {d.code === 'ALL' ? 'ไม่สังกัดแผนก' : d.name}
                    <span className="ml-1 text-xs opacity-70">{n}</span>
                  </button>
                )
              })}
          </div>
          {/* แถวนี้ชื่อ "ทุกแผนก" ในตารางแผนก ซึ่งอ่านเหมือนจะเหมาทั้งฮับ
              แต่จริง ๆ เป็นแผนกของคนที่ไม่ได้สังกัดแผนกไหน เช่นบัญชีส่วนกลาง
              จึงเขียนให้ตรงกับความหมาย แล้วบอกทางที่ถูกไว้ข้างล่าง */}
          <p className="mt-1 text-xs text-ink-400">
            ตัวเลขคือจำนวนคนในแผนกนั้น
            {!pickedOnly && <> · ถ้าอยากเชิญทั้งฮับจริง ๆ ให้ย้อนขึ้นไปเลือก “{allLabel}”</>}
          </p>

          <p className="label mt-4 flex items-center gap-2">
            รายคน
            {value.userIds.length > 0 && (
              <span className="font-normal text-ink-500">เลือกแล้ว {value.userIds.length} คน</span>
            )}
            {/* กดกลุ่มเป็นการ "เพิ่ม" จึงต้องมีทางกลับไปเริ่มใหม่ให้เห็นชัด ๆ */}
            {(value.deptCodes.length > 0 || value.userIds.length > 0) && (
              <button
                type="button"
                className="ml-auto font-normal text-ink-500 underline"
                onClick={() => onChange({ ...value, deptCodes: [], userIds: [] })}
              >
                ล้างที่เลือกทั้งหมด
              </button>
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
                      {positionSuffix(p.position_code)}
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
          (pickedOnly || value.mode === 'picked') && reach.total === 0
            ? 'bg-danger-bg text-danger-txt'
            : reach.byDept > 0
              ? 'bg-warn-bg text-warn-txt'
              : 'bg-brand-50 text-ink-700'
        }`}
      >
        {(pickedOnly || value.mode === 'picked') && reach.total === 0 ? (
          'ยังไม่ได้เลือกใครเลย — ตอนนี้จะไม่มีใครได้รับ'
        ) : reach.byDept > 0 ? (
          <>
            <b>รวม {reach.total} คน</b>
            <br />
            ติ๊กชื่อไว้เอง {reach.picked} คน · <b>แผนกที่ติ๊กลากเข้ามาอีก {reach.byDept} คน</b>
            <br />
            ถ้าอยากได้เฉพาะคนที่ติ๊กชื่อ ให้เอาปุ่มแผนกออกให้หมด
          </>
        ) : (
          <>รวม {reach.total} คน</>
        )}
      </p>
    </div>
  )
}

/* ------------------------------------------------ กลุ่มรายชื่อที่บันทึกไว้ */

/**
 * แถบกลุ่ม · ปกติเป็นชิปแถวเดียว กดแล้วรายชื่อเข้าไปเลย
 *
 * ของที่ทำได้มีสี่อย่าง แต่โชว์พร้อมกันไม่ได้
 * เพราะอันที่ใช้ทุกวันคือ "กดกลุ่ม" อีกสามอันใช้เดือนละครั้ง
 * ถ้าวางปุ่มลบไว้ข้างปุ่มใช้งานตลอดเวลา วันหนึ่งจะมีคนกดพลาด
 * จึงซ่อนไว้ใต้ปุ่มจัดการ ซึ่งต้องกดเปิดก่อนถึงจะเห็นปุ่มที่ทำลายของได้
 */
function GroupBar({
  groups,
  mayEdit,
  picked,
  manage,
  setManage,
  newName,
  setNewName,
  busy,
  err,
  note,
  onApply,
  onSave,
  onRename,
  onDelete,
}: {
  groups: { data: AudienceGroup[] | null; loading: boolean; error: string | null; reload: () => void }
  /** หัวหน้างานขึ้นไปบันทึกและแก้ได้ · ผู้ตรวจสอบกดใช้กลุ่มได้อย่างเดียว */
  mayEdit: boolean
  picked: Audience
  manage: boolean
  setManage: (v: boolean) => void
  newName: string | null
  setNewName: (v: string | null) => void
  busy: boolean
  err: string | null
  note: string | null
  onApply: (g: AudienceGroup) => void
  onSave: (name: string, id?: string | null) => void
  onRename: (g: AudienceGroup, name: string) => void
  onDelete: (g: AudienceGroup) => void
}) {
  const rows = groups.data ?? []
  const nothingPicked = picked.deptCodes.length === 0 && picked.userIds.length === 0

  /** ป้ายบนชิป · บอกให้รู้ก่อนกดว่ากำลังจะลากใครเข้ามากี่คน */
  const size = (g: AudienceGroup) =>
    [
      g.dept_codes.length > 0 ? `${g.dept_codes.length} แผนก` : '',
      g.user_ids.length > 0 ? `${g.user_ids.length} คน` : '',
    ]
      .filter(Boolean)
      .join(' + ')

  return (
    <div className="mb-1">
      <p className="label flex items-center gap-2">
        กลุ่มที่บันทึกไว้
        {mayEdit && rows.length > 0 && (
          <button
            type="button"
            className="ml-auto font-normal text-ink-500 underline"
            onClick={() => setManage(!manage)}
          >
            {manage ? 'เสร็จแล้ว' : 'จัดการกลุ่ม'}
          </button>
        )}
      </p>

      {groups.loading && <Loading />}
      {groups.error && <ErrorBox message={groups.error} onRetry={groups.reload} />}

      {!groups.loading && rows.length === 0 && (
        <p className="text-sm text-ink-400">
          ยังไม่มีกลุ่ม · เลือกคนที่ต้องการให้ครบแล้วกด “บันทึกเป็นกลุ่ม” ไว้ใช้รอบหน้า
        </p>
      )}

      {/* โหมดปกติ · ชิปเดียวจบ ไม่มีปุ่มอันตรายอยู่ใกล้นิ้ว */}
      {!manage && rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {rows.map((g) => (
              <button key={g.id} type="button" className="chip" onClick={() => onApply(g)}>
                {g.name}
                <span className="ml-1 text-xs opacity-70">{size(g)}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-400">
            กดกลุ่มเพื่อ <b>เพิ่ม</b> รายชื่อในกลุ่มนั้นเข้าไปในที่เลือกอยู่ · กดหลายกลุ่มต่อกันได้
            ชื่อซ้ำไม่นับสองรอบ
          </p>
        </>
      )}

      {/* โหมดจัดการ · เปลี่ยนชื่อ ทับด้วยที่เลือกอยู่ หรือลบ */}
      {manage && (
        <ul className="space-y-2">
          {rows.map((g) => (
            <GroupEditRow
              key={g.id}
              g={g}
              size={size(g)}
              busy={busy}
              nothingPicked={nothingPicked}
              onSave={onSave}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      {/* บันทึกกลุ่มใหม่ · ขึ้นเฉพาะตอนที่มีอะไรให้บันทึกจริง ๆ */}
      {mayEdit && !nothingPicked && (
        <div className="mt-2">
          {newName === null ? (
            <button
              type="button"
              className="btn-soft text-sm"
              onClick={() => setNewName('')}
            >
              บันทึกที่เลือกอยู่เป็นกลุ่ม
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input flex-1"
                autoFocus
                placeholder="ตั้งชื่อกลุ่ม เช่น หัวหน้ากะทั้งฮับ"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy || newName.trim() === ''}
                onClick={() => {
                  onSave(newName.trim(), null)
                  setNewName(null)
                }}
              >
                บันทึก
              </button>
              <button
                type="button"
                className="btn-soft text-sm"
                onClick={() => setNewName(null)}
              >
                ยกเลิก
              </button>
              <p className="w-full text-xs text-ink-400">
                ตั้งชื่อเดิมที่มีอยู่แล้ว = ทับกลุ่มนั้นด้วยที่เลือกอยู่ตอนนี้
              </p>
            </div>
          )}
        </div>
      )}

      {note && (
        <p className="mt-2 rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">{note}</p>
      )}
      {err && (
        <div className="mt-2">
          <ErrorBox message={err} />
        </div>
      )}
    </div>
  )
}

/**
 * หนึ่งแถวในโหมดจัดการ
 *
 * ชื่อเก็บเป็น state ของแถวตัวเอง ไม่ได้ยกไปไว้ข้างบน
 * ถ้ายกไปไว้ข้างบน การพิมพ์ชื่อกลุ่มหนึ่งจะวาดทุกแถวใหม่ทุกตัวอักษร
 */
function GroupEditRow({
  g,
  size,
  busy,
  nothingPicked,
  onSave,
  onRename,
  onDelete,
}: {
  g: AudienceGroup
  size: string
  busy: boolean
  nothingPicked: boolean
  onSave: (name: string, id?: string | null) => void
  onRename: (g: AudienceGroup, name: string) => void
  onDelete: (g: AudienceGroup) => void
}) {
  const [name, setName] = useState(g.name)
  const renamed = name.trim() !== '' && name.trim() !== g.name

  return (
    <li className="rounded-btn border border-line p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`ชื่อกลุ่ม ${g.name}`}
        />
        <span className="text-xs text-ink-400">{size}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {renamed && (
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy}
            onClick={() => onRename(g, name.trim())}
          >
            บันทึกชื่อใหม่
          </button>
        )}
        <button
          type="button"
          className="btn-soft text-sm"
          disabled={busy || nothingPicked}
          onClick={() => onSave(name.trim() || g.name, g.id)}
          title={nothingPicked ? 'ยังไม่ได้เลือกใครไว้ทับ' : undefined}
        >
          ทับด้วยที่เลือกอยู่
        </button>
        <button
          type="button"
          className="btn-danger text-sm"
          disabled={busy}
          onClick={() => {
            if (confirm(`ลบกลุ่ม ${g.name} ใช่ไหม · รายชื่อที่นัดไปแล้วไม่กระทบ`)) onDelete(g)
          }}
        >
          ลบ
        </button>
      </div>
    </li>
  )
}
