import { useEffect, useState } from 'react'
import { STAGE_COLOR, STAGE_PUSH, STAGE_TH, previewAll, stageOf, type Stage } from './alarm'
import { hm, KindTag, p2 } from './parts'

/**
 * ของที่ใช้เตือนด้วยตา — คู่กับเสียงใน alarm.ts
 *
 * เตือนด้วยเสียงอย่างเดียวไม่พอ คลังเสียงดังและคนใส่หูฟังกันเยอะ
 * เตือนด้วยตาอย่างเดียวก็ไม่พอ เพราะไม่มีใครมองจอตลอดเวลา
 * สองอย่างนี้จึงต้องมาคู่กันเสมอ และต้องพูดเรื่องเดียวกันในจังหวะเดียวกัน
 */

/** กระดิ่งสั่น · ขยับเฉพาะตัวที่กำลังเตือนจริง ที่เหลือนิ่ง */
export function Bell({ size = 20, color = '#FFC400', ring = true }: { size?: number; color?: string; ring?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{
        animation: ring ? 'bplBell .9s ease-in-out infinite' : undefined,
        transformOrigin: '50% 10%',
        flexShrink: 0,
      }}
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

/**
 * กล่องบังคับถามตอนเข้าหน้า
 *
 * ไม่ได้ตั้งใจจะกวน แต่เบราว์เซอร์ไม่ยอมให้เล่นเสียงจนกว่าจะมีคนแตะจอ
 * ถ้าไม่ถาม จอจะเงียบสนิททั้งกะโดยที่ไม่มีใครรู้ว่าเสียงไม่ทำงาน
 * ซึ่งแย่กว่าการไม่มีเสียงตั้งแต่แรก เพราะคนจะเผลอไว้ใจว่ามีเสียงคอยเตือนให้
 */
export function AlarmGate({
  open,
  onEnable,
  onSkip,
}: {
  open: boolean
  onEnable: () => void
  onSkip: () => void
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(0,0,0,.78)' }}
    >
      <div
        className="w-full max-w-[460px] rounded-2xl p-6 text-center"
        style={{ background: '#141B24', border: '2px solid #FFC400' }}
      >
        <div className="mb-3 flex justify-center">
          <Bell size={54} />
        </div>
        <p className="text-xl font-extrabold">เปิดเสียงเตือนรถก่อนเริ่มงาน</p>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: '#AFC0D4' }}>
          เบราว์เซอร์ไม่ยอมให้เล่นเสียงจนกว่าจะมีคนแตะจอหนึ่งครั้ง
          <br />
          ถ้าไม่กด จอนี้จะเงียบทั้งกะโดยที่ไม่มีใครรู้ว่าเสียงไม่ทำงาน
        </p>

        <div className="mt-4 space-y-2 text-left">
          {(['m20', 'm10', 'late'] as Stage[]).map((s) => (
            <div
              key={s}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{ background: '#0F141B', borderLeft: `4px solid ${STAGE_COLOR[s]}` }}
            >
              <Bell size={18} color={STAGE_COLOR[s]} ring={false} />
              <span className="flex-1 text-sm font-bold">{STAGE_TH[s]}</span>
              <span className="text-xs" style={{ color: '#AFC0D4' }}>
                {s === 'm20' ? 'เสียงต่ำ สองที' : s === 'm10' ? 'เสียงแหลม สี่ที' : 'เสียงนาฬิกาปลุก'}
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="mt-5 h-tap w-full rounded-lg text-lg font-extrabold"
          style={{ background: '#FFC400', color: '#0B0E11' }}
          onClick={onEnable}
        >
          เปิดเสียงเตือน
        </button>
        <button
          type="button"
          className="mt-2 h-tap w-full rounded-lg text-sm font-bold"
          style={{ background: '#1B2430', color: '#AFC0D4' }}
          onClick={onSkip}
        >
          ไม่เอาเสียง · ดูด้วยตาอย่างเดียว
        </button>
      </div>
    </div>
  )
}

/** ปุ่มเล็กไว้ลองฟังทั้งสามเสียง · อยู่บนแถบควบคุม */
export function AlarmChip({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="h-tap flex items-center gap-2 rounded-lg px-4 text-base font-bold"
      style={{ background: on ? '#1B2430' : '#3A2A14', color: on ? '#AFC0D4' : '#FFC400' }}
      onClick={() => {
        if (on) previewAll()
        else onClick()
      }}
    >
      <Bell size={18} color={on ? '#35D98A' : '#FFC400'} ring={!on} />
      {on ? 'เสียงเตือนเปิดอยู่ · กดฟังตัวอย่าง' : 'เสียงเตือนปิดอยู่ · กดเปิด'}
    </button>
  )
}

/**
 * แถบเร่งด่วนของจอทีวี
 *
 * ตัวนับถอยหลังบอกว่า "เหลือเท่าไหร่" ซึ่งต้องอ่านเลขแล้วแปลเป็นความรู้สึกเอง
 * แถบนี้บอกตรง ๆ ว่า "ต้องทำอะไรตอนนี้" ซึ่งไม่ต้องแปล
 *
 * แถบที่ค่อย ๆ หดบอกความเร่งด่วนได้เร็วกว่าตัวเลข เพราะตามองเห็นของที่สั้นลง
 * ตั้งแต่ยังอ่านไม่ทัน · และเห็นได้จากหางตา ไม่ต้องหันไปจ้อง
 */
/**
 * แถบเร่งด่วน · ไม่ซ่อนคันไหนเลย
 *
 * วิธีรับมือเมื่อของเยอะคือย่อก่อน แล้วค่อยหมุน ไม่ใช่ตัดทิ้ง
 * ย่อก่อนเพราะของที่เล็กลงยังอยู่บนจอ ส่วนของที่ถูกตัดคือของที่ไม่มีใครเห็นเลย
 * เกินหนึ่งหน้าแล้วค่อยหมุน และบอกไว้ว่าหน้าที่เท่าไหร่จากกี่หน้า
 * จะได้ไม่มีใครยืนรอของที่เพิ่งผ่านไปโดยไม่รู้ว่าต้องรออีกนานแค่ไหน
 */
export function UrgentRail({
  items,
  big = false,
  onPick,
  rotateMs = 7000,
}: {
  items: {
    id: number
    code: string | null
    name: string
    due: string
    sec: number
    zone?: string | null
    tag?: string
  }[]
  big?: boolean
  onPick?: (id: number) => void
  rotateMs?: number
}) {
  const all = items.filter((x) => stageOf(x.sec) !== null).sort((a, b) => a.sec - b.sec)
  const PER = big ? 12 : 8
  const pages = Math.max(1, Math.ceil(all.length / PER))
  const [pg, setPg] = useState(0)
  useEffect(() => {
    if (pages <= 1) {
      setPg(0)
      return
    }
    const t = setInterval(() => setPg((p) => (p + 1) % pages), rotateMs)
    return () => clearInterval(t)
  }, [pages, rotateMs])

  if (all.length === 0) return null
  const list = all.slice(pg * PER, pg * PER + PER)
  // ย่อเมื่อเยอะ · การ์ดใหญ่มีค่าเฉพาะตอนมีไม่กี่ใบ
  const dense = all.length > (big ? 4 : 3)
  const cols = dense
    ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : all.length > 1
      ? 'md:grid-cols-2 xl:grid-cols-3'
      : ''

  return (
    <>
      {pages > 1 && (
        <div className="mb-2 flex items-center gap-2 text-sm" style={{ color: '#AFC0D4' }}>
          <Bell size={16} color="#FF5C5C" />
          <b style={{ color: '#FF5C5C' }}>{all.length} คัน</b> ที่ต้องเร่ง · หมุนโชว์หน้า {pg + 1} จาก{' '}
          {pages}
          <span className="flex gap-1">
            {Array.from({ length: pages }, (_, i) => (
              <span
                key={i}
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: i === pg ? '#FFC400' : '#2A313B' }}
              />
            ))}
          </span>
        </div>
      )}
      <div className={`grid gap-3 ${cols}`}>
      {list.map((x) => {
        const st = stageOf(x.sec) as Stage
        const c = STAGE_COLOR[st]
        const late = st === 'late'
        const bigCard = big && !dense
        // ยี่สิบนาทีสุดท้ายคือความยาวเต็มของแถบ · เลยกำหนดแล้วแถบหมดเกลี้ยง
        const left = Math.max(0, Math.min(1, x.sec / (20 * 60)))
        const mins = Math.max(0, Math.round(Math.abs(x.sec) / 60))
        return (
          <div
            key={x.id}
            className={`rounded-2xl px-4 py-3 ${onPick ? 'cursor-pointer active:opacity-80' : ''}`}
            role={onPick ? 'button' : undefined}
            tabIndex={onPick ? 0 : undefined}
            onClick={onPick ? () => onPick(x.id) : undefined}
            style={{
              background: late ? 'rgba(255,64,64,.14)' : '#141B24',
              border: `2px solid ${c}`,
              animation: late ? 'bplUrgent 1.1s steps(1,end) infinite' : undefined,
            }}
          >
            <div className="flex items-center gap-2">
              <Bell size={bigCard ? 30 : 20} color={c} />
              <span
                className={`font-extrabold ${bigCard ? 'text-3xl' : 'text-lg'}`}
                style={{ color: c }}
              >
                {STAGE_PUSH[st]}
              </span>
              <span className="flex-1" />
              <span
                className={`font-mono font-extrabold ${bigCard ? 'text-3xl' : 'text-lg'}`}
                style={{ color: c }}
              >
                {late ? `เลย ${mins} นาที` : `${mins} นาที`}
              </span>
            </div>

            <div className={`mt-1 flex flex-wrap items-baseline gap-x-2 ${bigCard ? 'text-3xl' : 'text-xl'}`}>
              {x.zone && (
                <span
                  className="rounded-md px-1.5 font-mono text-base font-extrabold"
                  style={{ background: '#1B2430', color: '#7FD1FF' }}
                >
                  {x.zone}
                </span>
              )}
              {x.code && (
                <span className="font-mono font-extrabold" style={{ color: '#FFC400' }}>
                  {x.code}
                </span>
              )}
              <span className="truncate font-extrabold">{x.name}</span>
              <KindTag tag={x.tag} size={bigCard ? 16 : 13} />
            </div>
            <div className="mt-1">
              <span
                className={`rounded-md px-2 py-0.5 font-mono font-extrabold ${bigCard ? 'text-2xl' : 'text-base'}`}
                style={{ background: '#FFC400', color: '#0B0E11' }}
              >
                ต้องออก {hm(new Date(x.due))}
              </span>
            </div>

            <div
              className="mt-2 overflow-hidden rounded-full"
              style={{ height: bigCard ? 14 : 8, background: '#0B0E11' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${left * 100}%`, background: c, transition: 'width 1s linear' }}
              />
            </div>
          </div>
        )
      })}
      </div>
    </>
  )
}

/**
 * ขอบจอเรืองแดงเมื่อมีรถเลยกำหนด
 *
 * คนในคลังไม่ได้จ้องจอ แต่หางตาจับ "ทั้งจอเปลี่ยนสี" ได้ไวกว่าตัวเลขที่เปลี่ยนมุมเดียว
 * นี่คือสิ่งเดียวบนหน้านี้ที่มองเห็นได้จากอีกฝั่งของคลังโดยไม่ต้องอ่านอะไรเลย
 */
export function EdgeGlow({ stage }: { stage: Stage | null }) {
  if (!stage || stage === 'm20') return null
  const c = STAGE_COLOR[stage]
  return (
    <div
      className="pointer-events-none fixed inset-0 z-30"
      style={{
        boxShadow: `inset 0 0 0 10px ${c}`,
        animation: `bplEdge ${stage === 'late' ? '1.1s' : '1.8s'} ease-in-out infinite`,
      }}
      aria-hidden
    />
  )
}

/** ขั้นที่หนักที่สุดในรายการ · ใช้ตัดสินว่าขอบจอต้องเรืองสีอะไร */
export function worstStage(items: { sec: number }[]): Stage | null {
  let w: Stage | null = null
  const rank: Record<Stage, number> = { m20: 1, m10: 2, late: 3 }
  for (const it of items) {
    const s = stageOf(it.sec)
    if (s && (!w || rank[s] > rank[w])) w = s
  }
  return w
}

/** บรรทัดสรุปสั้น ๆ ว่ามีกี่คันในแต่ละขั้น · ใช้บนกระดาน */
export function StageSummary({ items }: { items: { sec: number }[] }) {
  const n: Record<Stage, number> = { m20: 0, m10: 0, late: 0 }
  items.forEach((x) => {
    const s = stageOf(x.sec)
    if (s) n[s] += 1
  })
  const any = n.m20 + n.m10 + n.late
  if (any === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(['late', 'm10', 'm20'] as Stage[]).map((s) =>
        n[s] > 0 ? (
          <span
            key={s}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold"
            style={{ background: `${STAGE_COLOR[s]}22`, color: STAGE_COLOR[s] }}
          >
            <Bell size={15} color={STAGE_COLOR[s]} ring={s !== 'm20'} />
            {STAGE_TH[s]} {n[s]} คัน
          </span>
        ) : null,
      )}
    </div>
  )
}

/** นาฬิกาแบบสั้นไว้ใช้ในข้อความ */
export function mmss(sec: number) {
  const a = Math.abs(sec)
  return `${p2(Math.floor(a / 60))}:${p2(a % 60)}`
}
