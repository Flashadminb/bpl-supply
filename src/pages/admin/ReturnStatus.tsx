import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { deleteAssetTxns, deleteRequisitions, listReturnCards } from '../../lib/api'
import { BulkDeleteBar, PickBox } from '../../components/BulkDeleteBar'
import { TextHistory } from '../../components/TextHistory'
import { EmptyState, ErrorBox, Loading, Modal } from '../../components/ui'
import { EvidenceImg, ThumbStrip } from '../../components/EvidenceThumbs'
import { DateRangePicker } from '../../components/DateRangePicker'
import { fmtDateTime } from '../../lib/format'
import type { CardEvent, CardItem, ReturnCard } from '../../lib/types'

/**
 * สถานะเบิก-คืน — หนึ่งการกดส่งคือหนึ่งการ์ด
 *
 * หน่วยของการ์ดคือ "การกดส่งหนึ่งครั้ง" ไม่ใช่ "รายการ"
 * คนเดียวกดเบิกทีเดียวได้ 3 เครื่อง ต้องอยู่การ์ดเดียวกัน ไม่ใช่แตกเป็น 3 แถว
 * เพราะเวลาตามของจริง คนตามเป็นชุด ไม่ได้ตามทีละชิ้น
 *
 * แต่เบิกเที่ยงแล้วมาเบิกเพิ่มบ่าย ต้องเป็นคนละการ์ด
 * ไม่งั้นยอดค้างจะปนกันจนตามไม่ถูกว่าค้างของก้อนไหน และรูปจะชี้ผิดก้อน
 *
 * ในการ์ดเรียงลงมา: หัวใบ → ยอดรวม → แยกตามประเภท (รูปแยกกัน) → การคืนแต่ละครั้ง
 *
 * หน้านี้ไม่เกี่ยวกับการส่งออก Google Sheet — ชีตยังอ่านจากตารางดิบเหมือนเดิม
 */

type Tab = 'supply' | 'asset'

function dayKey(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
}

const ITEM_STATE: Record<CardItem['state'], { text: string; cls: string; dot: string }> = {
  consumed: { text: 'ไม่ต้องคืน', cls: 'text-ink-400', dot: 'bg-line-2' },
  open: { text: 'ยังไม่คืน', cls: 'text-danger-txt', dot: 'bg-danger' },
  partial: { text: 'คืนบางส่วน', cls: 'text-warn-txt', dot: 'bg-warn' },
  returned: { text: 'คืนแล้ว', cls: 'text-success-txt', dot: 'bg-success' },
  transferred: { text: 'โอนไปแล้ว ไม่ต้องคืน', cls: 'text-warn-txt', dot: 'bg-warn' },
  forced: { text: 'ปิดโดยแอดมิน', cls: 'text-warn-txt', dot: 'bg-warn' },
}

const COND_TH: Record<string, string> = {
  ok: 'สภาพดี',
  damaged: 'ชำรุด',
  lost: 'สูญหาย',
  transfer: 'โอนให้คนอื่น',
  forced: 'ปิดโดยแอดมิน ไม่มีรูป',
}

/**
 * ก้อนย่อยในการ์ด — หนึ่งประเภทอุปกรณ์ พร้อมรูปของประเภทนั้นเอง
 *
 * รูปต้องแยกตามประเภท ไม่ใช่กองรวม เพราะจำนวนรูปบังคับไม่เท่ากัน
 * Power Pallet ห้าใบตามขั้นตอน กุญแจ/หน้า/หลัง/ซ้าย/ขวา ส่วนวิทยุใบเดียว
 * ถ้ากองรวมจะไม่รู้ว่ารูปไหนของประเภทไหน ซึ่งพังตรงจุดที่เอาไปใช้จริง
 */
interface CardGroup {
  name: string
  items: CardItem[]
  photos: string[]
}

interface Merged {
  key: string
  kind: 'supply' | 'asset'
  /** รหัสใบจริงในฐานข้อมูล · การ์ดหนึ่งใบอาจมาจากหลายใบถ้าเบิกข้ามประเภทรอบเดียว */
  ids: string[]
  refs: string[]
  taken_at: string
  who: string
  employee_code: string
  dept_code: string | null
  shift_start: string | null
  shift_end: string | null
  groups: CardGroup[]
  items: CardItem[]
  events: CardEvent[]
}

/**
 * รวมใบที่มาจากการกดส่งครั้งเดียวกัน
 *
 * ตอนนี้เบิกได้ทีละประเภท ใบหนึ่งจึงเป็นการ์ดหนึ่งตรง ๆ
 * แต่ถ้าเปิดให้เบิกข้ามประเภทในรอบเดียวเมื่อไหร่ เบื้องหลังจะออกใบแยกตามประเภท
 * ตัวรวมนี้จะจับกลับมาเป็นการ์ดเดียวให้เอง เพราะคนกดรู้สึกว่ากดครั้งเดียว
 *
 * กุญแจคือ "คนเดียวกัน + เวลาเดียวกันเป๊ะ" ไม่ใช่วันเดียวกัน
 */
function mergeCards(rows: ReturnCard[]): Merged[] {
  const out = new Map<string, Merged>()
  for (const c of rows) {
    const key = `${c.kind}|${c.user_id}|${c.taken_at}`
    const name = c.kind === 'asset' ? (c.items[0]?.sub ?? 'อุปกรณ์') : ''
    const cur = out.get(key)
    if (cur) {
      cur.ids.push(c.card_id)
      cur.refs.push(c.ref_no)
      cur.groups.push({ name, items: c.items, photos: c.out_file_ids })
      cur.items.push(...c.items)
      cur.events.push(...c.events)
    } else {
      out.set(key, {
        key,
        kind: c.kind,
        ids: [c.card_id],
        refs: [c.ref_no],
        taken_at: c.taken_at,
        who: c.who,
        employee_code: c.employee_code,
        dept_code: c.dept_code,
        shift_start: c.shift_start,
        shift_end: c.shift_end,
        groups: [{ name, items: c.items, photos: c.out_file_ids }],
        items: [...c.items],
        events: [...c.events],
      })
    }
  }
  for (const m of out.values()) {
    m.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  }
  return [...out.values()]
}

/**
 * กะของใบนี้เป็นข้อความสั้น ๆ · ว่าง = ตอนเบิกคนนั้นยังไม่ได้ตั้งกะไว้
 *
 * กะถูกคัดลอกลงใบตั้งแต่ตอนเบิก ไม่ได้ join สดกับโปรไฟล์
 * ตัวเลือกในดรอปดาวน์จึงต้องสร้างจากใบที่โหลดมาจริง ไม่ใช่จากตารางกะ
 * ไม่งั้นจะมีกะที่เลือกแล้วว่างเปล่าให้กดอยู่เต็มไปหมด
 */
function shiftOf(c: { shift_start: string | null; shift_end: string | null }): string {
  if (!c.shift_start || !c.shift_end) return ''
  return `${c.shift_start.slice(0, 5)}–${c.shift_end.slice(0, 5)}`
}

/** สรุปทั้งใบ — นับเฉพาะของที่ต้องคืนจริง ตัวที่โอนไปแล้วไม่ใช่ภาระของคนนี้ */
function summarise(c: { items: CardItem[] }) {
  const need = c.items.reduce((n, i) => n + i.need, 0)
  const back = c.items.reduce((n, i) => n + Math.min(i.returned, i.need), 0)
  const open = Math.max(need - back, 0)
  const moved = c.items.some((i) => i.state === 'transferred')

  if (need === 0) {
    return { open: 0, text: moved ? 'โอนไปแล้ว' : 'ไม่ต้องคืน', cls: 'badge-mute', done: true }
  }
  if (open === 0) return { open: 0, text: 'คืนครบแล้ว', cls: 'badge-ok', done: true }
  return { open, text: `ค้าง ${open} จาก ${need}`, cls: 'badge-warn', done: false }
}

export default function ReturnStatus() {
  const [tab, setTab] = useState<Tab>('asset')
  const [from, setFrom] = useState(dayKey(-14))
  const [to, setTo] = useState(dayKey(0))
  const [search, setSearch] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // เลือกหลายใบเพื่อลบทีเดียว · เก็บเป็น key ของการ์ด แล้วค่อยแตกเป็นรหัสใบตอนลบ
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [showHistory, setShowHistory] = useState(false)
  const [dept, setDept] = useState('')
  const [shift, setShift] = useState('')
  const [view, setView] = useState<{ ids: string[]; at: number; title: string } | null>(null)

  const feed = useAsync(
    // ปลายช่วงต้องกินถึงสิ้นวัน ไม่งั้นของที่เบิกวันนี้จะไม่ติดมาด้วย
    () => listReturnCards({ kind: tab, fromISO: from, toISO: `${to}T23:59:59.999`, limit: 300 }),
    [tab, from, to],
  )

  // ตัวเลือกสร้างจากใบที่โหลดมาจริง · เปลี่ยนช่วงวันแล้วตัวเลือกเปลี่ยนตาม
  const merged = useMemo(() => mergeCards(feed.data ?? []), [feed.data])
  const deptOptions = useMemo(
    () => [...new Set(merged.map((c) => c.dept_code).filter(Boolean) as string[])].sort(),
    [merged],
  )
  const shiftOptions = useMemo(
    () => [...new Set(merged.map(shiftOf).filter(Boolean))].sort(),
    [merged],
  )

  const cards = useMemo(() => {
    const s = search.trim().toLowerCase()
    return merged
      .map((c) => ({ c, sum: summarise(c) }))
      .filter(({ c, sum }) => {
        if (openOnly && sum.done) return false
        if (dept && c.dept_code !== dept) return false
        if (shift && shiftOf(c) !== shift) return false
        if (!s) return true
        const hay = `${c.refs.join(' ')} ${c.who} ${c.employee_code} ${c.dept_code ?? ''} ${c.items
          .map((i) => `${i.label} ${i.sub ?? ''}`)
          .join(' ')}`
        return hay.toLowerCase().includes(s)
      })
  }, [merged, search, openOnly, dept, shift])

  function isOpen(c: Merged, done: boolean) {
    // ใบที่ยังไม่ครบกางไว้เลย ที่เหลือย่อไว้จนกว่าจะกด
    return expanded[c.key] ?? !done
  }

  function openPhotos(ids: string[], at: number, title: string) {
    if (ids.length === 0) return
    setView({ ids, at, title })
  }

  const unit = tab === 'asset' ? 'เครื่อง' : 'รายการ'
  const allPicked = cards.length > 0 && cards.every(({ c }) => picked.has(c.key))
  const pickedIds = cards.filter(({ c }) => picked.has(c.key)).flatMap(({ c }) => c.ids)

  function toggle(key: string) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function removePicked(why: string) {
    if (tab === 'asset') await deleteAssetTxns(pickedIds, why)
    else await deleteRequisitions(pickedIds, why)
    setPicked(new Set())
    feed.reload()
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">สถานะเบิก-คืน</h1>
        <span className="badge-mute">{cards.length} ใบ</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button
            type="button"
            className={`chip ${tab === 'asset' ? 'chip-on' : ''}`}
            onClick={() => {
              setTab('asset')
              setPicked(new Set())
              setDept('')
              setShift('')
            }}
          >
            อุปกรณ์ Asset
          </button>
          <button
            type="button"
            className={`chip ${tab === 'supply' ? 'chip-on' : ''}`}
            onClick={() => {
              setTab('supply')
              setPicked(new Set())
              setDept('')
              setShift('')
            }}
          >
            วัสดุสิ้นเปลือง
          </button>
        </div>

        <DateRangePicker
          from={from}
          to={to}
          onChange={(a, b) => {
            setFrom(a)
            setTo(b)
          }}
        />
        <input
          className="input max-w-[240px]"
          type="search"
          placeholder="ค้นหาชื่อคน รหัสเครื่อง หรือเลขที่ใบ"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="sr-only" htmlFor="rs-dept">
          แผนก
        </label>
        <select
          id="rs-dept"
          className="input h-tap max-w-[160px]"
          value={dept}
          onChange={(e) => {
            setDept(e.target.value)
            setPicked(new Set())
          }}
        >
          <option value="">ทุกแผนก</option>
          {deptOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="rs-shift">
          กะ
        </label>
        <select
          id="rs-shift"
          className="input h-tap max-w-[160px]"
          value={shift}
          onChange={(e) => {
            setShift(e.target.value)
            setPicked(new Set())
          }}
        >
          <option value="">ทุกกะ</option>
          {shiftOptions.map((v) => (
            <option key={v} value={v}>
              กะ {v}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`chip ${openOnly ? 'chip-on' : ''}`}
          onClick={() => setOpenOnly((v) => !v)}
        >
          เฉพาะที่ยังไม่ครบ
        </button>
        <button
          type="button"
          className={`chip ${showHistory ? 'chip-on' : ''}`}
          onClick={() => setShowHistory((v) => !v)}
        >
          ประวัติที่ลบแล้ว
        </button>
        {cards.length > 0 && !showHistory && (
          <button
            type="button"
            className="chip"
            onClick={() =>
              setPicked(allPicked ? new Set() : new Set(cards.map(({ c }) => c.key)))
            }
          >
            {allPicked ? 'ล้างที่เลือก' : 'เลือกทั้งหมด'}
          </button>
        )}
      </div>

      <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
          คืนแล้ว
        </span>
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-danger" />
          ยังไม่คืน
        </span>
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-warn" />
          โอนไปแล้ว หรือปิดโดยแอดมิน — มีคำอธิบายกำกับ
        </span>
      </p>

      {showHistory ? (
        <TextHistory
          kind={tab}
          fromISO={new Date(`${from}T00:00:00`).toISOString()}
          toISO={new Date(`${to}T23:59:59`).toISOString()}
        />
      ) : (
        <>
      {feed.loading && <Loading />}
      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

      {!feed.loading && cards.length === 0 && (
        <EmptyState
          title="ไม่มีใบเบิกตามตัวกรอง"
          hint="ลองขยายช่วงวันที่ ล้างคำค้น หรือเลือกทุกแผนกกับทุกกะ"
        />
      )}

      <BulkDeleteBar
        n={picked.size}
        noun="ใบ"
        confirmLabel={`ลบ ${picked.size} ใบ`}
        warning={
          tab === 'asset' ? (
            <>
              ใบเบิกและใบคืนของเครื่องที่เลือกจะหายถาวร
              <br />
              เครื่องที่ยังไม่ได้คืนจะกลับมาเป็นเครื่องว่าง ส่วนเครื่องที่คืนไปแล้วจะกลับไปขึ้นว่าอยู่ในมือคนเดิม
            </>
          ) : (
            <>
              ใบเบิกวัสดุที่เลือกจะหายถาวร
              <br />
              ของที่ตัดสต็อกไปจะถูกบวกคืนให้อัตโนมัติ เฉพาะส่วนที่ยังไม่ได้คืนเข้ามา
            </>
          )
        }
        onClear={() => setPicked(new Set())}
        onDelete={removePicked}
      />

      <div className="space-y-3">
        {cards.map(({ c, sum }) => {
          const on = isOpen(c, sum.done)
          return (
            <section key={c.key} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <PickBox
                  on={picked.has(c.key)}
                  label={`เลือกใบ ${c.refs.join(' ')}`}
                  onToggle={() => toggle(c.key)}
                />
                <span className="font-mono text-xs text-ink-400">{c.refs.join(' · ')}</span>
              </div>
              {/* ---------------------------------------------------- หัวใบ */}
              <button
                type="button"
                className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
                onClick={() => setExpanded((v) => ({ ...v, [c.key]: !on }))}
              >
                <span className="min-w-0">
                  <span className="font-display text-base">{c.who}</span>
                  <span className="block text-sm text-ink-500">
                    {c.employee_code}
                    {c.dept_code ? ` · ${c.dept_code}` : ''}
                    {c.shift_start && c.shift_end
                      ? ` · กะ ${c.shift_start.slice(0, 5)}–${c.shift_end.slice(0, 5)}`
                      : ''}
                  </span>
                  <span className="block text-sm text-ink-400">
                    เบิกเมื่อ {fmtDateTime(c.taken_at)}
                  </span>
                  <span className="block font-mono text-xs text-ink-400">{c.refs.join(' · ')}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={sum.cls}>{sum.text}</span>
                  <span aria-hidden className="text-ink-400">
                    {on ? '▾' : '▸'}
                  </span>
                </span>
              </button>

              {/* ยอดรวมต้องเห็นตั้งแต่ยังไม่กาง เป็นคำถามแรกที่คนถามเสมอ */}
              <p className="mt-2 rounded-btn bg-brand-50 px-3 py-2 text-sm text-ink-700">
                เบิกไปทั้งหมด{' '}
                <b>
                  {c.items.length} {unit}
                </b>
                {c.kind === 'asset' && c.groups.length > 1 ? ` · ${c.groups.length} ประเภท` : ''}
              </p>

              {on && (
                <>
                  {/* -------------------------------- แยกตามประเภท รูปแยกกัน */}
                  {c.groups.map((g, gi) => (
                    <div key={`${g.name}-${gi}`} className="mt-3 border-t border-line pt-3">
                      {g.name && (
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-display text-base">{g.name}</p>
                          <span className="text-sm text-ink-500">{g.items.length} เครื่อง</span>
                        </div>
                      )}

                      {/* เคสปกติ (คืนแล้ว / ยังไม่คืน) ยุบเป็นชิปเรียงต่อกัน
                          จุดสีบอกสถานะครบแล้ว ไม่ต้องเขียนคำซ้ำทุกบรรทัด
                          11 เครื่องเคยกิน 11 บรรทัด ตอนนี้เหลือสองสามบรรทัด */}
                      {(() => {
                        const plain = g.items.filter(
                          (i) => i.state === 'returned' || i.state === 'open',
                        )
                        // เคสพิเศษต้องมีคำอธิบาย ไม่งั้นจุดสีเหลืองอ่านไม่ออกว่าเกิดอะไร
                        const odd = g.items.filter(
                          (i) => i.state !== 'returned' && i.state !== 'open',
                        )
                        return (
                          <>
                            {plain.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                {plain.map((it, n) => {
                                  const st = ITEM_STATE[it.state]
                                  return (
                                    <span
                                      key={`${it.label}-${n}`}
                                      className="flex items-center gap-[6px]"
                                      title={st.text}
                                    >
                                      <span
                                        aria-hidden
                                        className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`}
                                      />
                                      <span className={`font-mono text-sm ${st.cls}`}>
                                        {it.label}
                                      </span>
                                    </span>
                                  )
                                })}
                              </div>
                            )}

                            {odd.length > 0 && (
                              <ul className="mt-1">
                                {odd.map((it, n) => {
                                  const st = ITEM_STATE[it.state]
                                  return (
                                    <li
                                      key={`${it.label}-${n}`}
                                      className="flex items-start gap-2 py-[3px]"
                                    >
                                      <span
                                        aria-hidden
                                        className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${st.dot}`}
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="font-mono text-sm">{it.label}</span>
                                        {c.kind === 'supply' && it.sub && (
                                          <span className="text-ink-400"> · {it.sub}</span>
                                        )}
                                        {it.note && (
                                          <span className="block text-xs text-ink-500">
                                            {it.note}
                                          </span>
                                        )}
                                      </span>
                                      <span className="shrink-0 text-right">
                                        <span className={`text-sm ${st.cls}`}>{st.text}</span>
                                        {c.kind === 'supply' && it.state !== 'consumed' && (
                                          <span className="block text-xs text-ink-400">
                                            เบิก {it.taken} · คืน {it.returned} {it.unit}
                                          </span>
                                        )}
                                      </span>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </>
                        )
                      })()}

                      {g.photos.length > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <ThumbStrip
                            fileIds={g.photos}
                            onOpen={(i) =>
                              openPhotos(
                                g.photos,
                                i,
                                `${g.name || 'ตอนเบิก'} · ${c.who} · ${fmtDateTime(c.taken_at)}`,
                              )
                            }
                          />
                          <span className="text-xs text-ink-400">
                            รูปตอนเบิก {g.photos.length} ใบ
                            {g.photos.length > 1 ? ' · ชี้ที่รูปเพื่อดูให้ครบ' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* ---------------------------------------------- การคืน */}
                  <div className="mt-4 border-l-2 border-line-2 pl-3">
                    <p className="mb-1 font-display text-base">
                      {c.events.length === 0 ? 'ยังไม่มีการคืน' : `การคืน ${c.events.length} ครั้ง`}
                    </p>

                    <ul className="space-y-3">
                      {c.events.map((ev, n) => (
                        <li key={`${ev.at}-${n}`}>
                          <p className="text-base">
                            {fmtDateTime(ev.at)}
                            {ev.by ? ` · ${ev.by}` : ''}
                          </p>
                          <p className="font-mono text-sm text-ink-500">{ev.detail}</p>
                          {ev.cond && ev.cond !== 'ok' && (
                            <p className="text-sm text-warn-txt">{COND_TH[ev.cond] ?? ev.cond}</p>
                          )}
                          {ev.file_ids.length > 0 && (
                            <div className="mt-1 flex items-center gap-2">
                              <ThumbStrip
                                fileIds={ev.file_ids}
                                onOpen={(i) =>
                                  openPhotos(ev.file_ids, i, `คืน ${fmtDateTime(ev.at)} · ${c.who}`)
                                }
                              />
                              <span className="text-xs text-ink-400">
                                รูปตอนคืน {ev.file_ids.length} ใบ
                              </span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>

                    {sum.open > 0 && (
                      <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">
                        ยังต้องตามคืนอีก {sum.open} {tab === 'asset' ? 'เครื่อง' : 'ชิ้น'}
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          )
        })}
      </div>
        </>
      )}

      {/* ------------------------------------------------------ ดูรูปใหญ่ */}
      <Modal open={Boolean(view)} onClose={() => setView(null)} title={view?.title ?? ''}>
        {view && (
          <>
            <EvidenceImg
              fileId={view.ids[view.at]}
              enabled
              className="flex max-h-[70vh] w-full items-center justify-center overflow-hidden rounded-card bg-dark"
              alt={view.title}
            />
            {view.ids.length > 1 && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="btn-soft h-tap px-3"
                  disabled={view.at === 0}
                  onClick={() => setView({ ...view, at: view.at - 1 })}
                >
                  ← ก่อนหน้า
                </button>
                <span className="text-sm text-ink-500">
                  ใบที่ {view.at + 1} จาก {view.ids.length}
                </span>
                <button
                  type="button"
                  className="btn-soft h-tap px-3"
                  disabled={view.at === view.ids.length - 1}
                  onClick={() => setView({ ...view, at: view.at + 1 })}
                >
                  ถัดไป →
                </button>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
