import type { SyncChannel, SyncRow, SyncState } from '../lib/types'
import { fmtTime } from '../lib/format'

export const CHANNELS: SyncChannel[] = ['IMG', 'GDV', 'SPB', 'TMP', 'GSH']

export type SyncMap = Partial<Record<SyncChannel, SyncState>>

const MARK: Record<SyncState, string> = {
  done: '✓',
  running: '…',
  pending: '—',
  failed: '!',
}

const CLS: Record<SyncState, string> = {
  done: 'sync-chip--done',
  running: 'sync-chip--running',
  pending: 'sync-chip--idle',
  failed: 'sync-chip--failed',
}

/**
 * แถบรหัสสถานะย่อบนหน้าพนักงาน
 * ห้ามมีลิงก์เปิดรูปหลักฐานตรงนี้เด็ดขาด — พนักงานแคปหน้าจอส่งให้แอดมินอ่านอย่างเดียว
 */
export function SyncBar({
  states,
  refNo,
  at,
  className = '',
}: {
  states: SyncMap
  refNo?: string
  at?: string | null
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {CHANNELS.map((ch) => {
        const st = states[ch] ?? 'pending'
        return (
          <span key={ch} className={`sync-chip ${CLS[st]}`} title={`${ch} · ${st}`}>
            {ch} {MARK[st]}
          </span>
        )
      })}
      {(refNo || at) && (
        <span className="ml-1 font-mono text-[10px] text-ink-400">
          {refNo}
          {refNo && at ? ' · ' : ''}
          {at ? fmtTime(at) : ''}
        </span>
      )}
    </div>
  )
}

/** แปลงแถว sync_log จากฐานข้อมูลเป็นแผนที่ช่อง -> สถานะ */
export function syncMapFromRows(rows: SyncRow[] | undefined | null): SyncMap {
  const map: SyncMap = {}
  for (const r of rows ?? []) map[r.channel] = r.state
  // IMG กับ TMP เกิดในเครื่องล้วน ๆ ถ้าคำขอถูกบันทึกแล้วแปลว่าสองขั้นนี้ผ่านไปแล้ว
  if (map.SPB === 'done') {
    map.IMG = map.IMG ?? 'done'
    map.TMP = map.TMP ?? 'done'
  }
  return map
}
