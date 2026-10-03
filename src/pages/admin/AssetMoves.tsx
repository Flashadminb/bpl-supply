import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { assetIssueEvidence, resolveAssetIssue } from '../../lib/api'
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { IssueFixSheet } from '../../components/IssueFixSheet'
import { listAssetIssueRows, listAssetTransferRows } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { DateRangePicker } from '../../components/DateRangePicker'
import { EmptyState, ErrorBox, Loading } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'

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
 */

type Tab = 'transfer' | 'issue'

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

  const loading = tab === 'transfer' ? moves.loading : issues.loading
  const error = tab === 'transfer' ? moves.error : issues.error
  const reload = tab === 'transfer' ? moves.reload : issues.reload

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-xl">โอน-แจ้งเสีย</h1>
        <p className="text-sm text-ink-400">
          ประวัติการโอนเครื่องและการแจ้งเสียทั้งฮับ · ดูอย่างเดียว ไม่เปลี่ยนสถานะอะไร
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
        </button>
        <button
          type="button"
          className={`chip ${tab === 'issue' ? 'chip-on' : ''}`}
          onClick={() => setTab('issue')}
        >
          แจ้งเสีย · {iRows.length}
          {openCount > 0 && <span className="ml-1 text-danger-txt">(ค้าง {openCount})</span>}
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
                    ) : (
                      <>
                        <span className="badge bg-warn-bg text-warn-txt">รอปลายทางกดรับ</span>
                        {/* ค้างนานแปลว่าเครื่องลอยอยู่ ไม่มีใครถือรับผิดชอบ */}
                        <span className="block text-xs text-ink-400">
                          ค้าง {relativeAge(r.created_at)}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'issue' && iRows.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-ink-500">
              <tr className="border-b border-line">
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
                    <td colSpan={5} className="px-3 py-3">
                      <IssueEvidence id={r.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <IssueFixSheet
        open={fixId !== null}
        title="ซ่อมเสร็จแล้ว"
        hint="แนบรูปตอนซ่อมเสร็จไว้เทียบกับรูปตอนแจ้ง ถ้าเครื่องเดิมพังซ้ำจะไล่ได้ว่ารอบที่แล้วแก้อะไรไป"
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
