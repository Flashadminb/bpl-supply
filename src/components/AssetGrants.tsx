import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { addAssetGrants, listAssetGrants, listProfiles, removeAssetGrant } from '../lib/api'
import { MultiPick, type PickOption } from './MultiPick'
import { deptName, positionSuffix } from '../lib/deptNames'
import { readableError } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { withoutOwner } from '../lib/roles'
import { ErrorBox, Loading, Spinner } from './ui'

/**
 * สิทธิ์เฉพาะคนของเครื่องเดียว
 *
 * เดิมตั้งได้ที่หน้า "สิทธิ์เข้าถึง" อย่างเดียว ซึ่งเป็นหน้าที่เอาไว้มองภาพรวม
 * แต่เวลาคนทำงานจริง เขากำลังเปิดเครื่องคันนั้นอยู่ในทะเบียน
 * แล้วต้องจำรหัสเครื่อง เด้งไปอีกหน้า ค้นหาใหม่ ซึ่งคือจังหวะที่คนเลิกตั้ง
 *
 * คนละเรื่องกับการโอน · การโอนย้ายเครื่องไปอยู่กับคนนั้นจริงและเป็นของชั่วคราว
 * อันนี้แค่ "มองเห็นและเบิกได้" เครื่องไม่ได้ย้ายไปไหน และค้างไว้จนกว่าจะเอาออก
 *
 * ตั้งได้เฉพาะเจ้าของระบบ ซึ่งบังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม
 */
export function AssetGrants({ code, canEdit }: { code: string; canEdit: boolean }) {
  const { profile: me } = useAuth()
  const all = useAsync(listAssetGrants, [])
  const people = useAsync(listProfiles, [])
  const [pick, setPick] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const mine = useMemo(
    () => (all.data ?? []).filter((g) => g.asset_code === code),
    [all.data, code],
  )
  const already = useMemo(() => new Set(mine.map((g) => g.user_id)), [mine])

/**
   * คนที่ยังไม่ได้เปิดสิทธิ์ให้
   *
   * เลือกได้หลายคนในรอบเดียว เพราะงานจริงคือ "เครื่องนี้ให้กะดึกทั้งกะเห็น"
   * ไม่ใช่ทีละคน · ที่หน้าสิทธิ์เข้าถึงเลือกได้ทั้งหลายเครื่องและหลายคนพร้อมกัน
   */
  const options = useMemo<PickOption[]>(
    () =>
      withoutOwner(people.data ?? [], me)
        .filter((p) => p.is_active && !already.has(p.id))
        .map((p) => ({
          id: p.id,
          line: p.full_name,
          sub: `${p.employee_code} · ${deptName(p.dept_code, '—')}${positionSuffix(p.position_code)}`,
          hay: `${p.full_name} ${p.employee_code} ${p.dept_code ?? ''} ${deptName(p.dept_code, '')}`,
        })),
    [people.data, already, me],
  )

  function run(job: () => Promise<unknown>, done: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    void job()
      .then(() => {
        setMsg(done)
        setPick([])
        setNote('')
        all.reload()
      })
      .catch((e) => setErr(readableError(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div>
      <h3 className="font-display">
        เปิดให้เห็นเป็นรายคน
        {mine.length > 0 && <span className="ml-2 text-sm text-ink-400">{mine.length} คน</span>}
      </h3>
      <p className="mb-2 text-sm text-ink-500">
        คนที่อยู่ในรายการนี้จะเห็นและเบิกเครื่องนี้ได้ แม้จะอยู่คนละแผนกกับเครื่อง
        <br />
        ไม่ใช่การโอน · เครื่องไม่ได้ย้ายไปอยู่กับเขา และสิทธิ์ค้างไว้จนกว่าจะเอาออก
      </p>

      {all.loading && <Loading />}
      {all.error && <ErrorBox message={all.error} onRetry={all.reload} />}
      {err && (
        <div className="mb-2">
          <ErrorBox message={err} />
        </div>
      )}
      {msg && (
        <p className="mb-2 rounded-btn bg-success-bg px-3 py-2 text-sm text-success-txt">{msg}</p>
      )}

      {all.data && mine.length === 0 && (
        <p className="rounded-btn bg-surface-2 px-3 py-2 text-sm text-ink-500">
          ยังไม่ได้เปิดให้ใครเป็นพิเศษ · เครื่องนี้ใช้กติกาแผนกตามปกติ
        </p>
      )}

      {mine.length > 0 && (
        <ul className="rounded-card border border-line">
          {mine.map((g) => (
            <li
              key={g.user_id}
              className="flex items-center gap-2 border-b border-line-2 px-3 py-2 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{g.user_name}</span>
                <span className="block font-mono text-xs text-ink-400">
                  {g.user_code} · {deptName(g.user_dept, '—')}
                </span>
                {g.note && <span className="block text-xs text-ink-500">{g.note}</span>}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="btn-soft shrink-0 text-xs"
                  disabled={busy}
                  onClick={() =>
                    run(() => removeAssetGrant(code, g.user_id), 'เอา ' + g.user_name + ' ออกแล้ว')
                  }
                >
                  เอาออก
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mt-3">
          {people.loading && <Loading />}
          <MultiPick
            label="เพิ่มคน"
            hint="พิมพ์ชื่อ รหัสพนักงาน หรือแผนก · ติ๊กได้หลายคนแล้วกดเพิ่มทีเดียว"
            options={options}
            picked={pick}
            onChange={setPick}
            placeholder="พิมพ์ชื่อหรือรหัสพนักงาน"
          />

          {pick.length > 0 && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <input
                className="input h-tap min-w-0 flex-1"
                placeholder="เหตุผล เช่น ดูแลเครื่องตัวนี้ (ไม่บังคับ)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary h-tap shrink-0 px-4"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      addAssetGrants({
                        codes: [code],
                        userIds: pick,
                        note: note.trim() || null,
                      }),
                    `เปิดให้ ${pick.length} คนเห็นเครื่องนี้แล้ว`,
                  )
                }
              >
                {busy ? <Spinner /> : null} เพิ่ม {pick.length} คน
              </button>
            </div>
          )}
        </div>
      )}

      {!canEdit && (
        <p className="mt-2 text-xs text-ink-400">
          เปิดหรือเอาออกได้เฉพาะเจ้าของระบบ · หน้านี้ดูได้อย่างเดียว
        </p>
      )}
    </div>
  )
}
