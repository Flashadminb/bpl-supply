import { useEffect, useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { exportToSheet, listProfiles } from '../../lib/api'
import { DateRangePicker } from '../../components/DateRangePicker'
import { BulkDeleteBar, PickBox } from '../../components/BulkDeleteBar'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import {
  addTruckBranches,
  countTruckExportRows,
  deleteTruckBranches,
  getTruckAlertSettings,
  listTruckAlertSubs,
  listTruckBranches,
  purgeExportedTrucks,
  resetTruckCounter,
  saveTruckAlertSettings,
  saveTruckBranch,
  setTruckAlertSub,
  truckCounts,
  type TruckAlertSettings,
  type TruckBranch,
} from '../../lib/trucks'

/**
 * การปล่อยรถ — หน้าหลังบ้าน
 *
 * เจ้าของระบบขอให้การส่งลงชีตไม่ไปอยู่ในหน้ากระดาน
 * ซึ่งถูก เพราะกระดานเป็นหน้าที่เปิดค้างไว้ทั้งกะและคนหน้างานกดตลอดเวลา
 * ปุ่มที่ทำงานหนักและกดผิดแล้วเสียเวลา ไม่ควรอยู่ปนกับปุ่มที่กดวันละสามร้อยครั้ง
 *
 * สามเรื่องในหน้าเดียว เพราะทั้งสามเป็นงานตั้งค่าที่ทำนาน ๆ ที
 */

type Tab = 'sheet' | 'branches' | 'alerts'

const ROLES: { key: string; label: string }[] = [
  { key: 'admin', label: 'ผู้ดูแลระบบ' },
  { key: 'supervisor', label: 'แอดมิน' },
  { key: 'staff', label: 'พนักงานหน้างาน' },
]

function dayKey(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
}

export default function TruckAdmin() {
  const [tab, setTab] = useState<Tab>('sheet')

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-4">
        <h1 className="font-display text-xl">การปล่อยรถ</h1>
        <p className="mt-1 text-sm text-ink-500">
          งานตั้งค่าและงานเก็บประวัติ · หน้ากระดานที่หน้างานใช้อยู่คนละหน้า ไม่มีปุ่มพวกนี้ปน
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['sheet', 'ส่งลงชีตและลบของเก่า'],
            ['branches', 'รายชื่อสาขา'],
            ['alerts', 'แจ้งเตือน'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={tab === k ? 'btn-primary px-4 py-2 text-sm' : 'btn-ghost px-4 py-2 text-sm'}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'sheet' && <SheetTab />}
      {tab === 'branches' && <BranchTab />}
      {tab === 'alerts' && <AlertTab />}
    </div>
  )
}

/* ------------------------------------------------------------- ส่งลงชีต */

function SheetTab() {
  const [from, setFrom] = useState(dayKey(-30))
  const [to, setTo] = useState(dayKey())
  const [tick, setTick] = useState(0)
  const range = useMemo(
    () => ({
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const inRange = useAsync(() => countTruckExportRows(range), [range, tick])
  const all = useAsync(() => countTruckExportRows(), [tick])
  const outside = Math.max(0, (all.data ?? 0) - (inRange.data ?? 0))

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ask, setAsk] = useState(false)

  async function push() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await exportToSheet({ scope: 'truck', from: range.from, to: range.to })
      setMsg(`เพิ่มใหม่ ${r.appended} แถว · อัปของเดิม ${r.updated} แถว · ${r.sheet}`)
      setTick((n) => n + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-3">
        <DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
      </div>

      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {msg && (
        <p className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          {msg}
        </p>
      )}
      {outside > 0 && (
        <p className="mb-3 rounded-card border border-warn/30 bg-warn-bg p-3 text-sm text-warn-txt">
          ยังมีอีก {outside} คันที่ยังไม่ได้ส่งลงชีต แต่อยู่นอกช่วงวันที่ที่เลือกอยู่ —
          ต้องขยายช่วงวันที่ก่อน ถึงจะกดส่งของพวกนั้นได้
        </p>
      )}

      <section className="panel p-4">
        <p className="text-sm text-ink-500">
          ส่งเฉพาะคันที่ปล่อยแล้ว · คันที่ยังอยู่ในคลังยังไม่รู้ผล ส่งไปก็ต้องส่งซ้ำอยู่ดี
          <br />
          แยกแท็บตามเดือน · ส่งซ้ำได้ เขียนทับบรรทัดเดิม ไม่สร้างซ้ำ
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-primary px-5 py-2.5" disabled={busy} onClick={() => void push()}>
            {busy ? <Spinner /> : null} ส่งลง Google Sheet
            {(inRange.data ?? 0) > 0 && (
              <span className="ml-2 rounded-pill bg-ink px-2 font-display text-xs text-white">
                {inRange.data}
              </span>
            )}
          </button>
          <button type="button" className="btn-ghost px-5 py-2.5" disabled={busy} onClick={() => setAsk(true)}>
            ลบของเก่ากว่า 6 เดือน
          </button>
        </div>
      </section>

      <Modal open={ask} onClose={() => setAsk(false)} title="ลบประวัติรถที่เก่ากว่า 6 เดือน">
        <p className="rounded-btn bg-danger-bg px-3 py-3 text-sm text-danger-txt">
          ลบคันที่ปล่อยแล้วและเก่ากว่า 180 วันออกจากฐานข้อมูลถาวร
        </p>
        <p className="mt-2 text-sm text-ink-500">
          ลบได้เฉพาะคันที่ส่งลงชีตไปแล้ว ถ้ามีคันที่ยังไม่ได้ส่งปนอยู่ ระบบจะไม่ลบอะไรเลย
          และบอกว่าเหลือกี่คันที่ต้องกดส่งก่อน
          <br />
          รถวันละสองถึงสี่ร้อยคันคือปีละราวแสนแถว การย้ายที่เก็บไปไว้ที่ชีตจึงไม่ใช่ทางเลือก
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setAsk(false)}>ยกเลิก</button>
          <button
            type="button"
            className="h-tap rounded-btn bg-danger px-4 text-white"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setErr(null)
              void purgeExportedTrucks(180)
                .then((r) => { setMsg(`ลบของเก่าไป ${r.deleted} คัน`); setAsk(false); setTick((n) => n + 1) })
                .catch((e) => setErr((e as Error).message))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? <Spinner /> : null} ลบของเก่า
          </button>
        </div>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------ รายชื่อสาขา */

function BranchTab() {
  const [tick, setTick] = useState(0)
  const list = useAsync(() => listTruckBranches(), [tick])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<TruckBranch> | null>(null)

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const all = list.data ?? []
    if (!s) return all
    return all.filter((b) =>
      `${b.name} ${b.code ?? ''} ${b.full_name ?? ''} ${b.province ?? ''} ${b.zone ?? ''}`
        .toLowerCase()
        .includes(s),
    )
  }, [list.data, q])

  const lines = paste.split('\n').map((l) => l.trim()).filter(Boolean)
  const allPicked = rows.length > 0 && rows.every((b) => picked.has(b.id))

  return (
    <>
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {msg && (
        <p className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          {msg}
        </p>
      )}

      <section className="panel mb-4 p-4">
        <p className="font-display text-sm">เพิ่มทีละหลายอัน</p>
        <p className="mb-2 text-xs text-ink-500">
          วางมาทั้งก้อน บรรทัดละสาขา · ใส่รหัสนำหน้าคั่นด้วยเว้นวรรคหรือจุลภาคก็ได้ หรือใส่แต่ชื่อก็ได้
          <br />
          ชื่อที่มีอยู่แล้วจะถูกข้าม ไม่สร้างซ้ำ
        </p>
        <textarea
          className="input min-h-[120px] w-full font-mono text-sm"
          placeholder={'2BNA01 บางนา\n2LKB03, ลาดกระบัง\nคลองด่าน'}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            className="btn-primary px-5 py-2.5"
            disabled={busy || lines.length === 0}
            onClick={() => {
              setBusy(true); setErr(null); setMsg(null)
              void addTruckBranches(lines)
                .then((r) => { setMsg(`เพิ่มใหม่ ${r.added} สาขา · ข้ามเพราะมีแล้ว ${r.skipped}`); setPaste(''); setTick((n) => n + 1) })
                .catch((e) => setErr((e as Error).message))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? <Spinner /> : null} เพิ่ม {lines.length} บรรทัด
          </button>
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[320px]"
          type="search"
          placeholder="ค้นหาชื่อ รหัส หรือจังหวัด"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPicked(new Set()) }}
        />
        <button type="button" className="btn-ghost px-4 py-2 text-sm" onClick={() => setEdit({})}>
          + เพิ่มทีละอัน
        </button>
        <span className="text-xs text-ink-500">
          กดแก้ไขที่ท้ายแถวเพื่อปรับชื่อ รหัส ชื่อเต็ม พื้นที่ และสถานะเปิดปิด
        </span>
      </div>

      <BulkDeleteBar
        n={picked.size}
        noun="สาขา"
        confirmLabel={`ลบ ${picked.size} สาขา`}
        warning={
          <>
            ลบสาขาที่เลือกออกถาวร
            <br />
            สาขาที่เคยมีรถเข้าแล้วลบไม่ได้ ระบบจะปฏิเสธและบอกชื่อ · ให้ปิดใช้งานแทน
          </>
        }
        onClear={() => setPicked(new Set())}
        onDelete={async (why) => {
          void why
          await deleteTruckBranches([...picked])
          setPicked(new Set())
          setTick((n) => n + 1)
        }}
      />

      {list.loading && <Loading />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {!list.loading && rows.length === 0 && (
        <EmptyState title="ยังไม่มีสาขา" hint="วางรายชื่อในช่องด้านบนแล้วกดเพิ่ม" />
      )}

      <BranchEdit
        value={edit}
        onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); setMsg('บันทึกสาขาแล้ว'); setTick((n) => n + 1) }}
      />

      {rows.length > 0 && (
        <section className="panel overflow-x-auto p-2">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="w-[44px] px-3 py-2">
                  <PickBox
                    on={allPicked}
                    label="เลือกทั้งหมด"
                    onToggle={() => setPicked(allPicked ? new Set() : new Set(rows.map((b) => b.id)))}
                  />
                </th>
                <th className="px-3 py-2 font-medium">ชื่อ</th>
                <th className="w-[110px] px-3 py-2 font-medium">รหัส</th>
                <th className="px-3 py-2 font-medium">ชื่อเต็ม</th>
                <th className="w-[80px] px-3 py-2 font-medium">โซน</th>
                <th className="px-3 py-2 font-medium">พื้นที่</th>
                <th className="w-[110px] px-3 py-2 font-medium">สถานะ</th>
                <th className="w-[80px] px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-line-2 last:border-0">
                  <td className="px-3 py-2">
                    <PickBox
                      on={picked.has(b.id)}
                      label={`เลือก ${b.name}`}
                      onToggle={() =>
                        setPicked((s) => {
                          const n = new Set(s)
                          if (n.has(b.id)) n.delete(b.id)
                          else n.add(b.id)
                          return n
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{b.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{b.code ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-ink-500">{b.full_name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs font-bold">{b.zone ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-ink-500">
                    {[b.province, b.district, b.subdistrict].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    {b.is_open ? (
                      <span className="badge-ok">เปิด</span>
                    ) : (
                      <span className="badge-warn">ปิดบริการ</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEdit(b)}>
                      แก้ไข
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

/**
 * แก้สาขาทีละอัน
 *
 * รายชื่อชุดแรกมาจากชีตขององค์กร ซึ่งสะกดไม่ตรงกับที่หน้างานเรียกกันเสมอ
 * ถ้าบังคับให้ลบแล้วพิมพ์ใหม่ ประวัติรถของสาขานั้นจะหลุดไปด้วย
 * แก้ที่แถวเดิมจึงเป็นทางเดียวที่ไม่ทำให้ของเก่าหาย
 */
function BranchEdit({
  value,
  onClose,
  onSaved,
}: {
  value: Partial<TruckBranch> | null
  onClose: () => void
  onSaved: () => void
}) {
  const [d, setD] = useState<Partial<TruckBranch>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const key = value ? String(value.id ?? 'new') : null

  useEffect(() => {
    if (value) setD({ is_open: true, is_active: true, ...value })
    setErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const f =
    (k: keyof TruckBranch) =>
    (e: { target: { value: string } }) =>
      setD((x) => ({ ...x, [k]: e.target.value }))

  return (
    <Modal open={!!value} onClose={onClose} title={value?.id ? 'แก้ไขสาขา' : 'เพิ่มสาขา'}>
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">ชื่อที่หน้างานเรียก</span>
          <input className="input w-full" value={d.name ?? ''} onChange={f('name')} />
        </label>
        <label className="block">
          <span className="label">รหัสสาขา</span>
          <input className="input w-full font-mono" value={d.code ?? ''} onChange={f('code')} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">ชื่อเต็มตามชีต</span>
          <input className="input w-full" value={d.full_name ?? ''} onChange={f('full_name')} />
        </label>
        <label className="block">
          <span className="label">จังหวัด</span>
          <input className="input w-full" value={d.province ?? ''} onChange={f('province')} />
        </label>
        <label className="block">
          <span className="label">อำเภอ</span>
          <input className="input w-full" value={d.district ?? ''} onChange={f('district')} />
        </label>
        <label className="block">
          <span className="label">ตำบล</span>
          <input className="input w-full" value={d.subdistrict ?? ''} onChange={f('subdistrict')} />
        </label>
        <label className="block">
          <span className="label">รหัสอ้างอิงในชีต</span>
          <input className="input w-full font-mono" value={d.branch_ref ?? ''} onChange={f('branch_ref')} />
        </label>
        <label className="block">
          <span className="label">โซน</span>
          <input
            className="input w-full font-mono"
            placeholder="เช่น D05"
            value={d.zone ?? ''}
            onChange={f('zone')}
          />
          <span className="mt-1 block text-xs text-ink-400">
            มาจากคอลัมน์เลขสายพานในชีตขององค์กร · จอทีวีใช้ค่านี้แยกการ์ดรายโซน
          </span>
        </label>
      </div>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={d.is_open ?? true}
            onChange={(e) => setD((x) => ({ ...x, is_open: e.target.checked }))}
          />
          เปิดบริการ
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5"
            checked={d.is_active ?? true}
            onChange={(e) => setD((x) => ({ ...x, is_active: e.target.checked }))}
          />
          <span>
            ยังใช้งานอยู่
            <span className="block text-xs text-ink-500">
              ติ๊กออกแล้วจะไม่ขึ้นให้เลือกตอนกรอกรถ แต่ประวัติรถเดิมของสาขานี้ยังอยู่ครบ
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
        <button
          type="button"
          className="btn-primary px-5"
          disabled={busy || !(d.name ?? '').trim()}
          onClick={() => {
            setBusy(true)
            setErr(null)
            void saveTruckBranch({
              id: d.id ?? null,
              name: (d.name ?? '').trim(),
              code: (d.code ?? '').trim() || null,
              full_name: (d.full_name ?? '').trim() || null,
              province: (d.province ?? '').trim() || null,
              district: (d.district ?? '').trim() || null,
              subdistrict: (d.subdistrict ?? '').trim() || null,
              branch_ref: (d.branch_ref ?? '').trim() || null,
              zone: (d.zone ?? '').trim().toUpperCase() || null,
              is_open: d.is_open ?? true,
              is_active: d.is_active ?? true,
            })
              .then(onSaved)
              .catch((e) => setErr((e as Error).message))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? <Spinner /> : null} บันทึก
        </button>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------- แจ้งเตือน */

function AlertTab() {
  const [tick, setTick] = useState(0)
  const cfg = useAsync(() => getTruckAlertSettings(), [tick])
  const subs = useAsync(() => listTruckAlertSubs(), [tick])
  const users = useAsync(() => listProfiles(), [])
  const [draft, setDraft] = useState<TruckAlertSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [askReset, setAskReset] = useState(false)

  const s = draft ?? cfg.data ?? null
  const counts = useAsync(() => truckCounts(), [tick])
  const chosen = new Set(subs.data ?? [])

  const people = useMemo(() => {
    const t = q.trim().toLowerCase()
    const all = (users.data ?? []).filter((u) => u.is_active)
    if (!t) return all.filter((u) => chosen.has(u.id)).slice(0, 50)
    return all
      .filter((u) => `${u.full_name} ${u.employee_code} ${u.dept_code ?? ''}`.toLowerCase().includes(t))
      .slice(0, 20)
  }, [users.data, q, subs.data])

  if (cfg.loading && !cfg.data) return <Loading />
  if (cfg.error) return <ErrorBox message={cfg.error} onRetry={cfg.reload} />
  if (!s) return null

  const set = (patch: Partial<TruckAlertSettings>) => setDraft({ ...s, ...patch })

  return (
    <>
      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {msg && (
        <p className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          {msg}
        </p>
      )}

      <section className="panel mb-4 p-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={s.is_on}
            onChange={(e) => set({ is_on: e.target.checked })}
          />
          <span className="font-display">เปิดแจ้งเตือนรถ</span>
        </label>
        <p className="mt-1 text-xs text-ink-500">
          ปิดอยู่ = ไม่มีใครได้รับอะไรเลย แม้จะเลือกคนไว้แล้วก็ตาม
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Num
            label="เตือนล่วงหน้าก่อนครบกำหนด"
            unit="นาที"
            hint="0 = ไม่เตือนล่วงหน้า · ยิงครั้งเดียวต่อคัน"
            value={s.before_min}
            onChange={(v) => set({ before_min: v })}
          />
          <Num
            label="เลยกำหนดไปแล้วกี่นาทีถึงเริ่มเตือน"
            unit="นาที"
            hint="0 = เตือนทันทีที่เลยกำหนด"
            value={s.after_min}
            onChange={(v) => set({ after_min: v })}
          />
        </div>

        <p className="mt-3 rounded-btn bg-ink-50 px-3 py-2 text-xs text-ink-500">
          เตือนครั้งเดียวต่อคัน ทั้งรอบใกล้ครบกำหนดและรอบเลยกำหนด · ไม่มีการย้ำซ้ำ
          <br />
          คนที่ได้รับคือคนที่เดินไปจัดการได้อยู่แล้ว การย้ำทุกสิบห้านาทีไม่ได้ทำให้รถออกเร็วขึ้น
          ได้แค่ทำให้เขาปิดแจ้งเตือนทิ้ง แล้ววันที่สำคัญจริงก็ไม่มีใครเห็น
        </p>

        <p className="label mt-4">ส่งให้ตำแหน่ง</p>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`chip ${s.roles.includes(r.key) ? 'chip-on' : ''}`}
              onClick={() =>
                set({
                  roles: s.roles.includes(r.key)
                    ? s.roles.filter((x) => x !== r.key)
                    : [...s.roles, r.key],
                })
              }
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn-primary px-5 py-2.5"
            disabled={busy || !draft}
            onClick={() => {
              setBusy(true); setErr(null); setMsg(null)
              void saveTruckAlertSettings(s)
                .then(() => { setMsg('บันทึกแล้ว'); setDraft(null); setTick((n) => n + 1) })
                .catch((e) => setErr((e as Error).message))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? <Spinner /> : null} บันทึก
          </button>
          {draft && (
            <button type="button" className="btn-ghost px-5 py-2.5" onClick={() => setDraft(null)}>
              ยกเลิกที่แก้
            </button>
          )}
        </div>
      </section>

      <section className="panel mb-4 p-4">
        <p className="font-display text-sm">ตัวนับ “ปล่อยไปแล้ว” ของจอทีวี</p>
        <p className="mb-2 text-xs text-ink-500">
          ตัวนับตัดรอบเองทุกวันตอน <b>ตีสาม</b> · รอบคือ 03:00 ของวันนี้ ถึง 03:00 ของวันพรุ่งนี้
          <br />
          ไม่ได้ตัดที่เที่ยงคืน เพราะงานรันยี่สิบสี่ชั่วโมงและกะคาบเกี่ยวข้ามวัน
          <br />
          ปุ่มนี้ไว้ตัดรอบกลางวันเอง ถ้าอยากเริ่มนับใหม่ก่อนถึงตีสาม
        </p>
        <p className="mb-3 rounded-btn bg-success-bg px-3 py-2 text-xs text-success-txt">
          รีเซตแค่ตัวเลขที่โชว์บนจอทีวีเท่านั้น · ไม่ได้ลบรถสักคัน
          <br />
          ประวัติรถ หน้าสถิติ และการส่งลงชีต ยังครบเหมือนเดิมทุกคัน ย้อนดูได้ทุกช่วงวันที่
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-ghost px-5 py-2.5"
            disabled={busy}
            onClick={() => setAskReset(true)}
          >
            เริ่มนับใหม่จากศูนย์
          </button>
          {counts.data && (
            <span className="text-sm text-ink-500">
              รอบนี้{' '}
              {new Date(counts.data.cycle_start).toLocaleString('th-TH', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
              })}
              {' – '}
              {new Date(counts.data.cycle_end).toLocaleString('th-TH', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
              })}
              {' · '}นับได้ {counts.data.done} คัน · ตรงเวลา {counts.data.on_time} คัน · เริ่มนับจริง{' '}
              {new Date(counts.data.since).toLocaleString('th-TH', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
              })}
            </span>
          )}
        </div>
      </section>

      {/*
        ถามก่อน เพราะกดแล้วเลขบนจอในคลังเปลี่ยนทันทีต่อหน้าทุกคน
        และคนกดมักกดจากหลังบ้านโดยที่มองไม่เห็นจอนั้น
      */}
      <Modal open={askReset} onClose={() => setAskReset(false)} title="เริ่มนับตัวเลขบนจอทีวีใหม่">
        <p className="rounded-btn bg-success-bg px-3 py-3 text-sm text-success-txt">
          รีเซตแค่ตัวเลขที่โชว์บนจอทีวี · ไม่มีรถคันไหนถูกลบ
          <br />
          ประวัติรถ หน้าสถิติ และการส่งลงชีต ยังครบเหมือนเดิมทุกคัน
        </p>
        {counts.data && (
          <p className="mt-3 text-sm text-ink-500">
            ตอนนี้จอทีวีนับได้ {counts.data.done} คัน · ตรงเวลา {counts.data.on_time} คัน ·
            เกินเวลา {counts.data.done - counts.data.on_time} คัน
            <br />
            กดยืนยันแล้วทั้งสามตัวนี้จะกลับไปเริ่มที่ศูนย์ และเริ่มนับใหม่ตั้งแต่ตอนนี้
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setAskReset(false)}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn-primary px-5"
            disabled={busy}
            onClick={() => {
              setBusy(true); setErr(null); setMsg(null)
              void resetTruckCounter()
                .then(() => {
                  setMsg('จอทีวีเริ่มนับใหม่จากศูนย์แล้ว · ประวัติยังอยู่ครบ')
                  setAskReset(false)
                  setTick((n) => n + 1)
                })
                .catch((e) => setErr((e as Error).message))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? <Spinner /> : null} ยืนยัน เริ่มนับใหม่
          </button>
        </div>
      </Modal>

      <section className="panel p-4">
        <p className="font-display text-sm">ส่งให้รายคน</p>
        <p className="mb-2 text-xs text-ink-500">
          รวมกับตำแหน่งข้างบนแบบบวกกัน · คนที่เลือกไว้แล้วจะขึ้นอยู่ด้านล่างตลอด
        </p>
        <input
          className="input max-w-[320px]"
          type="search"
          placeholder="พิมพ์ชื่อหรือรหัสพนักงาน"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="mt-3 space-y-1">
          {people.map((u) => (
            <li key={u.id} className="flex items-center gap-3 rounded-card border border-line-2 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm">
                {u.full_name}
                <span className="ml-2 font-mono text-xs text-ink-400">{u.employee_code}</span>
                {u.dept_code && <span className="ml-2 text-xs text-ink-400">{u.dept_code}</span>}
              </span>
              <button
                type="button"
                className={chosen.has(u.id) ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-ghost px-3 py-1.5 text-xs'}
                disabled={busy}
                onClick={() => {
                  setBusy(true); setErr(null)
                  void setTruckAlertSub(u.id, !chosen.has(u.id))
                    .then(() => setTick((n) => n + 1))
                    .catch((e) => setErr((e as Error).message))
                    .finally(() => setBusy(false))
                }}
              >
                {chosen.has(u.id) ? 'เอาออก' : 'เพิ่ม'}
              </button>
            </li>
          ))}
          {people.length === 0 && (
            <li className="py-3 text-sm text-ink-500">
              {q ? 'ไม่พบคนที่ค้นหา' : 'ยังไม่ได้เลือกใครเป็นรายคน'}
            </li>
          )}
        </ul>
      </section>
    </>
  )
}

function Num({
  label,
  unit,
  hint,
  value,
  onChange,
}: {
  label: string
  unit: string
  hint: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="input max-w-[110px]"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="text-sm text-ink-500">{unit}</span>
      </div>
      <p className="mt-1 text-xs text-ink-400">{hint}</p>
    </div>
  )
}
