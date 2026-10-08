import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../../lib/useAsync'
import { readableError } from '../../lib/supabase'
import {
  importWaitTrucks,
  listWaitBoard,
  listWaitTruckKpi,
  parseWaitTruckFile,
  undoWaitImport,
  type ImportResult,
  type ParsedFile,
  type ParsedTruck,
} from '../../lib/waitTrucks'
import { BG, CARD, DIM, INSET, LINE, nf } from './parts'
import { Spinner } from '../../components/ui'

/**
 * อัปไฟล์รายงานรถรอลงงาน
 *
 * หน้างานโหลดไฟล์นี้จากระบบบริษัททุกชั่วโมงอยู่แล้วเพื่อรายงานหัวหน้า
 * หน้านี้จึงไม่ได้เพิ่มงานใหม่ แค่เปลี่ยนปลายทางจากแปะลง Excel มาเป็นโยนใส่ตรงนี้
 *
 * สามอย่างที่ตั้งใจให้เป็นแบบนี้
 *
 * ① ไฟล์ถูกแกะในเครื่อง ไม่ได้อัปขึ้นที่ไหนเลย · ที่ส่งไปคือแถวที่อ่านได้เท่านั้น
 *    เจ้าของระบบสั่งว่าไฟล์อัปแล้วทิ้งได้ ไม่ต้องสำรอง จึงไม่มีที่เก็บไฟล์ในระบบ
 *
 * ② อัปไฟล์เดิมซ้ำได้ไม่จำกัด คันที่ยังรออยู่จะถูกข้าม ไม่ใช่เขียนทับ
 *    ถ้าเขียนทับคือรีเซ็ตนาฬิกาทุกชั่วโมง แล้วจะไม่มีคันไหนเกินเวลาเลยสักคัน
 *
 * ③ ประเภทรถที่แกะไม่ออก ไม่เดาให้ · ให้คนเลือกก่อนถึงจะส่งได้
 *    เพราะเกณฑ์เวลามาจากประเภทรถ เดาผิดคือตัดสินทัน-ไม่ทันผิดทั้งคัน
 */

type Stage =
  | { k: 'idle' }
  | { k: 'reading'; name: string }
  | { k: 'ready'; name: string; file: ParsedFile }
  | { k: 'sending' }
  | { k: 'done'; res: ImportResult }

export default function WaitUpload() {
  const nav = useNavigate()
  const kpi = useAsync(listWaitTruckKpi, [])
  const board = useAsync(listWaitBoard, [])

  const [stage, setStage] = useState<Stage>({ k: 'idle' })
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  /** ประเภทที่คนเลือกเองให้แถวที่แกะไม่ออก · คีย์คือเลขบรรทัดในไฟล์ */
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const types = useMemo(
    () => (kpi.data ?? []).filter((k) => k.is_active).map((k) => k.vehicle_type),
    [kpi.data],
  )

  /** บาร์โค้ดที่ยังรออยู่บนกระดาน · ใช้บอกล่วงหน้าว่าแถวไหนจะถูกข้าม */
  const onBoard = useMemo(
    () => new Set((board.data ?? []).map((r) => r.truck_barcode)),
    [board.data],
  )

  const take = useCallback(async (f: File) => {
    setErr(null)
    setPicked({})
    setUndone(null)
    setStage({ k: 'reading', name: f.name })
    try {
      const file = await parseWaitTruckFile(f)
      setStage({ k: 'ready', name: f.name, file })
    } catch (e) {
      setErr(readableError(e))
      setStage({ k: 'idle' })
    }
  }, [])

  // แถวพร้อมประเภทที่คนเลือกทับแล้ว
  const rows: ParsedTruck[] = useMemo(() => {
    if (stage.k !== 'ready') return []
    return stage.file.rows.map((r) => ({ ...r, vehicle_type: r.vehicle_type ?? picked[r.line] ?? null }))
  }, [stage, picked])

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
      board.reload()
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
      board.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="min-h-dvh px-4 pb-28 pt-4 text-white" style={{ background: BG }}>
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-4 flex items-center gap-3">
          <button
            onClick={() => nav('/wait')}
            className="h-11 shrink-0 rounded-xl px-4 text-sm font-bold"
            style={{ background: CARD, border: `1px solid ${LINE}` }}
          >
            ← กระดาน
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold">อัปไฟล์รถรอลงงาน</h1>
            <p className="text-[12px]" style={{ color: DIM }}>
              ไฟล์ถูกอ่านในเครื่องนี้ ไม่ได้ถูกเก็บไว้ที่ไหน
            </p>
          </div>
        </header>

        {err && (
          <div
            className="mb-3 rounded-xl p-3 text-sm font-bold"
            style={{ background: '#3A1416', border: '1px solid #E5484D', color: '#FFD9DA' }}
          >
            {err}
          </div>
        )}

        {/* ---------------------------------------------------------- ช่องโยนไฟล์ */}
        {(stage.k === 'idle' || stage.k === 'reading') && (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) void take(f)
            }}
            onClick={() => input.current?.click()}
            className="flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl p-6 text-center"
            style={{
              background: over ? '#141C28' : CARD,
              border: `2px dashed ${over ? '#2F7FE0' : LINE}`,
            }}
          >
            {stage.k === 'reading' ? (
              <>
                <Spinner />
                <p className="mt-3 text-sm font-bold">กำลังอ่าน {stage.name}</p>
              </>
            ) : (
              <>
                <p className="text-lg font-extrabold">ลากไฟล์มาวางตรงนี้</p>
                <p className="mt-1 text-sm" style={{ color: DIM }}>
                  หรือแตะเพื่อเลือกไฟล์ · รับไฟล์ .xlsx ที่โหลดจากระบบบริษัท
                </p>
              </>
            )}
            <input
              ref={input}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void take(f)
              }}
            />
          </div>
        )}

        {/* ------------------------------------------------------------- ตรวจก่อนส่ง */}
        {stage.k === 'ready' && (
          <>
            <div className="mb-3 rounded-2xl p-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-bold">{stage.name}</p>
                <button
                  onClick={() => setStage({ k: 'idle' })}
                  className="h-9 shrink-0 rounded-lg px-3 text-[12px] font-bold"
                  style={{ background: INSET, border: `1px solid ${LINE}`, color: DIM }}
                >
                  เลือกไฟล์อื่น
                </button>
              </div>
              <p className="mt-1 text-[12px]" style={{ color: DIM }}>
                แผ่นงาน {stage.file.sheet}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Count n={fresh.length} label="คันใหม่" color="#25A35A" />
                <Count n={already.length} label="รออยู่แล้ว" color="#2F7FE0" hint="ข้าม ไม่รีเซ็ตนาฬิกา" />
                <Count n={unknown.length} label="ต้องเลือกประเภท" color="#E8B931" />
                <Count n={stage.file.bad.length} label="แถวที่อ่านไม่ได้" color="#55616F" />
              </div>
            </div>

            {/* ประเภทรถที่แกะไม่ออก · ต้องเลือกให้ครบก่อนถึงจะส่งได้ */}
            {unknown.length > 0 && (
              <div
                className="mb-3 rounded-2xl p-3"
                style={{ background: '#2A2206', border: '1px solid #E8B931' }}
              >
                <p className="text-sm font-extrabold" style={{ color: '#FFE8A3' }}>
                  แกะประเภทรถจากชื่อเส้นทางไม่ออก {unknown.length} คัน
                </p>
                <p className="mb-2 text-[12px]" style={{ color: '#D9C78A' }}>
                  เกณฑ์เวลามาจากประเภทรถ จึงไม่เดาให้ · เลือกเองให้ครบก่อนส่ง
                </p>
                {types.length > 1 && (
                  <button
                    onClick={() =>
                      setPicked((p) => {
                        const next = { ...p }
                        for (const r of unknown) next[r.line] = types[0]
                        return next
                      })
                    }
                    className="mb-2 h-9 rounded-lg px-3 text-[12px] font-bold"
                    style={{ background: '#E8B931', color: '#1A1405' }}
                  >
                    ตั้งทั้งหมดเป็น {types[0]}
                  </button>
                )}
                <div className="space-y-2">
                  {unknown.map((r) => (
                    <div key={r.line} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold">{r.barcode}</p>
                        <p className="truncate text-[11px]" style={{ color: '#D9C78A' }}>
                          {r.route_name ?? 'ไม่มีชื่อเส้นทาง'}
                        </p>
                      </div>
                      <select
                        value={picked[r.line] ?? ''}
                        onChange={(e) => setPicked((p) => ({ ...p, [r.line]: e.target.value }))}
                        className="h-11 shrink-0 rounded-lg px-2 text-sm font-bold"
                        style={{ background: INSET, border: `1px solid ${LINE}`, color: '#EAF0F7' }}
                      >
                        <option value="">เลือก…</option>
                        {types.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* แถวที่อ่านไม่ได้ · ไม่ทิ้งเงียบ บอกว่าหายไปกี่แถวและเพราะอะไร */}
            {stage.file.bad.length > 0 && (
              <details className="mb-3 rounded-2xl p-3" style={{ background: CARD, border: `1px solid ${LINE}` }}>
                <summary className="cursor-pointer text-sm font-bold">
                  แถวที่อ่านไม่ได้ {stage.file.bad.length} แถว
                </summary>
                <ul className="mt-2 space-y-1">
                  {stage.file.bad.slice(0, 50).map((b) => (
                    <li key={b.line} className="text-[12px]" style={{ color: DIM }}>
                      บรรทัด {b.line} · {b.why}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <Preview rows={rows} onBoard={onBoard} />

            <button
              disabled={!canSend}
              onClick={() => void send()}
              className="mt-3 h-14 w-full rounded-2xl text-base font-extrabold disabled:opacity-40"
              style={{ background: canSend ? '#25A35A' : '#1C2430', color: '#fff' }}
            >
              {unknown.length > 0
                ? `เลือกประเภทรถให้ครบอีก ${unknown.length} คัน`
                : `ส่งขึ้นกระดาน · คันใหม่ ${fresh.length} คัน`}
            </button>
          </>
        )}

        {stage.k === 'sending' && (
          <div className="flex min-h-[220px] flex-col items-center justify-center">
            <Spinner />
            <p className="mt-3 text-sm font-bold">กำลังส่งขึ้นกระดาน…</p>
          </div>
        )}

        {/* ------------------------------------------------------------------ ผลลัพธ์ */}
        {stage.k === 'done' && (
          <div className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${LINE}` }}>
            <p className="text-lg font-extrabold" style={{ color: '#35D98A' }}>
              ขึ้นกระดานแล้ว {nf(stage.res.added)} คัน
            </p>
            <p className="mt-1 text-sm" style={{ color: DIM }}>
              ข้ามคันที่รออยู่แล้ว {nf(stage.res.skipped)} คัน
              {stage.res.rejected_n > 0 && ` · ฐานข้อมูลตีกลับ ${nf(stage.res.rejected_n)} คัน`}
            </p>

            {stage.res.rejected_n > 0 && (
              <ul className="mt-2 space-y-1">
                {stage.res.rejected.map((r, i) => (
                  <li key={i} className="text-[12px]" style={{ color: '#FFB4B6' }}>
                    {r.barcode} · {r.why}
                  </li>
                ))}
              </ul>
            )}

            {undone != null ? (
              <p className="mt-4 text-sm font-bold" style={{ color: '#E8B931' }}>
                ถอนออกแล้ว {nf(undone)} คัน
                {undone < stage.res.added && ' · ที่เหลือมีคนกดลงงานหรือยกเลิกไปแล้ว จึงไม่ถอน'}
              </p>
            ) : (
              stage.res.added > 0 && (
                <button
                  disabled={undoing}
                  onClick={() => void undo(stage.res.batch)}
                  className="mt-4 h-12 w-full rounded-xl text-sm font-extrabold disabled:opacity-50"
                  style={{ background: INSET, border: `1px solid ${LINE}`, color: '#FFB4B6' }}
                >
                  {undoing ? 'กำลังถอน…' : 'อัปผิดไฟล์ · ถอนออก'}
                </button>
              )
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setStage({ k: 'idle' })
                  setUndone(null)
                }}
                className="h-12 rounded-xl text-sm font-bold"
                style={{ background: INSET, border: `1px solid ${LINE}` }}
              >
                อัปไฟล์อีก
              </button>
              <button
                onClick={() => nav('/wait')}
                className="h-12 rounded-xl text-sm font-extrabold"
                style={{ background: '#2F7FE0', color: '#fff' }}
              >
                ไปที่กระดาน
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Count({
  n,
  label,
  color,
  hint,
}: {
  n: number
  label: string
  color: string
  hint?: string
}) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: INSET, border: `1px solid ${LINE}` }}>
      <div className="font-extrabold leading-none" style={{ fontSize: 24, color }}>
        {n}
      </div>
      <div className="mt-1 text-[11px] font-bold" style={{ color: '#EAF0F7' }}>
        {label}
      </div>
      {hint && (
        <div className="text-[10px]" style={{ color: DIM }}>
          {hint}
        </div>
      )}
    </div>
  )
}

/**
 * ตัวอย่างแถวที่จะส่ง
 *
 * โชว์ทุกแถว ไม่ตัดท้าย เพราะไฟล์มีไม่กี่สิบแถว
 * และคนที่กำลังจะกดส่งควรเห็นได้ครบว่ากำลังส่งอะไรเข้าไป
 */
function Preview({ rows, onBoard }: { rows: ParsedTruck[]; onBoard: Set<string> }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl p-4 text-center text-sm" style={{ background: CARD, color: DIM }}>
        ไฟล์นี้ไม่มีแถวที่อ่านได้เลย
      </p>
    )
  }
  return (
    <div className="overflow-hidden rounded-2xl" style={{ background: CARD, border: `1px solid ${LINE}` }}>
      {rows.map((r) => {
        const dup = onBoard.has(r.barcode)
        return (
          <div
            key={r.line}
            className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
            style={{ borderColor: LINE, opacity: dup ? 0.45 : 1 }}
          >
            <span
              className="w-[52px] shrink-0 rounded-md px-1 py-[2px] text-center text-[11px] font-extrabold"
              style={{
                background: r.vehicle_type ? '#1C2430' : '#E8B931',
                color: r.vehicle_type ? '#9FB4CC' : '#1A1405',
              }}
            >
              {r.vehicle_type ?? '???'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold">{r.from_station ?? 'ไม่ระบุสถานี'}</p>
              <p className="truncate text-[11px]" style={{ color: DIM }}>
                {r.barcode} · ทะเบียน {r.plate ?? '—'} · {nf(r.parcels)} ชิ้น
              </p>
            </div>
            <span className="shrink-0 text-right">
              <span className="block text-[13px] font-extrabold">{r.arrived_text}</span>
              {dup && (
                <span className="text-[10px] font-bold" style={{ color: '#2F7FE0' }}>
                  รออยู่แล้ว
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
