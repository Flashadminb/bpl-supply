import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/useAsync'
import { assetReturn, listAssetHoldings } from '../lib/api'
import { readableError } from '../lib/supabase'
import { fmtDateTime, relativeAge } from '../lib/format'
import { stampLines } from '../lib/image'
import { canAudit } from '../lib/roles'
import { AssetTransfer, candidateFromHolding, targetFromHolding } from './AssetTransfer'
import { PhotoSteps, shotsToPhotos, type Shot } from './PhotoSteps'
import { ErrorBox, Sheet, Spinner } from './ui'
import { PartBoundary } from './ErrorBoundary'
import type { AssetHolding } from '../lib/types'

/**
 * เครื่องที่คนอื่นถืออยู่ — เห็นได้เฉพาะแอดมิน ผู้ดูแลระบบ และผู้ตรวจสอบ
 *
 * ของเดิมโชว์แค่เครื่องที่ "เรากดเบิกให้" ซึ่งแทบไม่มีวันขึ้น
 * เพราะปกติหน้างานกดเบิกเอง คนดูแลจึงเปิดหน้าคืนของแล้วเจอว่างเปล่า
 * ทั้งที่ของออกไปอยู่ข้างนอกจริง และไม่มีทางกดโอนเครื่องจากมือถือได้เลย
 *
 * คืนแทนได้จากตรงนี้ด้วย และเป็นที่ที่เหมาะกว่าหน้าเว็บ
 * เพราะจังหวะที่ต้องคืนแทนจริง ๆ คือตอนเจ้าตัวเดินเอาของมาคืนถึงมือ
 * ซึ่งเป็นตอนที่กล้องอยู่ในมือพอดี ไม่ใช่ตอนนั่งอยู่หน้าคอม
 *
 * บังคับกรอกเหตุผล เพราะรายการนี้ไปปิดประวัติของคนอื่น
 * ถ้าไม่มีเหตุผลติดไว้ พอย้อนดูทีหลังจะไม่มีทางรู้ว่าปิดเพราะอะไร
 * มีปุ่มเหตุผลสำเร็จรูปให้กด เพราะหน้างานใส่ถุงมือพิมพ์ยาก ๆ ไม่ไหว
 *
 * แสดงทีละ 8 แถวก่อน เพราะช่วงเปลี่ยนกะอาจค้างพร้อมกันหลายสิบเครื่อง
 * แล้วหน้าคืนของของเจ้าตัวจะถูกดันหายไปท้ายจอ
 */
const FIRST_BATCH = 8

// โชว์ช่องค้นหาตั้งแต่ยังไม่เยอะ ไม่ต้องรอให้ถึงขั้นเลื่อนหาไม่เจอ
const SEARCH_FROM = 3

// ไม่ได้บังคับจำนวน แต่ต้องมีเพดานกันกดรัวจนเครื่องค้าง
const PHOTO_CAP = 20

const QUICK_REASONS = [
  'เอามาคืนที่ห้องแล้ว',
  'เจ้าตัวลืมกดคืน',
  'เลิกกะแล้วฝากคืน',
  'รับคืนหน้างาน',
]

export function HubHoldings({ onCount }: { onCount?: (n: number) => void }) {
  const { profile } = useAuth()
  const may = canAudit(profile)

  const feed = useAsync(() => (may ? listAssetHoldings(false) : Promise.resolve([])), [may])

  const [search, setSearch] = useState('')
  const [all, setAll] = useState(false)
  const [moving, setMoving] = useState<AssetHolding | null>(null)

  // คืนแทน
  const [giveBack, setGiveBack] = useState<AssetHolding | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // ของตัวเองขึ้นอยู่ข้างบนแล้วในกล่องคืนของ ไม่ต้องซ้ำ
  const others = useMemo(
    () => (feed.data ?? []).filter((h) => h.user_id !== profile?.id),
    [feed.data, profile?.id],
  )

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return others
    return others.filter((h) =>
      `${h.asset_code} ${h.type_name} ${h.holder_name} ${h.holder_code} ${h.holder_dept ?? ''}`
        .toLowerCase()
        .includes(s),
    )
  }, [others, search])

  /**
   * เลือกคืนได้ทุกเครื่องในรายการ ไม่จำกัดว่าต้องเป็นของคนเดียวกันหรือประเภทเดียวกัน
   * ของคนที่กดเปิดขึ้นก่อน เพราะเป็นกองที่อยู่ตรงหน้าจริง ๆ ณ ตอนนั้น
   */
  const canPick = useMemo(() => {
    if (!giveBack) return []
    return [...others].sort((a, b) => {
      const mine = (h: AssetHolding) => (h.user_id === giveBack.user_id ? 0 : 1)
      return mine(a) - mine(b) || a.asset_code.localeCompare(b.asset_code, 'th')
    })
  }, [others, giveBack])

  const photos = shotsToPhotos(shots)
  // รูปไม่บังคับ เพราะคนที่คืนแทนได้คือแอดมิน เจ้าของระบบ และผู้ตรวจสอบ
  // แต่ถ้าถ่ายแล้วต้องอัปโหลดให้เสร็จก่อน ไม่งั้นรูปจะหลุดหาย
  const uploading = shots.some((s) => s.state !== 'done')
  const ready = picked.length > 0 && !uploading && reason.trim().length > 0

  // หน้าแม่ต้องรู้จำนวน ไม่งั้นจะขึ้น "ไม่มีของค้างคืน" ทับรายการที่มีอยู่จริง
  const told = useRef(-1)
  useEffect(() => {
    if (feed.loading || told.current === others.length) return
    told.current = others.length
    onCount?.(others.length)
  }, [others.length, feed.loading, onCount])

  function openReturn(h: AssetHolding) {
    setGiveBack(h)
    setPicked([h.asset_code])
    setShots([])
    setReason('')
    setErr(null)
  }

  async function submitReturn() {
    if (!giveBack || !ready) return
    setBusy(true)
    setErr(null)
    try {
      const res = await assetReturn({
        codes: picked,
        photos,
        note: `คืนแทน · ${reason.trim()}`,
      })
      setOkMsg(`คืนแทนแล้ว ${res.count} เครื่อง · ${res.ref_no}`)
      setGiveBack(null)
      setShots([])
      feed.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!may) return null
  if (feed.loading || others.length === 0) return null

  const shown = all || search.trim() ? rows : rows.slice(0, FIRST_BATCH)
  const hidden = rows.length - shown.length

  return (
    <section className="mb-4">
      <h2 className="mb-1 font-display text-md">เครื่องที่คนอื่นถืออยู่</h2>
      <p className="mb-2 text-sm text-ink-500">
        {others.length} เครื่องทั้งฮับ · คืนแทนหรือโอนให้แผนกอื่นได้จากตรงนี้
      </p>

      {okMsg && (
        <p className="mb-2 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">
          {okMsg}
          <button type="button" className="ml-2 underline" onClick={() => setOkMsg(null)}>
            ปิด
          </button>
        </p>
      )}

      {others.length > SEARCH_FROM && (
        <input
          className="input mb-2"
          type="search"
          placeholder="ค้นหารหัสเครื่อง ชื่อคน หรือรหัสพนักงาน"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {rows.length === 0 && (
        <p className="rounded-card bg-surface-2 px-3 py-2 text-sm text-ink-500">ไม่พบตามคำค้น</p>
      )}

      <ul className="space-y-2">
        {shown.map((h) => {
          const late = h.due_at && Date.now() > Date.parse(h.due_at)
          return (
            <li
              key={h.out_item_id}
              className={`rounded-card border p-3 ${
                late ? 'border-danger/25 bg-danger-bg' : 'border-line bg-surface'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-display">
                  {h.asset_code} · {h.type_name}
                </span>
                <span className={`text-xs ${late ? 'text-danger-txt' : 'text-ink-400'}`}>
                  {late ? 'เลยเวลาคืนแล้ว' : relativeAge(h.taken_at)}
                </span>
              </div>

              <p className="truncate text-sm">
                {h.holder_name}
                <span className="text-ink-400">
                  {' '}
                  · {h.holder_code}
                  {h.holder_dept ? ` · ${h.holder_dept}` : ''}
                </span>
              </p>

              <p className={`text-xs ${late ? 'text-danger-txt' : 'text-ink-400'}`}>
                เบิก {fmtDateTime(h.taken_at)}
                {h.due_at ? ` · กำหนดคืน ${fmtDateTime(h.due_at)}` : ''}
              </p>

              {/* ต้องรู้ว่าใครกดให้ ไม่งั้นตามเรื่องไม่ถูกคนตอนของหาย */}
              {h.acted_by_name && (
                <p className="text-xs text-ink-500">
                  {h.acted_by === profile?.id ? 'คุณเป็นคนเบิกให้' : `เบิกให้โดย ${h.acted_by_name}`}
                </p>
              )}

              {h.asset_loan_name && (
                <p className="text-xs text-warn-txt">โอนให้ {h.asset_loan_name} อยู่</p>
              )}

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="btn-soft h-tap flex-1 text-sm"
                  onClick={() => openReturn(h)}
                >
                  คืนแทน
                </button>
                <button
                  type="button"
                  className="btn-ghost h-tap flex-1 text-sm"
                  onClick={() => setMoving(h)}
                >
                  โอนให้แผนกอื่น
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          className="btn-ghost mt-2 h-tap w-full text-sm"
          onClick={() => setAll(true)}
        >
          ดูอีก {hidden} เครื่อง
        </button>
      )}

      <AssetTransfer
        asset={moving ? targetFromHolding(moving) : null}
        holding={moving ?? undefined}
        candidates={others.map(candidateFromHolding)}
        onClose={() => setMoving(null)}
        onDone={feed.reload}
      />

      {/* ----------------------------------------------------- คืนแทนเจ้าตัว */}
      <Sheet
        open={Boolean(giveBack)}
        title={giveBack ? `คืนแทน ${giveBack.holder_name}` : ''}
        onClose={() => setGiveBack(null)}
      >
        {giveBack && (
          <>
            <p className="rounded-card bg-surface-2 px-3 py-2 text-sm text-ink-500">
              ประวัติจะยังขึ้นชื่อ <b>{giveBack.holder_name}</b> เป็นผู้เบิกเหมือนเดิม
              <br />
              และบันทึกไว้ว่าคุณเป็นคนกดคืนให้
            </p>

            <p className="label mt-3">เลือกเครื่องที่จะคืน</p>
            <p className="mb-1 text-xs text-ink-400">
              เลือกกี่เครื่องก็ได้ ของใครก็ได้ ประเภทไหนก็ได้ · ระบบจะแยกใบคืนตามประเภทให้เอง
              <br />
              {/* คนมักไม่กล้าติ๊กแค่ตัวเดียว เพราะกลัวว่าจะปิดทั้งใบให้เจ้าตัว */}
              เครื่องที่ไม่ได้ติ๊กยังค้างชื่อเจ้าตัวเหมือนเดิม เวลานับต่อจากตอนเบิกครั้งแรก
            </p>
            <ul className="max-h-[280px] space-y-1 overflow-y-auto">
              {canPick.map((h) => {
                const on = picked.includes(h.asset_code)
                return (
                  <li key={h.out_item_id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-3 rounded-card border p-3 text-left ${
                        on ? 'border-ink bg-brand-50' : 'border-line bg-surface'
                      }`}
                      onClick={() =>
                        setPicked((v) =>
                          v.includes(h.asset_code)
                            ? v.filter((c) => c !== h.asset_code)
                            : [...v, h.asset_code],
                        )
                      }
                    >
                      <span
                        aria-hidden
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-btn border text-sm ${
                          on ? 'border-ink bg-ink text-white' : 'border-line-2 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-display">{h.asset_code}</span>
                        <span className="block truncate text-sm text-ink-500">
                          {h.type_name} · {h.holder_name}
                        </span>
                        <span className="block text-xs text-ink-400">
                          เบิก {fmtDateTime(h.taken_at)} · {relativeAge(h.taken_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <p className="label mt-3">เหตุผลที่คืนแทน</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip ${reason === r ? 'chip-on' : ''}`}
                  onClick={() => setReason(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder="หรือพิมพ์เอง"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />

            <div className="mt-3 rounded-card border border-line p-3">
              <p className="font-display">รูปสภาพตอนคืน (ไม่บังคับ)</p>
              <p className="mb-2 text-sm text-ink-400">
                ถ่ายกี่ใบก็ได้ หรือไม่ถ่ายเลยก็ได้ · แนะนำให้ถ่ายถ้าเครื่องมีรอยหรือสภาพผิดปกติ
              </p>
              <PartBoundary label="กล่องถ่ายรูป">
                <PhotoSteps
                  steps={[]}
                  maxFree={PHOTO_CAP}
                  minFree={0}
                  stamp={stampLines(
                    profile?.full_name ?? '',
                    profile?.employee_code ?? '',
                    profile?.dept_code ?? 'BPL',
                    'คืนแทน',
                  )}
                  shots={shots}
                  onShots={setShots}
                />
              </PartBoundary>
            </div>

            {err && (
              <div className="mt-3">
                <ErrorBox message={err} />
              </div>
            )}

            <button
              type="button"
              className="btn-primary mt-3 w-full py-4 text-md"
              disabled={!ready || busy}
              onClick={() => void submitReturn()}
            >
              {busy ? <Spinner /> : null}
              {busy
                ? 'กำลังบันทึก…'
                : picked.length === 0
                  ? 'เลือกเครื่องก่อน'
                  : uploading
                    ? 'รอรูปอัปโหลดให้เสร็จก่อน'
                    : !reason.trim()
                      ? 'ใส่เหตุผลก่อน'
                      : `ยืนยันคืนแทน ${picked.length} เครื่อง`}
            </button>
          </>
        )}
      </Sheet>
    </section>
  )
}
