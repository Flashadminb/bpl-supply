import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { assetIssueEvidence, deleteAssetIssues, resolveAssetIssue } from '../../lib/api'
import { BulkDeleteBar, PickBox } from '../../components/BulkDeleteBar'
import { TextHistory } from '../../components/TextHistory'
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { IssueFixSheet } from '../../components/IssueFixSheet'
import {
  cancelTransfer,
  listAssetIssueRows,
  listAssetTransferRows,
  TRANSFER_CANCEL_REASONS,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { DateRangePicker } from '../../components/DateRangePicker'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { AssetTransferRow } from '../../lib/types'

/**
 * โอน-แจ้งเสีย — ดูย้อนหลังทั้งฮับในหน้าเดียว
 *
 * ของเดิมดูได้ทีละเครื่องจากหน้าทะเบียน ซึ่งตอบคำถามที่ถามบ่อยที่สุดไม่ได้
 * คือ "อาทิตย์นี้ใครโอนอะไรไปให้ใครบ้าง" และ "เครื่องพังไปกี่ใบแล้ว"
 * ต้องไล่เปิดทีละเครื่องจาก 139 เครื่อง ซึ่งไม่มีใครทำจริง
 *
 * หน้านี้ไม่ได้เปลี่ยนสถานะที่โชว์ที่อื่นเลย เป็นหน้าอ่านอย่างเดียว
 * ของค้างคืน สถานะเบิก-คืน และแถบเตือนของหน้างาน ยังทำงานเหมือนเดิมทุกอย่าง
 *
 * ผู้ตรวจสอบเห็นด้วย เพราะเป็นงานตามของ ไม่ใช่งานสั่งการ
 *
 * ลบใบแจ้งเสียได้ตั้งแต่ 094 แต่ลบแล้วไม่หายไปเฉย ๆ
 * ใบที่ลบถูกย่อเป็นข้อความไปอยู่แท็บ "ประวัติที่ลบแล้ว" พร้อมลิงก์รูปในไดร์ฟ
 */

type Tab = 'transfer' | 'issue' | 'history'

/**
 * ยกเลิกการโอนที่ปลายทางยังไม่ได้กดรับ
 *
 * ไม่ได้ลบแถวทิ้ง · แถวยังอยู่ในประวัติพร้อมเหตุผลและชื่อคนกดยกเลิก
 * บังคับใส่เหตุผลด้วยเหตุผลเดียวกับการยกเลิกรถ
 * ยกเลิกเปล่า ๆ อ่านย้อนหลังแล้วตอบไม่ได้ว่าควรโอนใหม่ไหม
 */
function CancelTransferBox({
  row,
  onClose,
  onDone,
}: {
  row: AssetTransferRow | null
  onClose: () => void
  onDone: () => void
}) {
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const reason = why.trim()

  useEffect(() => {
    if (row) {
      setWhy('')
      setErr(null)
    }
  }, [row])

  async function go() {
    if (!row || !reason) return
    setBusy(true)
    setErr(null)
    try {
      await cancelTransfer(row.id, reason)
      onDone()
      onClose()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={Boolean(row)} onClose={onClose} title="ยกเลิกการโอน">
      {row && (
        <>
          <p className="rounded-btn bg-surface-2 px-3 py-2 text-sm">
            <span className="font-mono">{row.asset_code}</span> · {row.type_name}
            <br />
            โอนให้ <b>{row.to_name ?? '—'}</b> เมื่อ {fmtDateTime(row.created_at)}
          </p>

          <p className="label mt-3">เหตุผล</p>
          <div className="mb-2 flex flex-wrap gap-2">
            {TRANSFER_CANCEL_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip ${reason === r ? 'chip-on' : ''}`}
                onClick={() => setWhy(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="หรือพิมพ์เอง"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />

          <p className="mt-2 rounded-btn bg-warn-bg px-3 py-2 text-xs text-warn-txt">
            รายการนี้จะไม่หายไปจากประวัติ · จะขึ้นว่ายกเลิกแล้ว พร้อมเหตุผลและชื่อคนกด
            <br />
            เครื่องกลับไปเป็นของว่างของแผนกเจ้าของ ไม่ได้เด้งกลับไปอยู่กับคนเดิมที่ถูกตัดตอนโอน
            ถ้าอยากให้กลับไปอยู่กับเขา ต้องให้เขากดเบิกใหม่
          </p>

          {err && (
            <div className="mt-2">
              <ErrorBox message={err} />
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              ไม่ยกเลิกแล้ว
            </button>
            <button
              type="button"
              className="btn-danger h-tap px-4"
              disabled={busy || !reason}
              onClick={() => void go()}
            >
              {busy ? <Spinner /> : null} ยืนยันยกเลิกการโอน
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

function dayKey(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
}

export default function AssetMoves() {
  const [sp] = useSearchParams()
  // แจ้งเตือนหน้าแรกพามาที่แท็บแจ้งเสียได้ตรง ๆ ไม่ต้องกดอีกทีให้เสียจังหวะ
  const [tab, setTab] = useState<Tab>(sp.get('tab') === 'issue' ? 'issue' : 'transfer')
  const [openId, setOpenId] = useState<number | null>(null)
  const [fixId, setFixId] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [killing, setKilling] = useState<AssetTransferRow | null>(null)
  // ย้อนหลัง 30 วันเป็นค่าตั้งต้น การโอนกับของพังไม่ได้เกิดทุกวันเหมือนการเบิก
  // ตั้งไว้วันเดียวแล้วหน้าจะว่างเปล่าเกือบตลอด ซึ่งดูเหมือนระบบไม่ทำงาน
  const [from, setFrom] = useState(dayKey(-30))
  const [to, setTo] = useState(dayKey())
  const [onlyOpen, setOnlyOpen] = useState(false)

  const range = useMemo(
    () => ({
      fromISO: new Date(`${from}T00:00:00`).toISOString(),
      toISO: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [from, to],
  )

  const moves = useAsync(() => listAssetTransferRows(range), [range])
  const issues = useAsync(() => listAssetIssueRows({ ...range, onlyOpen }), [range, onlyOpen])

  const mRows = moves.data ?? []
  const iRows = issues.data ?? []
  const openCount = iRows.filter((r) => r.is_open).length
  const waiting = mRows.filter((r) => r.state === 'waiting').length
  const cancelled = mRows.filter((r) => r.state === 'cancelled').length

  const loading = tab === 'transfer' ? moves.loading : tab === 'issue' ? issues.loading : false
  const error = tab === 'transfer' ? moves.error : tab === 'issue' ? issues.error : null
  const reload = tab === 'transfer' ? moves.reload : issues.reload
  const allPicked = iRows.length > 0 && iRows.every((r) => picked.has(r.id))

  function toggle(id: number) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-xl">โอน-แจ้งเสีย</h1>
        <p className="text-sm text-ink-400">
          ประวัติการโอนเครื่องและการแจ้งเสียทั้งฮับ · ยกเลิกการโอนที่ยังไม่มีใครรับได้จากตรงนี้
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <DateRangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f)
            setTo(t)
          }}
        />
        {tab === 'issue' && (
          <button
            type="button"
            className={`chip ${onlyOpen ? 'chip-on' : ''}`}
            onClick={() => setOnlyOpen((v) => !v)}
          >
            เฉพาะที่ยังไม่ได้เคลียร์
          </button>
        )}
      </div>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className={`chip ${tab === 'transfer' ? 'chip-on' : ''}`}
          onClick={() => setTab('transfer')}
        >
          การโอน · {mRows.length}
          {waiting > 0 && <span className="ml-1 text-warn-txt">(รอรับ {waiting})</span>}
          {cancelled > 0 && <span className="ml-1 text-ink-400">(ยกเลิก {cancelled})</span>}
        </button>
        <button
          type="button"
          className={`chip ${tab === 'issue' ? 'chip-on' : ''}`}
          onClick={() => setTab('issue')}
        >
          แจ้งเสีย · {iRows.length}
          {openCount > 0 && <span className="ml-1 text-danger-txt">(ค้าง {openCount})</span>}
        </button>
        <button
          type="button"
          className={`chip ${tab === 'history' ? 'chip-on' : ''}`}
          onClick={() => setTab('history')}
        >
          ประวัติที่ลบแล้ว
        </button>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}

      {tab === 'transfer' && !moves.loading && mRows.length === 0 && (
        <EmptyState title="ไม่มีการโอนในช่วงนี้" hint="ลองขยายช่วงวันที่" />
      )}
      {tab === 'issue' && !issues.loading && iRows.length === 0 && (
        <EmptyState
          title="ไม่มีการแจ้งเสียในช่วงนี้"
          hint={onlyOpen ? 'ลองปิดตัวกรองหรือขยายช่วงวันที่' : 'ลองขยายช่วงวันที่'}
        />
      )}

      {tab === 'history' && (
        <TextHistory kind="issue" fromISO={range.fromISO} toISO={range.toISO} />
      )}

      {tab === 'transfer' && mRows.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-medium">เครื่อง</th>
                <th className="px-3 py-2 font-medium">จากใคร</th>
                <th className="px-3 py-2 font-medium">ไปใคร</th>
                <th className="px-3 py-2 font-medium">คนกดโอน</th>
                <th className="px-3 py-2 font-medium">เหตุผล</th>
                <th className="w-[150px] px-3 py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {mRows.map((r) => (
                <tr key={r.id} className="border-b border-line-2 last:border-0 align-top">
                  <td className="px-3 py-2">
                    <span className="font-mono">{r.asset_code}</span>
                    <span className="block text-xs text-ink-400">{r.type_name}</span>
                    <span className="block text-xs text-ink-400">
                      {fmtDateTime(r.created_at)} · {relativeAge(r.created_at)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {/* เครื่องว่างตอนโอนก็มี ไม่ได้แปลว่าข้อมูลหาย */}
                    {r.from_name ?? <span className="text-ink-400">เครื่องว่าง</span>}
                    {r.from_code && (
                      <span className="block font-mono text-xs text-ink-400">{r.from_code}</span>
                    )}
                    {r.from_dept && <span className="block text-xs text-ink-400">{r.from_dept}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.to_name ?? (
                      <span className="text-ink-500">
                        ทั้งแผนก {r.to_dept ?? '—'}
                      </span>
                    )}
                    {r.to_code && (
                      <span className="block font-mono text-xs text-ink-400">{r.to_code}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.by_name ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-600">{r.reason || '—'}</td>
                  <td className="px-3 py-2">
                    {r.state === 'claimed' ? (
                      <>
                        <span className="badge bg-success-bg text-success-txt">รับแล้ว</span>
                        <span className="block text-xs text-ink-400">
                          {r.claimed_by_name ?? ''} {r.claimed_at ? fmtDateTime(r.claimed_at) : ''}
                        </span>
                      </>
                    ) : r.state === 'cancelled' ? (
                      <>
                        <span className="badge-mute">ยกเลิกแล้ว</span>
                        <span className="block text-xs text-ink-600">{r.cancel_reason}</span>
                        <span className="block text-xs text-ink-400">
                          {r.cancelled_by_name ?? ''}{' '}
                          {r.cancelled_at ? fmtDateTime(r.cancelled_at) : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="badge bg-warn-bg text-warn-txt">รอปลายทางกดรับ</span>
                        {/* ค้างนานแปลว่าเครื่องลอยอยู่ ไม่มีใครถือรับผิดชอบ */}
                        <span className="block text-xs text-ink-400">
                          ค้าง {relativeAge(r.created_at)}
                        </span>
                        <button
                          type="button"
                          className="btn-soft mt-1 h-tap px-3 text-xs"
                          onClick={() => setKilling(r)}
                        >
                          ยกเลิกการโอน
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CancelTransferBox
        row={killing}
        onClose={() => setKilling(null)}
        onDone={() => moves.reload()}
      />

      {tab === 'issue' && iRows.length > 0 && (
        <>
        <BulkDeleteBar
          n={picked.size}
          noun="ใบ"
          confirmLabel={`ลบ ${picked.size} ใบ`}
          warning={
            <>
              ใบแจ้งเสียที่เลือกจะหายออกจากระบบถาวร กู้คืนไม่ได้
              <br />
              ถ้าใบไหนยังไม่ได้เคลียร์ แปลว่าอาการนั้นจะไม่มีใครตามต่อแล้ว
            </>
          }
          onClear={() => setPicked(new Set())}
          onDelete={async (why) => {
            await deleteAssetIssues([...picked], why)
            setPicked(new Set())
            issues.reload()
          }}
        />
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
                <th className="w-[44px] px-3 py-2">
                  <PickBox
                    on={allPicked}
                    label="เลือกทั้งหมด"
                    onToggle={() =>
                      setPicked(allPicked ? new Set() : new Set(iRows.map((r) => r.id)))
                    }
                  />
                </th>
                <th className="px-3 py-2 font-medium">เครื่อง</th>
                <th className="px-3 py-2 font-medium">อาการ</th>
                <th className="px-3 py-2 font-medium">คนแจ้ง</th>
                <th className="w-[190px] px-3 py-2 font-medium">สถานะ</th>
                <th className="w-[130px] px-3 py-2 font-medium">หลักฐาน</th>
              </tr>
            </thead>
            <tbody>
              {iRows.map((r) => (
                <Fragment key={r.id}>
                <tr className="border-b border-line-2 last:border-0 align-top">
                  <td className="px-3 py-2">
                    <PickBox
                      on={picked.has(r.id)}
                      label={`เลือกใบของ ${r.asset_code}`}
                      onToggle={() => toggle(r.id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono">{r.asset_code}</span>
                    <span className="block text-xs text-ink-400">{r.type_name}</span>
                    <span className="block text-xs text-ink-400">
                      {fmtDateTime(r.reported_at)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-700">{r.symptom}</td>
                  <td className="px-3 py-2">
                    {r.reported_by_name ?? '—'}
                    {r.reported_by_code && (
                      <span className="block font-mono text-xs text-ink-400">
                        {r.reported_by_code}
                      </span>
                    )}
                    {/* ว่าง = แจ้งจากหน้าทะเบียน ไม่ได้เกิดตอนเบิกหรือคืน */}
                    <span className="block text-xs text-ink-400">
                      {r.phase === 'out' ? 'แจ้งตอนเบิก' : r.phase === 'in' ? 'แจ้งตอนคืน' : 'แจ้งจากทะเบียน'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.is_open ? (
                      <>
                        <span className="badge bg-danger-bg text-danger-txt">ยังไม่เคลียร์</span>
                        <span className="block text-xs text-ink-400">
                          ค้าง {relativeAge(r.reported_at)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="badge bg-success-bg text-success-txt">เคลียร์แล้ว</span>
                        <span className="block text-xs text-ink-400">
                          {r.resolved_by_name ?? ''}{' '}
                          {r.resolved_at ? fmtDateTime(r.resolved_at) : ''}
                        </span>
                        {r.resolve_note && (
                          <span className="block text-xs text-ink-500">{r.resolve_note}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {shotsOf(r) > 0 ? (
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1 text-xs"
                        onClick={() => setOpenId(openId === r.id ? null : r.id)}
                      >
                        {openId === r.id ? 'ซ่อนรูป' : `ดูรูป ${shotsOf(r)} ใบ`}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-400">ไม่มีรูป</span>
                    )}
                    {r.is_open && (
                      <button
                        type="button"
                        className="btn-soft mt-1 w-full px-3 py-1 text-xs"
                        onClick={() => setFixId(r.id)}
                      >
                        ซ่อมแล้ว เคลียร์
                      </button>
                    )}
                  </td>
                </tr>
                {openId === r.id && (
                  <tr className="border-b border-line-2 bg-ink/5">
                    <td colSpan={6} className="px-3 py-3">
                      <IssueEvidence id={r.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <IssueFixSheet
        open={fixId !== null}
        title="ซ่อมเสร็จแล้ว"
        hint="ถ่ายรูปตอนซ่อมเสร็จ หรือเขียนว่าซ่อมอะไรไปก็ได้ ต้องมีอย่างน้อยหนึ่งอย่าง · เครื่องเดิมพังซ้ำเมื่อไหร่จะได้ไล่ได้ว่ารอบที่แล้วแก้อะไร"
        onClose={() => setFixId(null)}
        onSubmit={async (photos, note) => {
          await resolveAssetIssue(fixId!, photos, note ?? undefined)
          issues.reload()
        }}
      />
    </div>
  )
}

/** รูปของการแจ้งเสียใบนี้ · รูปตอนเบิกคืนไม่นับ เป็นคนละเรื่องกัน */
function shotsOf(r: { report_shots?: number; fix_shots?: number }) {
  return (r.report_shots ?? 0) + (r.fix_shots ?? 0)
}

/**
 * หลักฐานของใบแจ้งชำรุดใบหนึ่ง
 *
 * รวมรูปสามแหล่ง — รูปที่แนบตอนแจ้ง รูปตอนซ่อมเสร็จ และรูปตอนคืนของ
 * รูปตอนคืนมีอยู่ในระบบมานานแล้วแต่ไม่เคยถูกเอามาโชว์ที่นี่
 * เพราะมันผูกกับใบคืน ไม่ได้ผูกกับใบแจ้งชำรุด
 */
function IssueEvidence({ id }: { id: number }) {
  const shots = useAsync(() => assetIssueEvidence(id), [id])
  if (shots.loading) return <Loading label="กำลังโหลดรูป…" />
  if (shots.error) return <ErrorBox message={shots.error} onRetry={shots.reload} />
  const all = shots.data ?? []
  if (all.length === 0) return <p className="text-sm text-ink-400">ไม่มีรูป</p>

  const groups: [string, typeof all][] = [
    ['ตอนแจ้ง', all.filter((x) => x.phase === 'report')],
    ['ตอนซ่อมเสร็จ', all.filter((x) => x.phase === 'fix')],
  ]

  return (
    <div className="flex flex-wrap gap-6">
      {groups.map(([label, list]) =>
        list.length === 0 ? null : (
          <div key={label}>
            <p className="mb-1 text-xs font-semibold text-ink-500">
              {label} · {list.length} รูป
            </p>
            <div className="flex flex-wrap gap-1.5">
              {list.map((x) => (
                <a key={x.file_id} href={x.web_link ?? undefined} target="_blank" rel="noreferrer">
                  <EvidenceImg fileId={x.file_id} enabled className="h-28 w-20 rounded-btn" />
                  {x.source === 'txn' && (
                    <span className="mt-0.5 block text-center text-[10px] text-ink-400">
                      {x.label ?? 'รูปตอนคืน'}
                    </span>
                  )}
                </a>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  )
}
