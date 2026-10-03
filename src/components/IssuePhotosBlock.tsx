import { useAuth } from '../lib/auth'
import { stampLines } from '../lib/image'
import { PhotoSteps, shotsToPhotos, type Shot } from './PhotoSteps'
import { attachIssuePhotos } from '../lib/api'

export type IssueShots = Record<string, Shot[]>

/**
 * รูปอาการของเครื่องที่แจ้งเสีย — บังคับอย่างน้อยหนึ่งใบ ไม่จำกัดจำนวน
 *
 * คนละชุดกับรูปตอนเบิก/คืน และตั้งใจให้แยกกัน
 * รูปตอนเบิกคือหลักฐานว่าของออกไปแล้ว ส่วนรูปนี้คือหลักฐานว่าของพังตรงไหน
 * เอามาปนกันแล้วหน้าแจ้งเสียจะเต็มไปด้วยรูปเครื่องสภาพดี จนรูปอาการจริงจมหายไป
 *
 * ทำไมแนบทีหลังแทนที่จะส่งไปพร้อมใบเบิก/ใบคืน
 *   asset_checkout กับ asset_return เป็นหัวใจของทั้งระบบ ยาวหลักร้อยบรรทัดและมีการล็อกแถว
 *   แก้ทับแล้วพลาดคือทั้งฮับเบิกคืนไม่ได้ ส่วนการแนบรูปเป็นของประกอบ
 *   แนบไม่สำเร็จก็ยังมีใบแจ้งชำรุดอยู่ครบ เรื่องสำคัญไม่พัง
 *   หน้าจอกันไว้แล้วว่าไม่ถ่ายรูปกดส่งไม่ได้ จึงไม่มีทางหลุดจากการใช้งานปกติ
 */
export function IssuePhotosBlock({
  codes,
  value,
  onChange,
  nameOf,
}: {
  /** รหัสเครื่องที่กรอกอาการไว้ */
  codes: string[]
  value: IssueShots
  onChange: (next: IssueShots) => void
  nameOf?: (code: string) => string
}) {
  const { profile } = useAuth()
  if (codes.length === 0) return null

  const stamp = stampLines(
    profile?.full_name ?? '',
    profile?.employee_code ?? '',
    profile?.dept_code ?? profile?.hub_code ?? 'BPL',
    'แจ้งเสีย',
  )

  return (
    <section className="mt-4 rounded-card border border-danger/30 bg-danger-bg p-3">
      <p className="font-display text-sm text-danger-txt">
        รูปอาการที่เจอ · บังคับเครื่องละอย่างน้อย 1 รูป
      </p>
      <p className="mb-3 text-xs text-danger-txt">
        ถ่ายกี่รูปก็ได้ ไม่จำกัด · ถ่ายให้เห็นจุดที่เสียชัด ๆ
        <br />
        รูปชุดนี้คนละชุดกับรูปเบิกคืน จะไปโผล่ในหน้าแจ้งเสียของแอดมินอย่างเดียว
      </p>

      <div className="space-y-4">
        {codes.map((code) => (
          <div key={code}>
            <p className="mb-1 font-mono text-sm font-bold">
              {code}
              {nameOf ? <span className="ml-2 font-sans text-xs text-ink-500">{nameOf(code)}</span> : null}
              {shotsToPhotos(value[code] ?? []).length === 0 && (
                <span className="ml-2 font-sans text-xs text-danger-txt">ยังไม่ได้ถ่าย</span>
              )}
            </p>
            <PhotoSteps
              steps={[]}
              maxFree={20}
              minFree={1}
              stamp={stamp}
              shots={value[code] ?? []}
              onShots={(next) =>
                onChange({
                  ...value,
                  [code]: typeof next === 'function' ? next(value[code] ?? []) : next,
                })
              }
            />
          </div>
        ))}
      </div>
    </section>
  )
}

/** ครบทุกเครื่องหรือยัง · ยังอัปไม่เสร็จหรือมีใบที่ส่งไม่ผ่าน ถือว่ายังไม่พร้อม */
export function issuePhotosReady(codes: string[], value: IssueShots): boolean {
  return codes.every((c) => {
    const shots = value[c] ?? []
    if (shotsToPhotos(shots).length === 0) return false
    return !shots.some((s) => s.state === 'uploading' || s.state === 'ready' || s.state === 'failed')
  })
}

/**
 * แนบรูปเข้าใบแจ้งชำรุดหลังส่งใบเบิก/ใบคืนสำเร็จ
 *
 * ฐานข้อมูลหาใบล่าสุดของเครื่องนั้นที่เพิ่งแจ้งภายใน 10 นาทีให้เอง
 * ไม่ล้มทั้งก้อนถ้าเครื่องใดเครื่องหนึ่งแนบไม่ติด เพราะใบเบิกคืนผ่านไปแล้ว
 * ย้อนกลับไม่ได้ และใบแจ้งชำรุดก็ยังอยู่ครบ
 */
export async function flushIssuePhotos(codes: string[], value: IssueShots): Promise<string[]> {
  const failed: string[] = []
  for (const code of codes) {
    const photos = shotsToPhotos(value[code] ?? [])
    if (photos.length === 0) continue
    try {
      await attachIssuePhotos(
        code,
        photos.map((p) => ({ file_id: p.file_id, web_link: p.web_link, bytes: p.bytes })),
      )
    } catch {
      failed.push(code)
    }
  }
  return failed
}
