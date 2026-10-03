import { useAsync } from '../lib/useAsync'
import { listHistoryNotes } from '../lib/api'
import { EmptyState, ErrorBox, Loading } from './ui'
import { fmtDateTime } from '../lib/format'
import type { HistoryNote } from '../lib/types'

/**
 * ประวัติแบบตัวหนังสือของสิ่งที่ถูกลบไปแล้ว
 *
 * ทำไมเก็บแค่ตัวหนังสือ
 *   รูปทุกใบขึ้นไปอยู่ในไดร์ฟตั้งแต่ตอนถ่ายแล้ว และไดร์ฟไม่ใช่ข้อจำกัดของเรา
 *   ส่วนฐานข้อมูลเป็นข้อจำกัด ถ้าเก็บรูปซ้ำไว้อีกชุดคือจ่ายสองรอบเพื่อของชิ้นเดียว
 *   แถวข้อความหนึ่งแถวหนักไม่ถึงหนึ่งกิโลไบต์ ส่วนรูปหนึ่งใบหนักเป็นแสนเท่า
 *   หน้านี้จึงเปิดแล้วขึ้นทันทีแม้ย้อนหลังทั้งปี เพราะไม่ต้องรอโหลดรูปสักใบ
 *   ลิงก์ไดร์ฟถูกเก็บไว้ในแถวด้วย วันไหนอยากเห็นรูปจริงก็กดตามไปดูทีละใบ
 */
const KIND_TH: Record<HistoryNote['kind'], string> = {
  issue: 'แจ้งเสีย',
  asset: 'เบิก-คืนเครื่อง',
  supply: 'เบิกวัสดุ',
}

export function TextHistory({
  kind,
  fromISO,
  toISO,
}: {
  kind?: HistoryNote['kind']
  fromISO?: string
  toISO?: string
}) {
  const notes = useAsync(
    () => listHistoryNotes({ kind, fromISO, toISO }),
    [kind, fromISO, toISO],
  )

  if (notes.loading && !notes.data) return <Loading label="กำลังโหลดประวัติ…" />
  if (notes.error) return <ErrorBox message={notes.error} onRetry={notes.reload} />

  const rows = notes.data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        title="ยังไม่มีประวัติที่ถูกลบในช่วงนี้"
        hint="ของที่ลบจากหน้านี้จะถูกย่อเป็นข้อความมาเก็บไว้ตรงนี้เอง"
      />
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-500">
        เก็บเฉพาะข้อความ ไม่ได้เก็บรูปซ้ำ · รูปยังอยู่ในไดร์ฟ กดลิงก์ตามไปดูได้
      </p>
      {rows.map((n) => (
        <article key={n.id} className="rounded-card border border-line bg-surface p-3">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="badge-mute">{KIND_TH[n.kind]}</span>
            {n.ref_no && <span className="font-mono text-ink-500">{n.ref_no}</span>}
            <span className="text-ink-500">
              {n.happened_at ? fmtDateTime(n.happened_at) : '—'}
            </span>
            {n.who && <span className="text-ink-500">· {n.who}</span>}
            <span className="ml-auto text-ink-400">
              ลบเมื่อ {fmtDateTime(n.archived_at)}
              {n.archived_by_name ? ` โดย ${n.archived_by_name}` : ''}
            </span>
          </div>

          <p className="whitespace-pre-wrap text-sm text-ink-700">{n.body}</p>

          {n.reason && (
            <p className="mt-1 text-xs text-warn-txt">เหตุผลที่ลบ: {n.reason}</p>
          )}

          {n.photos > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-500">
                รูปในไดร์ฟ {n.photos} ใบ
              </summary>
              <div className="mt-1 space-y-0.5">
                {(n.links ?? '')
                  .split('\n')
                  .filter(Boolean)
                  .map((href) => (
                    <a
                      key={href}
                      href={href.startsWith('http') ? href : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-ink-500 underline"
                    >
                      {href}
                    </a>
                  ))}
              </div>
            </details>
          )}
        </article>
      ))}
    </div>
  )
}
