import { useEffect, useMemo, useState } from 'react'
import { readableError } from '../../lib/supabase'
import {
  importWaitTrucks,
  parseWaitTruckFile,
  undoWaitImport,
  type ImportResult,
  type ParsedFile,
  type ParsedTruck,
  type WaitTruckKpi,
} from '../../lib/waitTrucks'
import { Modal, Spinner } from '../../components/ui'
import { nf } from './parts'

/**
 * กล่องอัปไฟล์ · เป็นป็อปอัพบนกระดาน ไม่ใช่หน้าแยก
 *
 * เดิมเป็นหน้าของตัวเอง ซึ่งแปลว่าหน้างานต้องออกจากกระดาน อัป แล้วเดินกลับมา
 * ทั้งที่สิ่งที่เขาทำคือโยนไฟล์ใส่แล้วกดตกลง ซึ่งเป็นงานสิบวินาที
 * การเปลี่ยนหน้าไปกลับสำหรับงานสิบวินาที คือการทำให้งานสิบวินาทีรู้สึกเหมือนงานใหญ่
 *
 * เลือกไฟล์แล้วแกะทันที ไม่ต้องกดอะไรเพิ่ม · ป็อปอัพค่อยถามตกลงหรือยกเลิกทีหลัง
 * เพราะการแกะไฟล์ไม่ได้เปลี่ยนอะไรในฐานข้อมูล ยกเลิกตอนนั้นก็ไม่เหลือร่องรอย
 */

type Stage =
  | { k: 'reading'; name: string }
  | { k: 'ready'; name: string; file: ParsedFile }
  | { k: 'sending' }
  | { k: 'done'; res: ImportResult }

export function UploadBox({
  file,
  kpi,
  onBoard,
  onClose,
  onImported,
}: {
  /** ไฟล์ที่เพิ่งเลือก · กล่องนี้เปิดพร้อมไฟล์เสมอ ไม่มีสถานะว่างให้ค้าง */
  file: File
  kpi: WaitTruckKpi[]
  /** บาร์โค้ดที่ยังรออยู่บนกระดาน · ใช้บอกล่วงหน้าว่าแถวไหนจะถูกข้าม */
  onBoard: Set<string>
  onClose: () => void
  onImported: () => void
}) {
  const [stage, setStage] = useState<Stage>({ k: 'reading', name: file.name })
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState<number | null>(null)

  const types = useMemo(
    () => kpi.filter((k) => k.is_active).map((k) => k.vehicle_type),
    [kpi],
  )

  // แกะทันทีที่กล่องเปิด ไม่ต้องให้กดอะไรเพิ่ม · ครั้งเดียวต่อไฟล์
  useEffect(() => {
    let alive = true
    void parseWaitTruckFile(file)
      .then((f) => {
        if (alive) setStage({ k: 'ready', name: file.name, file: f })
      })
      .catch((e) => {
        if (!alive) return
        setErr(readableError(e))
        setStage({ k: 'ready', name: file.name, file: { sheet: '', rows: [], bad: [] } })
      })
    return () => {
      alive = false
    }
  }, [file])

  const rows: ParsedTruck[] =
    stage.k === 'ready'
      ? stage.file.rows.map((r) => ({
          ...r,
          vehicle_type: r.vehicle_type ?? picked[r.line] ?? null,
        }))
      : []

  const unknown = rows.filter((r) => !r.vehicle_type)
  const fresh = rows.filter((r) => r.vehicle_type && !onBoard.has(r.barcode))
  const already = rows.filter((r) => r.vehicle_type && onBoard.has(r.barcode))
  const canSend = stage.k === 'ready' && unknown.length === 0 && rows.length > 0

  async function send() {
    if (stage.k !== 'ready') return
    setErr(null)
    setStage({ k: 'sending' })
    try {
      const res = await importWaitTrucks(rows)
      setStage({ k: 'done', res })
      onImported()
    } catch (e) {
      setErr(readableError(e))
      setStage({ k: 'ready', name: stage.name, file: stage.file })
    }
  }

  async function undo(batch: string) {
    setUndoing(true)
    setErr(null)
    try {
      setUndone(await undoWaitImport(batch))
      onImported()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setUndoing(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={stage.k === 'done' ? 'อัปไฟล์เรียบร้อย' : 'ตรวจก่อนขึ้นกระดาน'}>
      {err && (
        <p className="mb-3 rounded-xl bg-danger-bg p-3 text-sm font-bold text-danger">{err}</p>
      )}

      {stage.k === 'reading' && (
        <div className="flex min-h-[160px] flex-col items-center justify-center">
          <Spinner />
          <p className="mt-3 text-sm font-bold">กำลังอ่าน {stage.name}</p>
          <p className="mt-1 text-xs text-ink-400">ไฟล์ถูกอ่านในเครื่องนี้ ไม่ได้ถูกส่งไปไหน</p>
        </div>
      )}

      {stage.k === 'sending' && (
        <div className="flex min-h-[160px] flex-col items-center justify-center">
          <Spinner />
          <p className="mt-3 text-sm font-bold">กำลังส่งขึ้นกระดาน…</p>
        </div>
      )}

      {stage.k === 'ready' && (
        <>
          <p className="mb-1 truncate text-sm font-bold">{stage.name}</p>
          {stage.file.sheet && (
            <p className="mb-3 text-xs text-ink-400">แผ่นงาน {stage.file.sheet}</p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Count n={fresh.length} label="คันใหม่" color="#167C45" />
            <Count n={already.length} label="รออยู่แล้ว" color="#1F5FA8" hint="ข้าม ไม่รีเซ็ตนาฬิกา" />
            <Count n={unknown.length} label="ต้องเลือกประเภท" color="#8A6A00" />
            <Count n={stage.file.bad.length} label="อ่านไม่ได้" color="#6B7280" />
          </div>

          {unknown.length > 0 && (
            <div className="mt-3 rounded-xl border border-warn/40 bg-warn-bg p-3">
              <p className="text-sm font-extrabold text-warn-txt">
                แกะประเภทรถจากชื่อเส้นทางไม่ออก {unknown.length} คัน
              </p>
              <p className="mb-2 text-xs text-ink-500">
                เกณฑ์เวลามาจากประเภทรถ จึงไม่เดาให้ · เลือกเองให้ครบก่อนส่ง
              </p>
              {types.length > 0 && (
                <button
                  onClick={() =>
                    setPicked((p) => {
                      const next = { ...p }
                      for (const r of unknown) next[r.line] = types[0]
                      return next
                    })
                  }
                  className="mb-2 h-10 rounded-lg bg-ink px-3 text-xs font-bold text-white"
                >
                  ตั้งทั้งหมดเป็น {types[0]}
                </button>
              )}
              <div className="max-h-[30vh] space-y-2 overflow-y-auto">
                {unknown.map((r) => (
                  <div key={r.line} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{r.barcode}</p>
                      <p className="truncate text-xs text-ink-500">
                        {r.route_name ?? 'ไม่มีชื่อเส้นทาง'}
                      </p>
                    </div>
                    <select
                      value={picked[r.line] ?? ''}
                      onChange={(e) => setPicked((p) => ({ ...p, [r.line]: e.target.value }))}
                      className="h-tap shrink-0 rounded-lg border px-2 text-sm font-bold"
                    >
                      <option value="">เลือก…</option>
                      {types.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stage.file.bad.length > 0 && (
            <details className="mt-3 rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-bold">
                แถวที่อ่านไม่ได้ {stage.file.bad.length} แถว
              </summary>
              <ul className="mt-2 space-y-1">
                {stage.file.bad.slice(0, 50).map((b) => (
                  <li key={b.line} className="text-xs text-ink-500">
                    บรรทัด {b.line} · {b.why}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {rows.length > 0 && (
            <details className="mt-3 rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-bold">
                ดูรายการทั้ง {rows.length} คัน
              </summary>
              <div className="mt-2 max-h-[30vh] overflow-y-auto">
                {rows.map((r) => (
                  <div
                    key={r.line}
                    className="flex items-center gap-2 border-b py-1 last:border-b-0"
                    style={{ opacity: onBoard.has(r.barcode) ? 0.45 : 1 }}
                  >
                    <span className="w-[48px] shrink-0 rounded bg-canvas px-1 text-center text-xs font-extrabold">
                      {r.vehicle_type ?? '???'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {r.from_station ?? 'ไม่ระบุสถานี'} · {nf(r.parcels_total ?? r.parcels)} ชิ้น ·
                      DO {nf(r.parcels_do)}
                    </span>
                    <span className="shrink-0 text-xs font-bold">{r.arrived_text}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={onClose}
              className="h-12 rounded-xl border text-sm font-bold"
            >
              ยกเลิก
            </button>
            <button
              disabled={!canSend}
              onClick={() => void send()}
              className="h-12 rounded-xl text-sm font-extrabold text-white disabled:opacity-40"
              style={{ background: '#25A35A' }}
            >
              {unknown.length > 0 ? `ขาดอีก ${unknown.length} คัน` : `ตกลง · ขึ้น ${fresh.length} คัน`}
            </button>
          </div>
        </>
      )}

      {stage.k === 'done' && (
        <>
          <p className="text-lg font-extrabold text-success">
            ขึ้นกระดานแล้ว {nf(stage.res.added)} คัน
          </p>
          <p className="mt-1 text-sm text-ink-500">
            ข้ามคันที่รออยู่แล้ว {nf(stage.res.skipped)} คัน
            {stage.res.rejected_n > 0 && ` · ฐานข้อมูลตีกลับ ${nf(stage.res.rejected_n)} คัน`}
          </p>

          {stage.res.rejected_n > 0 && (
            <ul className="mt-2 space-y-1">
              {stage.res.rejected.map((r, i) => (
                <li key={i} className="text-xs text-danger">
                  {r.barcode} · {r.why}
                </li>
              ))}
            </ul>
          )}

          {undone != null ? (
            <p className="mt-4 text-sm font-bold text-warn-txt">
              ถอนออกแล้ว {nf(undone)} คัน
              {undone < stage.res.added && ' · ที่เหลือมีคนกดลงงานหรือยกเลิกไปแล้ว จึงไม่ถอน'}
            </p>
          ) : (
            stage.res.added > 0 && (
              <button
                disabled={undoing}
                onClick={() => void undo(stage.res.batch)}
                className="mt-4 h-11 w-full rounded-xl border text-sm font-bold text-danger disabled:opacity-50"
              >
                {undoing ? 'กำลังถอน…' : 'อัปผิดไฟล์ · ถอนออก'}
              </button>
            )
          )}

          <button
            onClick={onClose}
            className="mt-2 h-12 w-full rounded-xl bg-ink text-sm font-extrabold text-white"
          >
            ปิด
          </button>
        </>
      )}
    </Modal>
  )
}

function Count({ n, label, color, hint }: { n: number; label: string; color: string; hint?: string }) {
  return (
    <div className="rounded-xl border p-2">
      <div className="text-2xl font-extrabold leading-none" style={{ color }}>{n}</div>
      <div className="mt-1 text-xs font-bold">{label}</div>
      {hint && <div className="text-[10px] text-ink-400">{hint}</div>}
    </div>
  )
}
