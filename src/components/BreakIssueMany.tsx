import { useMemo, useState } from 'react'
import {
  breakIssueMany,
  type BreakCardOption,
  type BreakReason,
  type BreakSupplier,
} from '../lib/breakPass'
import { PhotoSteps, shotsToPhotos, type Shot } from './PhotoSteps'
import { Sheet, Spinner } from './ui'

/**
 * ปล่อยบัตรเบรคแบบใบละคน · ถ่ายไปเรื่อย ๆ แล้วส่งทีเดียว
 *
 * ขึ้นเฉพาะแผนกที่เปิดกฎใบละคนไว้ที่หลังบ้าน · ปิดอยู่ = ไม่เห็นหน้านี้เลย
 *
 * ─────────────────────────────────────────────────────────────────
 * ทำไมถ่ายไปเรื่อย ๆ แล้วส่งทีเดียว ไม่ใช่ส่งทีละคน
 *
 * รูปอัปขึ้น Drive ทันทีที่กดถ่าย (PhotoSteps ทำให้อยู่แล้ว)
 * รูปคนที่หนึ่งจึงอัปไปตอนกำลังถ่ายคนที่สอง หัวหน้าไม่ต้องยืนรอทีละคน
 * พอกดส่งจริง รูปอยู่บน Drive หมดแล้ว เหลือแค่เขียนฐานข้อมูล
 *
 * ถ้าส่งทีละคน ต้องรออัปห้ารอบโดยมีคนยืนรอหน้าเราอยู่ทุกรอบ
 *
 * ─────────────────────────────────────────────────────────────────
 * สามอย่างที่ตั้งใจให้เป็นแบบนี้
 *
 * ① เวลาเริ่มเดินพร้อมกันตอนกดส่ง ฐานข้อมูลเป็นคนใส่เวลาให้ทุกใบพร้อมกัน
 *    ถ้าเริ่มนับตอนถ่าย คนแรกจะเสียเวลาที่รอหัวหน้าถ่ายคนที่เหลือไปฟรี ๆ
 *
 * ② ส่งแล้วขึ้นครบทุกใบ หรือไม่ขึ้นเลยสักใบ · ฐานข้อมูลตรวจทุกแถวก่อนเขียน
 *    ถ้าขึ้นครึ่งเดียว หัวหน้าจะไม่รู้ว่าต้องแจกบัตรใบไหนบ้าง
 *
 * ③ บัตรกับซัพถูกแสตมป์ลงบนรูป · ถึงแถวสลับกันทีหลัง รูปก็ยังบอกได้เองว่าใบไหน
 */

/** รูปนี้ไว้ดูว่าหน้าใคร ไม่ได้ไว้ซูมอ่านตัวหนังสือ · เล็กลงครึ่งหนึ่งจากของเดิม
 *  ใบละคนทำให้จำนวนรูปต่อวันเพิ่มราวสามเท่า ถ้าไม่ย่อ เน็ตขาออกจะเกินโควตาฟรี */
const MAX_EDGE = 448

/** 2 ถึง 30 นาที ตามที่เจ้าของระบบเคาะ */
const MINUTES = Array.from({ length: 29 }, (_, i) => i + 2)

interface Row {
  key: string
  card: string
  supplier: string | null
  /** ว่าง = ใช้ค่ารวมของรอบ */
  minutes: number | null
  reason: string | null
  nickname: string
  shots: Shot[]
}

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export function BreakIssueMany({
  cards,
  reasons,
  suppliers,
  stampBase,
  banOn,
  banWhy,
  onDone,
  onCancel,
}: {
  /** บัตรของแผนกนี้เท่านั้น */
  cards: BreakCardOption[]
  reasons: BreakReason[]
  suppliers: BreakSupplier[]
  /** สามบรรทัดแรกของแสตมป์ · บรรทัดท้ายเติมรหัสบัตรกับซัพให้เอง */
  stampBase: string[]
  banOn: boolean
  banWhy: string
  onDone: (n: number) => void
  onCancel: () => void
}) {
  const grp = cards[0]
  const [reason, setReason] = useState<string>(reasons[0]?.code ?? '')
  const [minutes, setMinutes] = useState<number>(reasons[0]?.default_minutes ?? 10)
  const [rows, setRows] = useState<Row[]>([])
  const [pick, setPick] = useState<{ key: string; what: 'card' | 'sup' | 'min' | 'rsn' } | null>(null)
  const [shoot, setShoot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const supOn = suppliers.length > 0

  /** บัตรที่ยังหยิบได้ · ไม่ติดใบที่ยังไม่กลับ และไม่ซ้ำกับแถวอื่น */
  const freeCards = useMemo(() => {
    const used = new Set(rows.map((r) => r.card))
    return cards.filter((c) => !c.busy && !used.has(c.code))
  }, [cards, rows])

  /** เหลือสิทธิ์อีกกี่คน · 0 แปลว่าไม่จำกัด */
  const roomLeft = grp && grp.max_people > 0 ? Math.max(0, grp.max_people - grp.open_people) : Infinity
  const overCap = rows.length > roomLeft

  function addRow() {
    const next = freeCards[0]
    if (!next) return
    setRows((p) => [
      ...p,
      {
        key: newKey(),
        card: next.code,
        /* ซัพจำจากแถวก่อนหน้า · ปล่อยทั้งกลุ่มจากซัพเดียวกันคือกรณีปกติ */
        supplier: p.length > 0 ? p[p.length - 1].supplier : null,
        minutes: null,
        reason: null,
        nickname: '',
        shots: [],
      },
    ])
  }

  const set = (key: string, patch: Partial<Row>) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const rowReady = (r: Row) => {
    const ph = shotsToPhotos(r.shots)
    const up = r.shots.some((s) => s.state === 'uploading' || s.state === 'ready')
    const bad = r.shots.some((s) => s.state === 'failed')
    return ph.length >= 1 && !up && !bad && (!supOn || Boolean(r.supplier))
  }

  const notReady = rows.find((r) => !rowReady(r))
  const ready =
    rows.length > 0 && !notReady && !overCap && (!banOn || banWhy.trim().length > 0) && !busy

  /** ปุ่มส่งบอกเหตุผลที่กดไม่ได้ ไม่ใช่เทาเฉย ๆ แล้วให้ยืนเดาหน้าคนที่รออยู่ */
  function whyBlocked(): string {
    if (rows.length === 0) return 'ยังไม่ได้ใส่คนสักคน'
    if (overCap) return `แผนกนี้เหลือสิทธิ์ ${roomLeft} คน แต่ใส่มา ${rows.length} คน`
    if (banOn && !banWhy.trim()) return 'อยู่ในช่วงห้าม ต้องกรอกเหตุผลฉุกเฉินก่อน'
    if (notReady) {
      const i = rows.indexOf(notReady) + 1
      const up = notReady.shots.some((s) => s.state === 'uploading' || s.state === 'ready')
      const bad = notReady.shots.some((s) => s.state === 'failed')
      if (bad) return `แถว ${i} · รูปส่งไม่สำเร็จ แตะที่รูปแล้วลองใหม่`
      if (up) return `แถว ${i} · กำลังส่งรูป ถ่ายคนต่อไปได้เลย ไม่ต้องรอ`
      if (shotsToPhotos(notReady.shots).length === 0) return `แถว ${i} · ยังไม่มีรูป`
      return `แถว ${i} · ยังไม่ได้เลือกซัพ`
    }
    return ''
  }

  async function submit() {
    if (!ready) return
    setBusy(true)
    setErr(null)
    try {
      const res = await breakIssueMany({
        rows: rows.map((r) => ({
          card: r.card,
          supplier: r.supplier,
          minutes: r.minutes,
          reason: r.reason,
          nickname: r.nickname.trim() || null,
          photos: shotsToPhotos(r.shots).map((p) => ({
            file_id: p.file_id,
            web_link: p.web_link,
            bytes: p.bytes,
          })),
        })),
        reason,
        minutes,
        banReason: banOn ? banWhy.trim() : null,
      })
      onDone(res.n)
      setRows([])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reasonLabel = (code: string | null) =>
    reasons.find((x) => x.code === (code ?? reason))?.label ?? '—'
  const supName = (code: string | null) =>
    suppliers.find((x) => x.code === code)?.name ?? code ?? ''

  const openRow = rows.find((r) => r.key === shoot) ?? null

  return (
    <section className="mb-4">
      {/* ───────── ค่ารวมของรอบ ───────── */}
      <div className="mb-1 flex gap-2">
        <button
          type="button"
          className="h-tap flex-1 rounded-btn border border-line-2 bg-surface px-3 text-left"
          onClick={() => setPick({ key: '*', what: 'rsn' })}
        >
          <span className="block text-[10px] leading-none text-ink-400">เหตุผลรวม</span>
          <span className="block font-display text-sm font-semibold">{reasonLabel(null)}</span>
        </button>
        <button
          type="button"
          className="h-tap w-[118px] shrink-0 rounded-btn border border-line-2 bg-surface px-3 text-left"
          onClick={() => setPick({ key: '*', what: 'min' })}
        >
          <span className="block text-[10px] leading-none text-ink-400">นาทีรวม</span>
          <span className="block font-display text-sm font-semibold">{minutes} นาที</span>
        </button>
      </div>
      <p className="mb-3 text-[10.5px] text-ink-400">
        ทุกคนใช้ค่านี้ · ใครไม่เท่ากันค่อยแตะแก้เฉพาะแถวนั้น
      </p>

      {/* ───────── แถวคน ───────── */}
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const ph = shotsToPhotos(r.shots)
          const up = r.shots.some((s) => s.state === 'uploading' || s.state === 'ready')
          const bad = r.shots.some((s) => s.state === 'failed')
          const ok = rowReady(r)
          return (
            <div
              key={r.key}
              className={`rounded-card border border-line bg-surface p-2 ${
                ok ? 'border-l-4 border-l-success' : up ? 'border-l-4 border-l-warn' : 'border-l-4 border-l-danger'
              }`}
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="w-3 text-right font-mono text-[10px] text-ink-400">{i + 1}</span>
                <button
                  type="button"
                  className="font-mono text-sm font-bold"
                  onClick={() => setPick({ key: r.key, what: 'card' })}
                >
                  {r.card}
                  <span className="ml-1 text-[9px] font-normal text-ink-300">▾</span>
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  className="px-1 text-md leading-none text-ink-300"
                  aria-label={`เอาแถว ${i + 1} ออก`}
                  onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}
                >
                  ✕
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <div className="flex min-w-0 flex-1 gap-1.5">
                  {supOn && (
                    <button
                      type="button"
                      className={`h-tap shrink-0 rounded-btn px-2 text-left ${
                        r.supplier
                          ? 'border border-line-2 bg-surface-2'
                          : 'border border-dashed border-danger bg-danger-bg'
                      }`}
                      onClick={() => setPick({ key: r.key, what: 'sup' })}
                    >
                      <span className={`block text-[9px] leading-none ${r.supplier ? 'text-ink-400' : 'text-danger-txt'}`}>
                        ซัพ
                      </span>
                      <span className={`block font-display text-xs font-semibold ${r.supplier ? '' : 'text-danger-txt'}`}>
                        {r.supplier ? supName(r.supplier) : 'เลือก'}
                      </span>
                    </button>
                  )}
                  {/* จุดดำ + กรอบเข้ม = แถวนี้ตั้งเอง ไม่ได้ใช้ค่ารวม */}
                  <button
                    type="button"
                    className={`h-tap shrink-0 rounded-btn px-2 text-left ${
                      r.minutes ? 'border-[1.5px] border-ink bg-surface' : 'border border-line-2 bg-surface-2'
                    }`}
                    onClick={() => setPick({ key: r.key, what: 'min' })}
                  >
                    <span className="block text-[9px] leading-none text-ink-400">
                      {r.minutes ? '• ' : ''}นาที
                    </span>
                    <span className="block font-display text-xs font-semibold">{r.minutes ?? minutes}</span>
                  </button>
                  <button
                    type="button"
                    className={`h-tap min-w-0 flex-1 rounded-btn px-2 text-left ${
                      r.reason ? 'border-[1.5px] border-ink bg-surface' : 'border border-line-2 bg-surface-2'
                    }`}
                    onClick={() => setPick({ key: r.key, what: 'rsn' })}
                  >
                    <span className="block text-[9px] leading-none text-ink-400">
                      {r.reason ? '• ' : ''}เหตุผล
                    </span>
                    <span className="block truncate font-display text-xs font-semibold">
                      {reasonLabel(r.reason)}
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-btn text-[9px] ${
                    ph.length > 0
                      ? 'border border-line-2 bg-ink/5'
                      : 'border border-dashed border-danger bg-danger-bg text-danger-txt'
                  }`}
                  onClick={() => setShoot(r.key)}
                >
                  {ph.length > 0 ? (
                    <>
                      <span className="text-md leading-none">{bad ? '✕' : up ? '⟳' : '✓'}</span>
                      <span className={bad ? 'text-danger-txt' : up ? 'text-warn-txt' : 'text-success-txt'}>
                        {bad ? 'ลองใหม่' : up ? 'กำลังส่ง' : 'ส่งแล้ว'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-lg leading-none">📷</span>
                      <span>ถ่าย</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className="mt-1.5 w-full rounded-card border border-dashed border-line-2 py-2.5 font-display text-sm font-semibold text-ink-500 disabled:opacity-40"
        disabled={freeCards.length === 0}
        onClick={addRow}
      >
        {freeCards.length === 0 ? 'ไม่มีบัตรว่างเหลือแล้ว' : '＋ เพิ่มคน'}
      </button>

      {err && <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{err}</p>}

      <div className="sticky bottom-0 mt-2 bg-gradient-to-b from-transparent to-canvas pt-3">
        <button
          type="button"
          className={ready ? 'btn-primary w-full py-3.5' : 'w-full rounded-btn border border-line-2 bg-surface-2 py-3.5 font-display text-ink-400'}
          disabled={!ready}
          onClick={() => void submit()}
        >
          {busy ? <Spinner /> : null}
          {ready ? `ปล่อย ${rows.length} ใบ · เริ่มนับเวลา` : 'ยังส่งไม่ได้'}
        </button>
        <p className="mt-1 text-center text-[10.5px] text-ink-400">
          {ready ? 'นาฬิกาทุกใบเริ่มเดินพร้อมกันตอนกด' : whyBlocked()}
        </p>
        <button type="button" className="mt-1 w-full py-2 text-xs text-ink-400 underline" onClick={onCancel}>
          ออกจากโหมดใบละคน
        </button>
      </div>

      {/* ───────── ชีตเลือกบัตร ───────── */}
      <Sheet
        open={pick?.what === 'card'}
        onClose={() => setPick(null)}
        title="เลือกบัตร"
      >
        <p className="mb-2 text-xs text-ink-400">ใบที่ยังไม่ได้รับกลับ และใบที่แถวอื่นใช้อยู่ จะไม่ขึ้นให้เลือก</p>
        <div className="space-y-1">
          {freeCards.length === 0 && <p className="py-3 text-sm text-ink-400">ไม่มีบัตรว่างเหลือแล้ว</p>}
          {freeCards.map((c) => (
            <button
              key={c.code}
              type="button"
              className="h-tap flex w-full items-center gap-2 rounded-btn border border-line px-3 text-left"
              onClick={() => {
                if (pick) set(pick.key, { card: c.code })
                setPick(null)
              }}
            >
              <span className="h-2 w-2 rounded-pill bg-success" />
              <span className="font-mono text-sm font-bold">{c.code}</span>
              <span className="flex-1" />
              <span className="text-xs text-ink-400">ว่าง</span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* ───────── ชีตเลือกซัพ ───────── */}
      <Sheet open={pick?.what === 'sup'} onClose={() => setPick(null)} title="เลือกซัพ">
        <div className="flex flex-wrap gap-2">
          {suppliers.map((sp) => (
            <button
              key={sp.code}
              type="button"
              className="h-tap rounded-btn border border-line bg-surface px-4 font-display text-sm font-semibold"
              onClick={() => {
                if (pick) set(pick.key, { supplier: sp.code })
                setPick(null)
              }}
            >
              {sp.name}
            </button>
          ))}
        </div>
      </Sheet>

      {/* ───────── ชีตเลือกนาที ───────── */}
      <Sheet open={pick?.what === 'min'} onClose={() => setPick(null)} title="กี่นาที">
        <p className="mb-2 text-xs text-ink-400">
          {pick?.key === '*' ? 'ตั้งเป็นค่ารวมของทุกคนในรอบนี้' : 'พื้นเหลืองคือค่ารวมของรอบนี้'}
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              className={`h-tap rounded-btn border font-display text-sm font-semibold ${
                m === minutes ? 'border-warn bg-warn-bg text-warn-txt' : 'border-line-2 bg-surface'
              }`}
              onClick={() => {
                if (pick?.key === '*') setMinutes(m)
                else if (pick) set(pick.key, { minutes: m })
                setPick(null)
              }}
            >
              {m}
            </button>
          ))}
          {pick?.key !== '*' && (
            <button
              type="button"
              className="h-tap rounded-btn border border-line-2 bg-surface text-[10px] leading-tight"
              onClick={() => {
                if (pick) set(pick.key, { minutes: null })
                setPick(null)
              }}
            >
              ใช้ค่า
              <br />
              รวม
            </button>
          )}
        </div>
      </Sheet>

      {/* ───────── ชีตเลือกเหตุผล ───────── */}
      <Sheet open={pick?.what === 'rsn'} onClose={() => setPick(null)} title="เพราะอะไร">
        <div className="space-y-1">
          {reasons.map((x) => (
            <button
              key={x.code}
              type="button"
              className="h-tap flex w-full items-center rounded-btn border border-line px-3 text-left text-sm"
              onClick={() => {
                if (pick?.key === '*') {
                  setReason(x.code)
                  setMinutes(x.default_minutes)
                } else if (pick) set(pick.key, { reason: x.code })
                setPick(null)
              }}
            >
              {x.label}
              <span className="flex-1" />
              <span className="text-xs text-ink-400">{x.default_minutes} นาที</span>
            </button>
          ))}
          {pick?.key !== '*' && (
            <button
              type="button"
              className="h-tap w-full rounded-btn border border-line px-3 text-left text-sm text-ink-500"
              onClick={() => {
                if (pick) set(pick.key, { reason: null })
                setPick(null)
              }}
            >
              ใช้เหตุผลรวม
            </button>
          )}
        </div>
      </Sheet>

      {/* ───────── ชีตถ่ายรูป ─────────
          ใช้ PhotoSteps ตัวเดียวกับทุกที่ในแอพ ไม่ได้เขียนตัวอัปรูปใหม่
          แสตมป์เติมรหัสบัตรกับซัพเข้าไปด้วย ถึงแถวสลับกันทีหลัง
          รูปก็ยังบอกได้เองว่าเป็นของใบไหน และ รปภ อ่านจากรูปได้เลย */}
      <Sheet open={Boolean(openRow)} onClose={() => setShoot(null)} title={`รูปของ ${openRow?.card ?? ''}`}>
        {openRow && (
          <>
            <PhotoSteps
              steps={[]}
              maxFree={1}
              minFree={1}
              stamp={[...stampBase, `${openRow.card}${openRow.supplier ? ' · ' + supName(openRow.supplier) : ''}`]}
              shots={openRow.shots}
              onShots={(next) =>
                setRows((p) =>
                  p.map((x) =>
                    x.key === openRow.key
                      ? { ...x, shots: typeof next === 'function' ? next(x.shots) : next }
                      : x,
                  ),
                )
              }
              kind="break"
              namePrefix="break"
              maxEdge={MAX_EDGE}
            />
            <input
              className="input mt-3"
              placeholder="ชื่อเล่น · ไม่บังคับ"
              value={openRow.nickname}
              onChange={(e) => set(openRow.key, { nickname: e.target.value })}
            />
            <button type="button" className="btn-primary mt-3 w-full py-3" onClick={() => setShoot(null)}>
              เสร็จ
            </button>
          </>
        )}
      </Sheet>
    </section>
  )
}
