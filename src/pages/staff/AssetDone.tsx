import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { StaffPage } from '../../components/Shell'
import { fmtDateTime } from '../../lib/format'
import type { AssetIssueInput } from '../../lib/types'
import { deptSuffix } from '../../lib/deptNames'

/**
 * ใบสรุปหลังเบิกหรือคืนสำเร็จ
 *
 * หน้านี้มีหน้าที่เดียวคือให้พนักงานแคปหน้าจอส่งให้แอดมิน
 * ทุกอย่างจึงต้องจบในหน้าจอเดียวแม้เบิกหลายชนิดพร้อมกัน
 * ถ้าต้องเลื่อนลงไปแคปสองรอบ คนจะส่งมาแค่รอบเดียวแล้วข้อมูลจะหายครึ่ง
 *
 * วิธีที่ใช้คือย่อขนาดชิปตามจำนวนเครื่อง ไม่ใช่ตัดรายการทิ้ง
 * เพราะรหัสเครื่องที่หายไปหนึ่งตัวคือเครื่องที่ไม่มีใครตามกลับ
 *
 * ห้ามมีลิงก์เปิดรูปหลักฐานในหน้านี้ · กติกาข้อ 4 ของโปรเจกต์
 * ปุ่มแชร์จึงส่งแต่ข้อความ ไม่มีลิงก์ไดรฟ์ติดไปด้วย
 */

interface DoneGroup {
  name: string
  codes: string[]
}

interface DoneState {
  kind: 'out' | 'in'
  refNo: string
  dueAt?: string | null
  codes: string[]
  typeName: string
  /** แยกตามชนิดเครื่อง · ไม่มีก็ถอยไปใช้ codes ก้อนเดียวแบบเดิม */
  groups?: DoneGroup[]
  issues?: AssetIssueInput[]
  photoCount: number
  /** ชื่อคนที่เบิกให้ · ว่าง = เบิกให้ตัวเอง */
  forName?: string | null
}

const timeOnly = (iso: string) =>
  new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

/** เหลืออีกเท่าไหร่ · บอกเป็นชั่วโมงกับนาที เพราะคนคิดเป็นช่วงเวลา ไม่ใช่เป็นนาทีรวม */
function leftText(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'เลยกำหนดแล้ว'
  const m = Math.round(ms / 60000)
  if (m < 60) return `อีก ${m} นาที`
  return `อีก ${Math.floor(m / 60)} ชั่วโมง ${m % 60} นาที`
}

export default function AssetDone() {
  const { refNo = '' } = useParams()
  const { profile } = useAuth()
  const state = (useLocation().state ?? null) as DoneState | null
  const [shared, setShared] = useState<string | null>(null)

  const kind = state?.kind ?? 'out'
  const codes = state?.codes ?? []
  const issues = state?.issues ?? []
  const damaged = new Set(issues.map((i) => i.asset_code))

  /** กลุ่มที่เอาไปแสดง · ตัดเครื่องที่แจ้งชำรุดออก เพราะมันขึ้นกรอบแดงข้างบนแล้ว */
  const groups = useMemo<DoneGroup[]>(() => {
    const raw: DoneGroup[] =
      state?.groups && state.groups.length > 0
        ? state.groups
        : [{ name: state?.typeName ?? 'อุปกรณ์', codes }]
    return raw
      .map((g) => ({ name: g.name, codes: g.codes.filter((c) => !damaged.has(c)) }))
      .filter((g) => g.codes.length > 0)
  }, [state, codes, damaged])

  const clean = groups.reduce((n, g) => n + g.codes.length, 0)

  /* ชิปเล็กลงเมื่อของเยอะ เพื่อให้ยังจบในจอเดียว · ไม่ตัดรายการทิ้ง */
  const chip =
    clean > 24
      ? 'px-[5px] py-[1px] text-[11px]'
      : clean > 12
        ? 'px-[7px] py-[2px] text-[12.5px]'
        : 'px-2 py-1 text-sm'

  const shareText = useMemo(() => {
    const lines = [
      `${kind === 'out' ? 'เบิกสำเร็จ' : 'คืนสำเร็จ'} ${codes.length} เครื่อง`,
      `${profile?.full_name ?? ''} ${profile?.employee_code ?? ''}`.trim(),
      `${fmtDateTime(new Date().toISOString())} · ${refNo}`,
    ]
    if (state?.forName) lines.push(`เบิกแทน ${state.forName}`)
    if (state?.dueAt && kind === 'out') lines.push(`ต้องคืนภายใน ${timeOnly(state.dueAt)} น.`)
    for (const g of groups) lines.push(`${g.name} · ${g.codes.join(' ')}`)
    for (const i of issues) lines.push(`ชำรุด ${i.asset_code} · ${i.symptom}`)
    lines.push(`รูปหลักฐาน ${state?.photoCount ?? 0} ใบ`)
    return lines.join('\n')
  }, [kind, codes.length, profile, refNo, state, groups, issues])

  /**
   * แชร์เข้าไลน์
   *
   * ใช้ตัวแชร์ของเครื่องก่อน เพราะคนเลือกได้เองว่าจะส่งไลน์ แชต หรือก็อป
   * และไม่ต้องสลับแอพไปมา · เครื่องไหนไม่มีค่อยเปิดลิงก์ไลน์ตรง ๆ
   * สุดท้ายถ้าไม่ได้จริง ๆ ก็ก็อปข้อความไว้ให้วางเอง จะได้ไม่เป็นปุ่มที่กดแล้วไม่เกิดอะไร
   */
  async function share() {
    setShared(null)
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText })
        return
      }
    } catch {
      /* คนกดยกเลิกเองก็มา ไม่ต้องขึ้น error */
      return
    }
    const url = 'https://line.me/R/msg/text/?' + encodeURIComponent(shareText)
    const w = window.open(url, '_blank')
    if (!w) {
      try {
        await navigator.clipboard.writeText(shareText)
        setShared('คัดลอกข้อความแล้ว วางในไลน์ได้เลย')
      } catch {
        setShared('เปิดไลน์ไม่ได้ ลองแคปหน้าจอส่งแทน')
      }
    }
  }

  return (
    <div className="bg-canvas">
      {/* หัวเขียวเริ่มจากขอบบนเลย ไม่มีแถบเหลืองคั่น · แคปแล้วได้ใจความตั้งแต่บรรทัดแรก */}
      <header className="safe-t bg-success text-white">
        <div className="mx-auto max-w-phone px-4 pb-4 pt-5 text-center">
          <span className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-white/85 text-2xl">
            ✓
          </span>
          <p className="mt-2 font-display text-xl">
            {kind === 'out' ? 'เบิกสำเร็จ' : 'คืนสำเร็จ'}
            {codes.length > 0 ? ` · ${codes.length} เครื่อง` : ''}
          </p>
          <p className="mt-1 text-sm">
            {profile?.full_name} · {profile?.employee_code}
            {deptSuffix(profile?.dept_code)}
            {profile?.shift_start && profile?.shift_end
              ? ` · กะ ${profile.shift_start.slice(0, 5)}–${profile.shift_end.slice(0, 5)}`
              : ''}
          </p>
          <p className="font-mono text-xs opacity-80">
            {fmtDateTime(new Date().toISOString())} · {refNo}
          </p>
        </div>
      </header>

      {/* เวลาคืนเป็นสิ่งที่คนลืมบ่อยสุด จึงใหญ่กว่าทุกอย่างรองจากหัว */}
      {state?.dueAt && kind === 'out' && (
        <div className="border-b-2 border-brand-500 bg-brand-50 px-4 py-2 text-center">
          <p className="text-xs text-ink-500">ต้องคืนภายใน</p>
          <p className="font-display text-2xl leading-tight">{timeOnly(state.dueAt)} น.</p>
          <p className="text-xs text-ink-500">{leftText(state.dueAt)}</p>
        </div>
      )}

      <StaffPage className="pt-3">
        {state?.forName && (
          <p className="mb-2 rounded-card border border-warn/40 bg-warn-bg px-3 py-2 text-center font-display text-md text-warn-txt">
            เบิกแทน {state.forName} — ของค้างชื่อเขา ไม่ใช่ชื่อคุณ
          </p>
        )}

        {issues.length > 0 && (
          <section className="mb-2 rounded-card border-2 border-danger/50 bg-danger-bg p-3">
            <p className="font-display text-danger-txt">⚠ แจ้งชำรุด {issues.length} เครื่อง</p>
            <ul className="mt-1 space-y-[2px] text-sm text-danger-txt">
              {issues.map((i) => (
                <li key={i.asset_code}>
                  <b className="font-mono">{i.asset_code}</b> · {i.symptom}
                </li>
              ))}
            </ul>
            <p className="mt-2 rounded-btn bg-surface px-3 py-2 text-center font-display text-danger-txt">
              นำเครื่องที่ชำรุดไปวางบนโต๊ะแอดมิน
            </p>
          </section>
        )}

        {/* แยกการ์ดตามชนิดเครื่อง · เบิกหลายชนิดพร้อมกันก็ยังรู้ว่าอันไหนเป็นของอะไร */}
        {groups.length > 0 && (
          <section className="space-y-2">
            {groups.map((g) => (
              <div key={g.name} className="rounded-card border border-line bg-surface p-3">
                <p className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="font-display text-base">{g.name}</span>
                  <span className="text-sm text-ink-500">{g.codes.length} เครื่อง</span>
                </p>
                <ul className="flex flex-wrap gap-1">
                  {g.codes.map((c) => (
                    <li
                      key={c}
                      className={`rounded-pill border border-line-2 bg-surface-2 font-mono ${chip}`}
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        <p className="mt-2 text-center text-sm text-success-txt">
          ✓ บันทึกรูปหลักฐานแล้ว {state?.photoCount ?? 0} รูป
        </p>

        {shared && <p className="mt-2 text-center text-sm text-ink-500">{shared}</p>}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link to="/" className="btn-soft py-4 text-center">
            กลับหน้าแรก
          </Link>
          <Link to="/returns" className="btn-primary py-4 text-center">
            ดูของที่ถืออยู่
          </Link>
        </div>

        <button type="button" className="btn-soft mt-2 w-full py-4" onClick={() => void share()}>
          แชร์เข้าไลน์ · ส่งเป็นข้อความ
        </button>

        {/* เว้นที่ไว้ให้แถบแจ้งเวอร์ชันใหม่ที่ลอยอยู่ล่างจอ ไม่ทับปุ่ม */}
        <div className="h-16" />
      </StaffPage>
    </div>
  )
}
