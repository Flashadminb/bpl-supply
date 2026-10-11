import { useMemo, useState } from 'react'
import {
  listAssetGrants,
  listAssets,
  addAssetGrants,
  listProfiles,
  removeAssetGrant,
  updateProfile,
} from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { EmptyState, ErrorBox, Loading, Spinner } from '../../components/ui'
import { roleLabel, withoutOwner } from '../../lib/roles'
import { useAuth } from '../../lib/auth'
import { MultiPick, type PickOption } from '../../components/MultiPick'
import { FlagGuide } from '../../components/FlagGuide'
import { fmtDateTime } from '../../lib/format'
import type { Profile } from '../../lib/types'
import { deptName } from '../../lib/deptNames'

/**
 * สิทธิ์เข้าถึง — เฉพาะเจ้าของระบบ
 *
 * ของเดิมสิทธิ์กระจายอยู่สองที่ บางอย่างอยู่ในหน้าผู้ใช้และสิทธิ์
 * บางอย่างผูกกับตำแหน่งตายตัวจนแก้ไม่ได้เลยนอกจากเลื่อนตำแหน่งให้ทั้งก้อน
 * ซึ่งให้สิทธิ์อย่างอื่นติดไปด้วยเต็มไปหมด
 *
 * หน้านี้รวมทุกสวิตช์ไว้ที่เดียวและเปิดปิดได้อิสระต่อกัน
 * เลื่อนตำแหน่งยังทำที่หน้าผู้ใช้และสิทธิ์เหมือนเดิม ที่นี่ไม่แตะตำแหน่ง
 *
 * ตารางล่างเป็นสิทธิ์รายเครื่อง ซึ่งเป็นคนละเรื่องกับการโอน
 * การโอนย้ายเครื่องไปอยู่กับคนนั้นจริงและเป็นของชั่วคราว
 * อันนี้แค่ทำให้มองเห็นและเบิกได้ เครื่องไม่ได้ย้ายไปไหน ค้างจนกว่าจะเอาออก
 */

type Tab = 'people' | 'assets'

/** สวิตช์ทั้งหมดที่เปิดปิดได้รายคน — เพิ่มธงใหม่ให้มาต่อแถวนี้ */
const FLAGS: {
  key:
    | 'can_assets'
    | 'can_proxy'
    | 'can_sack'
    | 'can_dispatch'
    | 'can_guard'
    | 'can_break_issue'
    | 'can_break_guard'
    | 'can_break_ban'
  label: string
  on: string
  off: string
  hint: string
}[] = [
  {
    key: 'can_assets',
    label: 'เบิก Asset',
    on: 'เบิกได้',
    off: 'ปิด',
    hint: 'ไอดาต้า · Power Pallet · วิทยุ · เลเซอร์ลบ',
  },
  {
    key: 'can_proxy',
    label: 'เบิกแทน/โอนเครื่อง',
    on: 'ทำได้',
    off: 'ปิด',
    // ฐานข้อมูลใช้ธงตัวเดียวกันคุมทั้งสองอย่าง ตั้งชื่อให้ตรงดีกว่าปล่อยให้เซอร์ไพรส์
    hint: 'เบิกแทนคนอื่น (ของไปค้างชื่อคนที่เลือก) และโอนเครื่องให้คนอื่น',
  },
  {
    key: 'can_sack',
    label: 'กระสอบ',
    on: 'เห็น',
    off: 'ไม่เห็น',
    hint: 'เห็นกระสอบรอส่งและกดส่งได้',
  },
  {
    key: 'can_dispatch',
    label: 'ผู้ตรวจสอบ',
    on: 'ใช่',
    off: 'ไม่',
    hint: 'เห็นเครื่องทุกแผนก เข้าหน้าตรวจสอบได้ · ไม่เห็นงานกระสอบ',
  },
  {
    key: 'can_guard',
    label: 'รปภ',
    on: 'ใช่',
    off: 'ไม่',
    hint: 'เห็นแค่หน้าสแกนบัตร OS',
  },
  {
    key: 'can_break_issue',
    label: 'ปล่อยบัตรเบรค',
    on: 'ปล่อยได้',
    off: 'ปิด',
    // เปิดธงอย่างเดียวยังไม่พอ ต้องใส่เขาไว้ในแผนกบัตรด้วย
    // ไม่งั้นเขาเปิดหน้าได้แต่ไม่เห็นบัตรสักใบ แล้วจะคิดว่าระบบพัง
    hint: 'หัวหน้างาน · ต้องเพิ่มเขาเข้าแผนกบัตรในหน้าตั้งค่าบัตรเบรคด้วย',
  },
  {
    key: 'can_break_guard',
    label: 'สแกนบัตรเบรค',
    on: 'สแกนได้',
    off: 'ปิด',
    hint: 'รปภ · สแกนขาออกและขากลับ ไม่เห็นรูปและไม่เห็นประวัติ',
  },
  {
    key: 'can_break_ban',
    label: 'สั่งห้ามเบรค',
    on: 'กดได้',
    off: 'ปิด',
    // ตั้งที่หน้าจัดการบัตรเบรคก็ได้ ธงเดียวกัน แก้ที่ไหนก็เห็นตรงกันทั้งสองที่
    hint: 'มีปุ่มห้ามเบรคเดี๋ยวนี้ในแอป · ตั้งที่หน้าจัดการบัตรเบรคได้เหมือนกัน',
  },
]

export default function Access() {
  const { profile: me } = useAuth()
  const [tab, setTab] = useState<Tab>('people')
  const people = useAsync(() => listProfiles(), [])
  const grants = useAsync(() => listAssetGrants(), [])
  const assets = useAsync(() => listAssets(), [])

  const [q, setQ] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const rows = useMemo(() => {
    const all = withoutOwner((people.data ?? []).filter((p) => p.is_active), me)
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (p) =>
        p.full_name.toLowerCase().includes(needle) ||
        p.employee_code.toLowerCase().includes(needle) ||
        (p.dept_code ?? '').toLowerCase().includes(needle),
    )
  }, [people.data, q])

  async function flip(p: Profile, key: (typeof FLAGS)[number]['key']) {
    setSavingId(p.id)
    setErr(null)
    setDone(null)
    try {
      await updateProfile(p.id, { [key]: !p[key] } as Partial<Profile>)
      people.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSavingId(null)
    }
  }

  /* ----------------------------------------------- เพิ่มสิทธิ์รายเครื่อง
   *
   * เลือกได้ทั้งหลายเครื่องและหลายคน แล้วยิงเป็นคู่ไขว้ทีเดียว
   * ของเดิมเลือกได้ทีละคู่ ซึ่งงานจริงอย่าง "เครื่องกลุ่มนี้ให้กะดึกห้าคนเห็น"
   * ต้องกดยี่สิบห้ารอบ แปลว่าไม่มีใครตั้ง แล้วไปจบที่ย้ายแผนกเครื่องทั้งก้อนแทน
   */
  const [pickAssets, setPickAssets] = useState<string[]>([])
  const [pickUsers, setPickUsers] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)

  const assetOptions = useMemo<PickOption[]>(
    () =>
      (assets.data ?? []).map((a) => ({
        id: a.code,
        line: a.code,
        sub: `${a.asset_types?.name ?? a.type_code} · ${deptName(a.dept_code ?? 'ALL')}`,
        hay: `${a.code} ${a.asset_types?.name ?? ''} ${a.type_code} ${a.dept_code ?? ''} ${deptName(a.dept_code ?? 'ALL')}`,
      })),
    [assets.data],
  )

  const userOptions = useMemo<PickOption[]>(
    () =>
      withoutOwner(people.data ?? [], me)
        .filter((p) => p.is_active)
        .map((p) => ({
          id: p.id,
          line: p.full_name,
          sub: `${p.employee_code} · ${deptName(p.dept_code)}${p.sub_dept ? ' · ' + p.sub_dept : ''}`,
          hay: `${p.full_name} ${p.employee_code} ${p.dept_code ?? ''} ${p.sub_dept ?? ''} ${deptName(p.dept_code)}`,
        })),
    [people.data, me],
  )

  const pairs = pickAssets.length * pickUsers.length

  async function addGrant() {
    if (pairs === 0) return
    setAdding(true)
    setErr(null)
    setDone(null)
    try {
      const r = await addAssetGrants({ codes: pickAssets, userIds: pickUsers, note })
      const parts = [`เปิดสิทธิ์ ${r.assets} เครื่อง × ${r.people} คน`]
      if (r.added > 0) parts.push(`เพิ่มใหม่ ${r.added} คู่`)
      if (r.updated > 0) parts.push(`มีอยู่แล้ว ${r.updated} คู่ · ทับของเดิม`)
      if (r.skipped_codes > 0) parts.push(`ข้ามรหัสเครื่องที่ไม่มีจริง ${r.skipped_codes}`)
      if (r.skipped_users > 0) parts.push(`ข้ามบัญชีที่ถูกระงับ ${r.skipped_users}`)
      setDone(parts.join(' · '))
      setPickAssets([])
      setPickUsers([])
      setNote('')
      grants.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  const gRows = grants.data ?? []

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-xl">สิทธิ์เข้าถึง</h1>
        <p className="text-sm text-ink-400">
          เปิดปิดได้อิสระรายคน · เปลี่ยนตำแหน่งยังทำที่หน้าผู้ใช้และสิทธิ์เหมือนเดิม
        </p>
      </div>

      {err && <ErrorBox message={err} />}
      {done && (
        <div className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          {done}
          <button type="button" className="ml-2 underline" onClick={() => setDone(null)}>
            ปิด
          </button>
        </div>
      )}

      <FlagGuide />

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className={`chip ${tab === 'people' ? 'chip-on' : ''}`}
          onClick={() => setTab('people')}
        >
          สิทธิ์รายคน · {rows.length}
        </button>
        <button
          type="button"
          className={`chip ${tab === 'assets' ? 'chip-on' : ''}`}
          onClick={() => setTab('assets')}
        >
          เครื่องเฉพาะคน · {gRows.length}
        </button>
      </div>

      {tab === 'people' && (
        <>
          <input
            className="input mb-3 w-full max-w-[320px]"
            placeholder="ค้นหาชื่อ รหัสพนักงาน หรือแผนก"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {people.loading && <Loading />}
          {people.error && <ErrorBox message={people.error} onRetry={people.reload} />}
          {!people.loading && rows.length === 0 && (
            <EmptyState title="ไม่เจอคนที่ค้นหา" hint="ลองพิมพ์รหัสพนักงานแทน" />
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-card border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="text-ink-500">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">ชื่อ</th>
                    <th className="w-[150px] px-3 py-2 font-medium">แผนก</th>
                    {FLAGS.map((f) => (
                      <th key={f.key} className="w-[120px] px-3 py-2 font-medium" title={f.hint}>
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-line-2 align-top last:border-0">
                      <td className="px-3 py-2">
                        {p.full_name}
                        <span className="block font-mono text-xs text-ink-400">
                          {p.employee_code}
                        </span>
                        <span className="block text-xs text-ink-400">{roleLabel(p)}</span>
                      </td>
                      <td className="px-3 py-2">
                        {deptName(p.dept_code)}
                        {/* แผนกที่เห็นเพิ่มตั้งที่หน้าผู้ใช้และสิทธิ์ ไม่ย้ายมาซ้ำสองที่
                            ของแบบนี้อยู่สองที่แล้วจะมีวันที่สองที่ไม่ตรงกัน */}
                        {p.extra_depts && p.extra_depts.length > 0 && (
                          <span className="block text-xs text-ink-400">
                            +{p.extra_depts.length} แผนก
                          </span>
                        )}
                      </td>
                      {FLAGS.map((f) => {
                        // ผู้ตรวจสอบไม่เห็นงานกระสอบ ตามที่สั่งไว้ว่าเอาออกทั้งหมด
                        const locked = f.key === 'can_sack' && p.can_dispatch
                        const on = Boolean(p[f.key])
                        return (
                          <td key={f.key} className="px-3 py-2">
                            <button
                              type="button"
                              className={on ? 'badge-ok' : 'badge-mute'}
                              disabled={savingId === p.id || locked}
                              onClick={() => void flip(p, f.key)}
                              title={locked ? 'ผู้ตรวจสอบไม่เห็นงานกระสอบ' : f.hint}
                            >
                              {locked ? '—' : on ? f.on : f.off}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'assets' && (
        <>
          <div className="mb-3 rounded-card border border-line bg-surface p-3">
            <p className="font-display">เปิดให้คนหนึ่งคนเห็นเครื่องหนึ่งเครื่อง</p>
            <p className="mb-3 text-sm text-ink-500">
              คนละเรื่องกับการโอน — การโอนย้ายเครื่องไปอยู่กับคนนั้นจริงและเป็นของชั่วคราว
              อันนี้แค่ทำให้มองเห็นและเบิกได้ เครื่องยังเป็นของแผนกเดิม และค้างไว้จนกว่าจะเอาออก
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <MultiPick
                label="เครื่อง"
                hint="พิมพ์รหัสเครื่อง ชนิด หรือแผนกก็ได้ · เลือกได้หลายเครื่อง"
                options={assetOptions}
                picked={pickAssets}
                onChange={setPickAssets}
                placeholder="พิมพ์รหัสเครื่อง ชนิด หรือแผนก"
              />
              <MultiPick
                label="ให้ใครเห็น"
                hint="พิมพ์ชื่อ รหัสพนักงาน หรือแผนกก็ได้ · เลือกได้หลายคน"
                options={userOptions}
                picked={pickUsers}
                onChange={setPickUsers}
                placeholder="พิมพ์ชื่อ รหัสพนักงาน หรือแผนก"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="grant-note">
                  หมายเหตุ · ไม่บังคับ
                </label>
                <input
                  id="grant-note"
                  className="input h-tap w-full max-w-[320px]"
                  placeholder="เช่น ช่วยงานกะดึก"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="btn-primary h-tap px-4"
                disabled={adding || pairs === 0}
                onClick={() => void addGrant()}
              >
                {adding ? <Spinner /> : null}{' '}
                {pairs === 0
                  ? 'เปิดสิทธิ์'
                  : `เปิดสิทธิ์ ${pickAssets.length} เครื่อง × ${pickUsers.length} คน`}
              </button>
            </div>

            {pairs > 0 && (
              <p className="mt-2 text-xs text-ink-500">
                จะได้ {pairs} คู่ · คู่ที่เปิดไว้แล้วจะถูกทับด้วยหมายเหตุใหม่ ไม่เด้ง error
                กดซ้ำได้เสมอ
              </p>
            )}
          </div>

          {grants.loading && <Loading />}
          {grants.error && <ErrorBox message={grants.error} onRetry={grants.reload} />}
          {!grants.loading && gRows.length === 0 && (
            <EmptyState
              title="ยังไม่ได้เปิดสิทธิ์ให้ใคร"
              hint="ทุกคนเห็นเครื่องตามแผนกของตัวเองตามปกติ"
            />
          )}

          {gRows.length > 0 && (
            <div className="overflow-x-auto rounded-card border border-line bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="text-ink-500">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">เครื่อง</th>
                    <th className="px-3 py-2 font-medium">ให้ใคร</th>
                    <th className="px-3 py-2 font-medium">หมายเหตุ</th>
                    <th className="px-3 py-2 font-medium">เปิดโดย</th>
                    <th className="w-[110px] px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {gRows.map((g) => (
                    <tr
                      key={`${g.asset_code}-${g.user_id}`}
                      className="border-b border-line-2 align-top last:border-0"
                    >
                      <td className="px-3 py-2">
                        <span className="font-mono">{g.asset_code}</span>
                        <span className="block text-xs text-ink-400">{g.type_name}</span>
                        <span className="block text-xs text-ink-400">
                          แผนกเจ้าของ {g.asset_dept ?? 'ALL'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {g.user_name}
                        <span className="block font-mono text-xs text-ink-400">{g.user_code}</span>
                        <span className="block text-xs text-ink-400">{g.user_dept ?? '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-ink-600">{g.note || '—'}</td>
                      <td className="px-3 py-2">
                        {g.granted_by_name ?? '—'}
                        <span className="block text-xs text-ink-400">
                          {fmtDateTime(g.created_at)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="btn-ghost h-tap px-3 text-sm text-danger-txt"
                          onClick={() =>
                            void (async () => {
                              setErr(null)
                              try {
                                await removeAssetGrant(g.asset_code, g.user_id)
                                grants.reload()
                              } catch (e) {
                                setErr((e as Error).message)
                              }
                            })()
                          }
                        >
                          เอาออก
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
