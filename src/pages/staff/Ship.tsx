import { useMemo, useState } from 'react'
import { listSackOrders, markSackSent, sackRelays } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { useAuth } from '../../lib/auth'
import { StaffPage, TopBar } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading, Sheet, Spinner } from '../../components/ui'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { SackResult } from '../../components/SackResult'
import { SackFormView } from '../../components/SackFormView'
import { sackStatusLabel } from '../../lib/sackCard'
import { stampLines } from '../../lib/image'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { SackRow } from '../../lib/types'

/**
 * หน้ากระสอบรอส่ง — ของหน้างาน
 *
 * งานจริงบนพื้นคือ: ของมากองอยู่ หยิบขึ้นรถ ส่ง แล้วต้องรายงานส่วนกลาง
 * หน้านี้จึงมีแค่สามจังหวะ — เห็นว่ามีอะไรรอ · บอกว่าส่งยังไง · ได้ฟอร์มไปแปะ
 *
 * ทำไมรูปไม่บังคับ
 *   บางเที่ยวรถออกทันที ถ่ายไม่ทัน ถ้าบังคับ คนจะเลี่ยงด้วยการไม่กดเลย
 *   แล้วเราจะเสียข้อมูลทั้งใบ แทนที่จะเสียแค่รูป
 */

const MAX_PHOTOS = 6

export default function Ship() {
  const { profile, hubName } = useAuth()
  const list = useAsync(() => listSackOrders({ status: 'all', limit: 120 }), [])
  const relays = useAsync(() => sackRelays(), [])

  const [target, setTarget] = useState<SackRow | null>(null)
  const [mode, setMode] = useState<'direct' | 'relay'>('direct')
  const [via, setVia] = useState('')
  /**
   * ส่งไปจริงเท่าไหร่ — เติมจำนวนที่ขอไว้ให้แล้ว
   *
   * เคสปกติคือส่งครบ คนหน้างานจึงไม่ต้องแตะช่องนี้เลย
   * ที่ต้องมีเพราะของในฮับไม่พอก็เกิดบ่อย สาขาขอ 500 ส่งได้จริง 200
   * ถ้าบันทึกแค่ "ส่งแล้ว" ส่วนกลางจะไล่ไม่ได้ว่ายังค้างอยู่เท่าไหร่
   */
  const [qtyOut, setQtyOut] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** ใบที่เพิ่งกดส่งเสร็จ พร้อม object URL ของรูปที่ยังอยู่ในเครื่อง */
  const [done, setDone] = useState<{ row: SackRow; urls: string[] } | null>(null)
  /** ใบเก่าที่กดดูฟอร์มย้อนหลัง — ไม่มีรูปในเครื่องแล้ว การ์ดจึงมีแต่ข้อความ */
  const [review, setReview] = useState<SackRow | null>(null)

  const rows = list.data ?? []
  const pending = rows.filter((r) => r.status === 'pending')
  const sent = rows.filter((r) => r.status !== 'pending')

  const stamp = useMemo(
    () => stampLines(profile?.full_name ?? '', profile?.employee_code ?? '', hubName ?? '21BPL', 'กระสอบ'),
    [profile?.full_name, profile?.employee_code, hubName],
  )

  const photosReady = shots.length === 0 || shots.every((s) => s.state === 'done')
  const qtyNum = Number(qtyOut)
  const qtyOk = qtyOut.trim() !== '' && Number.isFinite(qtyNum) && qtyNum > 0
  const canSend =
    photosReady && qtyOk && !busy && (mode === 'direct' || via.trim() !== '')

  function open(row: SackRow) {
    setTarget(row)
    setMode('direct')
    setVia('')
    setQtyOut(String(row.qty))
    setShots([])
    setErr(null)
  }

  function close() {
    setTarget(null)
    setShots([])
  }

  async function confirm() {
    if (!target) return
    setBusy(true)
    setErr(null)
    try {
      const photos = shotsToPhotos(shots).map((p) => ({
        file_id: p.file_id,
        web_link: p.web_link,
        bytes: p.bytes,
      }))
      const res = await markSackSent({
        id: target.id,
        mode,
        relayVia: via.trim() || null,
        photos,
        sentQty: qtyNum,
      })

      // รูปในเครื่องยังอยู่ ใช้วาดการ์ดได้ทันทีโดยไม่ต้องโหลดกลับจาก Drive
      const urls = shots.filter((s) => s.state === 'done').map((s) => s.img.objectUrl)
      const shown: SackRow = {
        ...target,
        status: res.duplicate ? (res.status as SackRow['status']) : mode,
        relay_via: res.duplicate ? res.relay_via : via.trim() || null,
        sent_at: target.sent_at ?? new Date().toISOString(),
        sent_by_name: target.sent_by_name ?? profile?.full_name ?? null,
        photo_count: res.duplicate ? target.photo_count : photos.length,
        sent_qty: res.sent_qty,
        qty_out: res.sent_qty,
        qty_differs: res.sent_qty !== target.qty,
      }
      setTarget(null)
      setDone({ row: shown, urls })
      list.reload()
      relays.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'กดส่งไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------------------------------ หน้าผลลัพธ์หลังกดส่ง */
  if (done) {
    return (
      <>
        <TopBar title="ส่งแล้ว" />
        <StaffPage nav={false}>
          <div className="card mb-3 border-success/25 bg-success-bg p-4">
            <p className="font-display text-md text-success-txt">
              {done.row.ref_no} · {sackStatusLabel(done.row)}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {done.row.branch} · {done.row.qty.toLocaleString('th-TH')} {done.row.unit}
            </p>
          </div>

          <SackResult row={done.row} photoUrls={done.urls} sentBy={profile?.full_name} />

          <button type="button" className="btn-dark mt-4 w-full" onClick={() => setDone(null)}>
            กลับไปรายการ
          </button>
        </StaffPage>
      </>
    )
  }

  return (
    <>
      <TopBar title="กระสอบรอส่ง" back="/" />
      <StaffPage nav={false}>
        {list.loading && <Loading />}
        {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

        {!list.loading && !list.error && (
          <>
            <p className="mb-2 font-display text-md">
              รอส่ง {pending.length > 0 && <span className="text-ink-400">· {pending.length} รายการ</span>}
            </p>

            {pending.length === 0 ? (
              <EmptyState title="ไม่มีกระสอบรอส่ง" hint="ส่วนกลางยังไม่ได้ตั้งรายการเข้ามา" />
            ) : (
              <div className="space-y-2">
                {pending.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => open(r)}
                    className="card flex w-full items-center gap-3 p-4 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-md">{r.branch}</span>
                      <span className="block text-sm text-ink-500">
                        {r.qty.toLocaleString('th-TH')} {r.unit}
                        {r.note ? ` · ${r.note}` : ''}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-ink-400">
                        {r.ref_no} · ตั้งเมื่อ {relativeAge(r.created_at)}
                      </span>
                    </span>
                    <span className="rounded-pill bg-brand-500 px-3 py-2 font-display text-sm text-ink">
                      กดส่ง
                    </span>
                  </button>
                ))}
              </div>
            )}

            {sent.length > 0 && (
              <>
                <p className="mb-2 mt-5 font-display text-md">ส่งแล้ว</p>
                <div className="space-y-2">
                  {sent.slice(0, 30).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setReview(r)}
                      className="card flex w-full items-center gap-3 p-3 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-base">{r.branch}</span>
                        <span className="block font-mono text-xs text-ink-400">
                          {r.ref_no} · {sackStatusLabel(r)} · {fmtDateTime(r.sent_at ?? r.created_at)}
                        </span>
                      </span>
                      <span className="text-sm text-ink-400 underline">ดูฟอร์ม</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </StaffPage>

      {/* ---------------------------------------------- แผ่นกดส่ง */}
      <Sheet open={Boolean(target)} onClose={close} title={target ? `ส่ง ${target.branch}` : ''}>
        {target && (
          <div className="space-y-4">
            <p className="rounded-card bg-surface-2 p-3 text-sm text-ink-700">
              {target.qty.toLocaleString('th-TH')} {target.unit} · {target.ref_no}
              {target.note ? ` · ${target.note}` : ''}
            </p>

            <div>
              <label className="label" htmlFor="ship-qty">
                ส่งไปเท่าไหร่
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="ship-qty"
                  className="input w-[140px] text-lg"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={qtyOut}
                  onChange={(e) => setQtyOut(e.target.value)}
                />
                <span className="text-sm text-ink-500">{target.unit}</span>
              </div>
              {qtyOk && qtyNum !== target.qty && (
                <p className="mt-1 text-xs text-warn-txt">
                  ไม่เท่าที่ขอ ({target.qty.toLocaleString('th-TH')} {target.unit}) —
                  ส่งได้เท่านี้ก็กดได้เลย ส่วนกลางจะเห็นเองว่ายังค้างเท่าไหร่
                </p>
              )}
              {!qtyOk && (
                <p className="mt-1 text-xs text-danger-txt">ใส่จำนวนที่ส่งไปจริงก่อน</p>
              )}
            </div>

            <div>
              <p className="label">ส่งยังไง</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`chip flex-1 justify-center py-3 ${mode === 'direct' ? 'chip-on' : ''}`}
                  onClick={() => setMode('direct')}
                >
                  ส่งตรง
                </button>
                <button
                  type="button"
                  className={`chip flex-1 justify-center py-3 ${mode === 'relay' ? 'chip-on' : ''}`}
                  onClick={() => setMode('relay')}
                >
                  ฝากส่ง
                </button>
              </div>
            </div>

            {mode === 'relay' && (
              <div>
                <label className="label" htmlFor="ship-via">
                  ฝากสาขาไหนส่งต่อ
                </label>
                <input
                  id="ship-via"
                  className="input w-full"
                  list="ship-via-list"
                  placeholder="พิมพ์ชื่อสาขาที่ฝาก"
                  value={via}
                  onChange={(e) => setVia(e.target.value)}
                />
                <datalist id="ship-via-list">
                  {(relays.data ?? []).map((r) => (
                    <option key={r.via} value={r.via} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-ink-400">
                  ต้องใส่ชื่อ ไม่งั้นส่วนกลางจะตามของไม่ได้ว่าไปค้างที่ไหน
                </p>
              </div>
            )}

            <div>
              <p className="label">รูปหลักฐาน · ไม่บังคับ สูงสุด {MAX_PHOTOS} ใบ</p>
              <PhotoSteps
                steps={[]}
                maxFree={MAX_PHOTOS}
                minFree={0}
                stamp={stamp}
                shots={shots}
                onShots={setShots}
              />
            </div>

            {err && <ErrorBox message={err} />}

            <button type="button" className="btn-primary w-full" onClick={confirm} disabled={!canSend}>
              {busy ? <Spinner /> : !photosReady ? 'รอรูปอัปโหลดเสร็จ…' : 'ยืนยันว่าส่งแล้ว'}
            </button>
          </div>
        )}
      </Sheet>

      {/* -------------------------------- ฟอร์มย้อนหลังของใบที่ส่งไปแล้ว */}
      <Sheet
        open={Boolean(review)}
        onClose={() => setReview(null)}
        title={review ? review.ref_no : ''}
      >
        {review && <SackFormView row={review} />}
      </Sheet>
    </>
  )
}
