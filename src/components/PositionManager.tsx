import { useState } from 'react'
import { createPosition, renamePosition, setPositionActive } from '../lib/api'
import { readableError } from '../lib/supabase'
import { ErrorBox, Modal, Spinner } from './ui'
import type { Position } from '../lib/types'

/**
 * จัดการตำแหน่งงาน — เพิ่ม เปลี่ยนชื่อ ปิดใช้งาน
 *
 * ตำแหน่งคือชื่อที่องค์กรเรียก ไม่ใช่สิทธิ์ในระบบ
 * สองอย่างนี้ต้องแยกกันตลอดไป เพราะวันที่เลื่อนใครเป็นหัวหน้ากะ
 * แต่ยังไม่อยากให้เขาแก้สต็อกได้ ต้องทำได้โดยไม่ต้องรื้ออะไร
 *
 * ไม่มีปุ่มลบ · ปิดใช้งานแทน
 * ตำแหน่งที่มีคนถืออยู่ลบไม่ได้อยู่แล้วเพราะฐานข้อมูลกันไว้ ซึ่งถูก
 * ของที่เลิกใช้แต่ยังมีคนผูกอยู่ ต้องอ่านชื่อออกได้ตลอดไป
 * ไม่งั้นประวัติเก่าจะกลายเป็นรหัสที่ไม่มีใครแปลได้
 */
export function PositionManager({
  open,
  onClose,
  positions,
  onChanged,
  canEdit,
}: {
  open: boolean
  onClose: () => void
  positions: Position[]
  onChanged: () => void
  canEdit: boolean
}) {
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function run(job: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    void job()
      .then(() => onChanged())
      .catch((e) => setErr(readableError(e)))
      .finally(() => setBusy(false))
  }

  return (
    <Modal open={open} onClose={onClose} title="ตำแหน่งงาน">
      <p className="mb-3 text-sm text-ink-500">
        ชื่อที่องค์กรเรียก เช่น หัวหน้ากะ · ซุปเปอร์ไวเซอร์ · ธุรการ
        <br />
        <b>คนละเรื่องกับบทบาท</b> ซึ่งเป็นสิทธิ์ว่าแอพยอมให้กดอะไรได้บ้าง
        <br />
        เปลี่ยนชื่อทีหลังได้ตลอด ของที่ผูกไว้ไม่ขาด เพราะระบบอ้างด้วยรหัสที่ซ่อนอยู่
      </p>

      {err && (
        <div className="mb-2">
          <ErrorBox message={err} />
        </div>
      )}

      {canEdit && (
        <div className="mb-3 flex gap-2">
          <input
            className="input flex-1"
            placeholder="พิมพ์ชื่อตำแหน่งใหม่"
            value={adding}
            disabled={busy}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && adding.trim()) {
                run(() => createPosition(adding))
                setAdding('')
              }
            }}
          />
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy || adding.trim() === ''}
            onClick={() => {
              run(() => createPosition(adding))
              setAdding('')
            }}
          >
            {busy ? <Spinner /> : null} เพิ่ม
          </button>
        </div>
      )}

      {positions.length === 0 ? (
        <p className="rounded-card bg-surface-2 px-3 py-3 text-sm text-ink-500">
          ยังไม่มีตำแหน่งสักอัน · พิมพ์ชื่อในช่องข้างบนแล้วกดเพิ่มได้เลย
        </p>
      ) : (
        <ul className="space-y-2">
          {positions.map((p) => (
            <Row key={p.code} p={p} busy={busy} canEdit={canEdit} run={run} />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function Row({
  p,
  busy,
  canEdit,
  run,
}: {
  p: Position
  busy: boolean
  canEdit: boolean
  run: (job: () => Promise<unknown>) => void
}) {
  const [name, setName] = useState(p.name)
  const changed = name.trim() !== '' && name.trim() !== p.name

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-btn border border-line p-2">
      <input
        className="input min-w-0 flex-1"
        value={name}
        disabled={!canEdit || busy}
        onChange={(e) => setName(e.target.value)}
        aria-label={`ชื่อตำแหน่ง ${p.name}`}
      />
      {changed && (
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={busy}
          onClick={() => run(() => renamePosition(p.code, name))}
        >
          บันทึกชื่อ
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          className={p.is_active ? 'btn-soft text-sm' : 'btn-primary text-sm'}
          disabled={busy}
          onClick={() => run(() => setPositionActive(p.code, !p.is_active))}
        >
          {p.is_active ? 'ปิดใช้งาน' : 'เปิดใช้'}
        </button>
      )}
      {!p.is_active && <span className="badge bg-surface-2 text-ink-500">ปิดอยู่</span>}
    </li>
  )
}
