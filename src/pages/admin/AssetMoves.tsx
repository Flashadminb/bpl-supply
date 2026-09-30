import { useMemo, useState } from 'react'
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
  const [tab, setTab] = useState<Tab>('transfer')
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
              </tr>
            </thead>
            <tbody>
              {iRows.map((r) => (
                <tr key={r.id} className="border-b border-line-2 last:border-0 align-top">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
