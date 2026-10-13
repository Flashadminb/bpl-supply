import { useMemo, useState } from 'react'
import {
  breakIssueMany,
  type BreakCardOption,
  type BreakReason,
  type BreakSupplier,
} from '../lib/breakPass'
import { uploadEvidence } from '../lib/api'
import { compressImage, releaseImage, type CompressedImage } from '../lib/image'
import { readableError } from '../lib/supabase'
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

/**
 * รูปของแถวหนึ่งแถว · ใบเดียวต่อคน
 *
 * ไม่ได้ใช้ PhotoSteps เพราะอันนั้นเป็นกล่องเต็มที่มีปุ่มของตัวเอง
 * ซึ่งแปลว่าต้องเปิดชีตขึ้นมาก่อนถึงจะกดถ่ายได้ = กดสองครั้งต่อคน
 * ที่หน้างานถือของเต็มมือ สองครั้งต่อคนคูณสิบห้าคนคือเรื่องใหญ่
 * ตรงนี้จึงยิงกล้องตรง ๆ จากช่องรูปเลย แตะครั้งเดียวได้รูป
 *
 * ตัวบีบรูปกับตัวอัปเป็นตัวเดียวกับทั้งแอพ ไม่ได้เขียนใหม่
 */
interface Photo {
  state: 'working' | 'done' | 'failed'
  img?: CompressedImage
  fileId?: string
  webLink?: string | null
  bytes?: number | null
  error?: string
}

interface Row {
  key: string
  card: string
  supplier: string | null
  /** ว่าง = ใช้ค่ารวมของรอบ */
  minutes: number | null
  reason: string | null
  nickname: string
  photo: Photo | null
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
  const [reason, setReason] = useState<string>(reasons[0]?.code ?? '')
  const [minutes, setMinutes] = useState<number>(reasons[0]?.default_minutes ?? 10)
  const [rows, setRows] = useState<Row[]>([])
  const [pick, setPick] = useState<{ key: string; what: 'card' | 'sup' | 'min' | 'rsn' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const supOn = suppliers.length > 0

  const byCode = useMemo(() => new Map(cards.map((c) => [c.code, c])), [cards])
  const picked = useMemo(() => new Set(rows.map((r) => r.card)), [rows])

  /**
   * ปล่อยรวดเดียวต้องเป็นแผนกเดียวกันทั้งชุด · ฐานข้อมูลก็บังคับข้อนี้
   * พอกดใบแรกแล้ว แผนกอื่นจึงกดไม่ได้ ไม่ใช่ปล่อยให้กดแล้วไปล้มตอนกดส่ง
   */
  const lockGrp = rows.length > 0 ? (byCode.get(rows[0].card)?.group_code ?? null) : null
  const grp = useMemo(
    () => (lockGrp ? cards.find((c) => c.group_code === lockGrp) : cards[0]),
    [cards, lockGrp],
  )

  /** บัตรที่ยังหยิบได้ · ไม่ติดใบที่ยังไม่กลับ ไม่ซ้ำแถวอื่น และอยู่แผนกที่ล็อกไว้ */
  const freeCards = useMemo(
    () => cards.filter((c) => !c.busy && !picked.has(c.code) && (!lockGrp || c.group_code === lockGrp)),
    [cards, picked, lockGrp],
  )

  /** กระดานบัตร แยกตามแผนก · เรียงให้แผนกที่ล็อกไว้อยู่บนสุด */
  const board = useMemo(() => {
    const m = new Map<string, BreakCardOption[]>()
    for (const c of cards) m.set(c.group_code, [...(m.get(c.group_code) ?? []), c])
    return [...m.entries()].sort((a, b) =>
      a[0] === lockGrp ? -1 : b[0] === lockGrp ? 1 : a[0].localeCompare(b[0]),
    )
  }, [cards, lockGrp])

  /** เหลือสิทธิ์อีกกี่คน · 0 แปลว่าไม่จำกัด */
  const roomLeft = grp && grp.max_people > 0 ? Math.max(0, grp.max_people - grp.open_people) : Infinity
  const overCap = rows.length > roomLeft

  /**
   * ถ่ายรูปของแถวนั้น · บีบแล้วอัปขึ้น Drive ทันที
   *
   * อัปเลยไม่รอกดส่ง เพราะรูปคนที่หนึ่งจะได้อัปไปตอนกำลังถ่ายคนที่สอง
   * พอกดส่งจริงรูปอยู่บน Drive หมดแล้ว เหลือแค่เขียนฐานข้อมูล
   *
   * แสตมป์มีรหัสบัตรกับซัพอยู่ด้วย ถึงแถวสลับกันทีหลัง
   * รูปก็ยังบอกได้เองว่าเป็นของใบไหน และ รปภ อ่านจากรูปได้เลย
   */
  async function shoot(key: string, file: File) {
    const row = rows.find((x) => x.key === key)
    if (!row) return
    if (row.photo?.img) releaseImage(row.photo.img)
    setRows((p) => p.map((x) => (x.key === key ? { ...x, photo: { state: 'working' } } : x)))
    try {
      const img = await compressImage(file, {
        maxEdge: MAX_EDGE,
        stamp: [...stampBase, `${row.card}${row.supplier ? ' · ' + supName(row.supplier) : ''}`],
      })
      setRows((p) =>
        p.map((x) => (x.key === key ? { ...x, photo: { state: 'working', img } } : x)),
      )
      const res = await uploadEvidence(img.blob, `break-${row.card}-${key}.webp`, 'break')
      setRows((p) =>
        p.map((x) =>
          x.key === key
            ? {
                ...x,
                photo: {
                  state: 'done',
                  img,
                  fileId: res.fileId,
                  webLink: res.webViewLink,
                  bytes: res.bytes,
                },
              }
            : x,
        ),
      )
    } catch (e) {
      const msg = readableError(e)
      setRows((p) =>
        p.map((x) =>
          x.key === key ? { ...x, photo: { ...(x.photo ?? {}), state: 'failed', error: msg } } : x,
        ),
      )
    }
  }

  /** กดบัตรบนกระดาน · ยังไม่มีในรายการก็เพิ่ม มีแล้วก็เอาออก */
  function tapCard(code: string) {
    if (picked.has(code)) {
      setRows((p) => p.filter((r) => r.card !== code))
      return
    }
    setRows((p) => [
      ...p,
      {
        key: newKey(),
        card: code,
        /* ซัพจำจากแถวก่อนหน้า · ปล่อยทั้งกลุ่มจากซัพเดียวกันคือกรณีปกติ */
        supplier: p.length > 0 ? p[p.length - 1].supplier : null,
        minutes: null,
        reason: null,
        nickname: '',
        photo: null,
      },
    ])
  }

  /**
   * แถวเกิดจากการกดบัตรบนกระดาน ไม่ได้เติมเองอัตโนมัติ
   *
   * ของเดิมมีที่เลือกบัตรสองชุด · กระดานข้างบนกับชีตในแต่ละแถว
   * หัวหน้าจึงไม่รู้ว่าต้องกดอันไหน และรู้สึกว่าของเก่ากับของใหม่ปนกัน
   * ตอนนี้เหลือชุดเดียว · กดบัตรบนกระดาน = เพิ่มคน กดซ้ำ = เอาออก
   */
  const set = (key: string, patch: Partial<Row>) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const rowReady = (r: Row) => {
    return r.photo?.state === 'done' && (!supOn || Boolean(r.supplier))
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
      if (notReady.photo?.state === 'failed') return `แถว ${i} · รูปส่งไม่สำเร็จ แตะที่รูปแล้วถ่ายใหม่`
      if (notReady.photo?.state === 'working') return `แถว ${i} · กำลังส่งรูป ถ่ายคนต่อไปได้เลย ไม่ต้องรอ`
      /* บอกให้ครบทีเดียวว่าขาดอะไรบ้าง ไม่ใช่แก้อันหนึ่งแล้วค่อยรู้ว่ายังขาดอีกอัน */
      const miss: string[] = []
      if (supOn && !notReady.supplier) miss.push('ยังไม่ได้เลือกซัพ')
      if (notReady.photo?.state !== 'done') miss.push('ยังไม่มีรูป')
      return `แถว ${i} · ${miss.join(' และ ')}`
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
          photos: [
            {
              file_id: r.photo?.fileId as string,
              web_link: r.photo?.webLink ?? null,
              bytes: r.photo?.bytes ?? null,
            },
          ],
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


  return (
    <section className="mb-4">
      {/* ───────── เหลือสิทธิ์เท่าไหร่ ─────────
          ต้องเห็นก่อนเริ่มถ่าย ไม่ใช่รู้ตอนกดส่งแล้วเกิน
          บัตรว่างก็ต้องบอก เพราะใบละคนแปลว่าบัตรคือเพดานจริงอีกตัว */}
      <div className="mb-2 flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2">
        <span className="font-display text-xl font-bold leading-none">
          {roomLeft === Infinity ? '—' : roomLeft}
        </span>
        <span className="text-[10px] leading-tight text-ink-500">
          เหลือ
          <br />
          สิทธิ์
        </span>
        <span className="flex-1 text-[11px] leading-tight text-ink-500">
          <b className="font-display">{grp?.group_name || grp?.group_code}</b>
          {rows.length > 0 && ` · กำลังจะปล่อย ${rows.length} คน`}
          <br />
          บัตรว่าง {freeCards.length} ใบ
          {rows.length > 0 && roomLeft !== Infinity && ` · เหลือหลังปล่อย ${Math.max(0, roomLeft - rows.length)} คน`}
        </span>
      </div>

      {/* ───────── กระดานบัตร · แตะเพื่อเพิ่มคน ─────────
          ที่เลือกบัตรมีชุดเดียวในหน้านี้ ไม่มีซ้อนกันสองที่
          แตะใบไหน = เพิ่มคนนั้น แตะซ้ำ = เอาออก เห็นทั้งแผนกในตาเดียว */}
      {board.map(([g, arr]) => {
        const off = Boolean(lockGrp) && g !== lockGrp
        return (
          <section key={g} className={`mb-3 ${off ? 'opacity-40' : ''}`}>
            <p className="mb-1 text-[11px] font-semibold text-ink-500">
              {arr[0].group_name ? `${g} · ${arr[0].group_name}` : g}
              {off && <span className="ml-1 font-normal">· ปล่อยรวดเดียวต้องแผนกเดียวกัน</span>}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {arr.map((c) => {
                const on = picked.has(c.code)
                const no = c.busy || off || (!on && rows.length >= roomLeft)
                return (
                  <button
                    key={c.code}
                    type="button"
                    disabled={no}
                    onClick={() => tapCard(c.code)}
                    className={`h-tap rounded-btn border px-2 font-mono text-[13px] font-bold ${
                      on
                        ? 'border-ink bg-ink text-white'
                        : c.busy
                          ? 'border-line bg-ink/5 text-ink-400'
                          : 'border-line bg-surface text-ink-700'
                    }`}
                  >
                    {on ? '✓ ' : ''}
                    {c.code}
                    <span className={`block font-sans text-[9px] font-normal ${on ? 'text-white/70' : 'text-ink-400'}`}>
                      {c.busy ? 'ยังไม่กลับ' : on ? 'เพิ่มแล้ว' : 'ว่าง'}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

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
          const up = r.photo?.state === 'working'
          const bad = r.photo?.state === 'failed'
          const has = Boolean(r.photo)
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
                <span className="font-mono text-sm font-bold">{r.card}</span>
                {/* ชื่อเล่นอยู่ในบรรทัดหัวแถว ไม่ได้เพิ่มความสูงให้แถว
                    ไม่บังคับเหมือนเดิม · ใบละคนแล้วช่องนี้มีประโยชน์ขึ้นเยอะ */}
                <input
                  className="min-w-0 flex-1 border-0 bg-transparent px-1 text-[12.5px] outline-none placeholder:text-ink-300"
                  placeholder="ชื่อเล่น"
                  value={r.nickname}
                  onChange={(e) => set(r.key, { nickname: e.target.value })}
                />
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

                {/* แตะครั้งเดียวเปิดกล้องเลย ไม่มีกล่องคั่น · ได้รูปแล้วขึ้นในช่องนี้ทันที
                    รูปเล็ก ๆ ในช่องคือรูปที่เพิ่งถ่าย ไม่ได้ดึงกลับจาก Drive */}
                <label
                  className={`relative flex h-14 w-14 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 overflow-hidden rounded-btn text-[9px] ${
                    has
                      ? 'border border-line-2 bg-ink/5'
                      : 'border border-dashed border-danger bg-danger-bg text-danger-txt'
                  }`}
                >
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void shoot(r.key, file)
                    }}
                  />
                  {r.photo?.img?.objectUrl && (
                    <img
                      src={r.photo.img.objectUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  {has ? (
                    <span
                      className={`relative rounded-pill px-[5px] text-[9px] font-bold ${
                        bad ? 'bg-danger text-white' : up ? 'bg-warn text-ink' : 'bg-success text-white'
                      }`}
                    >
                      {bad ? 'ลองใหม่' : up ? 'กำลังส่ง' : 'ส่งแล้ว'}
                    </span>
                  ) : (
                    <>
                      <span className="text-lg leading-none">📷</span>
                      <span>ถ่าย</span>
                    </>
                  )}
                </label>
              </div>
            </div>
          )
        })}
      </div>

      {rows.length === 0 && (
        <p className="rounded-card border border-dashed border-line-2 py-4 text-center text-sm text-ink-400">
          แตะบัตรข้างบนเพื่อเพิ่มคน
        </p>
      )}

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

    </section>
  )
}
