import { useAsync } from '../../lib/useAsync'
import { systemHealth } from '../../lib/api'
import { ErrorBox, Loading } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'

/**
 * สถานะระบบ — ใกล้เต็มแผนฟรีหรือยัง
 *
 * เจ้าของระบบต้องเห็นเองได้ว่าเหลือที่เท่าไหร่ ไม่ต้องรอให้ระบบล่มก่อนค่อยรู้
 *
 * แยกให้ชัดว่าตัวไหน "วัดจริง" ตัวไหน "ประมาณการ"
 * ถ้าเอามาปนกันแล้วเขียนว่าเป็นตัวเลขจริงทั้งหมด วันหนึ่งที่มันคลาดเคลื่อน
 * เขาจะเลิกเชื่อหน้านี้ทั้งหน้า ซึ่งแย่กว่าไม่มีหน้านี้เลย
 * egress กับ Edge Function นับที่ชั้นเครือข่ายของ Supabase เราอ่านไม่ได้
 * จึงคำนวณย้อนจากขนาดรูปที่บันทึกไว้ และลิงก์ไปหน้า Usage ตัวจริงให้กดดูได้
 */

const GB = 1024 ** 3
const MB = 1024 ** 2

function human(bytes: number) {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** สีตามความเสี่ยง — เขียวสบาย เหลืองเริ่มต้องดู แดงต้องทำอะไรสักอย่าง */
function tone(pct: number) {
  if (pct >= 80) return { bar: 'bg-danger', txt: 'text-danger-txt', word: 'ต้องจัดการแล้ว' }
  if (pct >= 50) return { bar: 'bg-warn', txt: 'text-warn-txt', word: 'เริ่มต้องจับตา' }
  return { bar: 'bg-success', txt: 'text-success-txt', word: 'สบาย ๆ' }
}

function Gauge({
  title,
  used,
  limit,
  usedText,
  limitText,
  estimated,
  note,
}: {
  title: string
  used: number
  limit: number
  usedText: string
  limitText: string
  estimated?: boolean
  note?: string
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const t = tone(pct)
  return (
    <section className="panel p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-md">
          {title}
          {estimated && (
            <span className="ml-2 rounded-pill bg-neutralbg px-2 py-[2px] text-xs font-normal text-ink-500">
              ประมาณการ
            </span>
          )}
        </h2>
        <span className={`text-sm font-semibold ${t.txt}`}>
          {pct < 1 ? 'น้อยกว่า 1%' : `${pct.toFixed(0)}%`} · {t.word}
        </span>
      </div>

      <p className="mb-2 text-sm text-ink-500">
        ใช้ไป <b className="text-ink">{usedText}</b> จาก {limitText}
      </p>

      <div
        className="h-3 w-full overflow-hidden rounded-pill bg-line-2"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={title}
      >
        <div className={`h-full rounded-pill ${t.bar}`} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>

      {note && <p className="mt-2 text-xs text-ink-400">{note}</p>}
    </section>
  )
}

export default function SystemHealth() {
  const feed = useAsync(systemHealth, [])

  if (feed.loading) return <Loading />
  if (feed.error) return <ErrorBox message={feed.error} onRetry={feed.reload} />
  const h = feed.data
  if (!h) return null

  /**
   * ข้อความอัตราการโต
   *
   * ระบบจดขนาดฐานข้อมูลไว้วันละครั้ง แล้วเทียบระหว่างวันเพื่อหาการโตจริง
   * ถ้ายังจดไม่ครบ 7 วัน ฐานข้อมูลจะส่ง null มา ซึ่งต้องเขียนว่า "ยังบอกไม่ได้"
   * ห้ามเดาเป็นตัวเลข เพราะเคยเดาแล้วได้ "เต็มใน 31 วัน" ซึ่งผิดจนน่าตกใจ
   */
  const growth = (() => {
    const { per_day_bytes: rate, days_left: left, tracked_days: days } = h.db
    if (rate === null || left === null) {
      return `กำลังเก็บสถิติ — จดมาแล้ว ${days} วัน ต้องครบ 7 วันก่อนถึงบอกอัตราการโตได้`
    }
    const when =
      left > 3650
        ? 'เกิน 10 ปี'
        : left > 365
          ? `ราว ${(left / 365).toFixed(1)} ปี`
          : `ราว ${left} วัน`
    return `โตวันละ ~${human(rate)} · ที่อัตรานี้จะเต็มในอีก${when} (วัดจากสถิติ ${days} วัน)`
  })()

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">สถานะระบบ</h1>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={feed.reload}>
          โหลดใหม่
        </button>
      </div>

      <p className="mb-3 rounded-card bg-brand-50 px-3 py-2 text-sm text-ink-700">
        ระบบอยู่บนแผนฟรีของ Supabase หน้านี้บอกว่าใช้ไปเท่าไหร่จากที่มี
        <br />
        ตรวจเมื่อ {fmtDateTime(h.measured_at)}
      </p>

      <div className="space-y-3">
        <Gauge
          title="ขนาดฐานข้อมูล"
          used={h.db.bytes}
          limit={h.db.limit_bytes}
          usedText={human(h.db.bytes)}
          limitText={human(h.db.limit_bytes)}
          note={growth}
        />

        <Gauge
          title="ปริมาณข้อมูลที่ส่งออก (Egress)"
          used={h.egress.est_bytes}
          limit={h.egress.limit_bytes}
          usedText={human(h.egress.est_bytes)}
          limitText={human(h.egress.limit_bytes)}
          estimated
          note={`คำนวณจากรูป ${h.egress.photo_count.toLocaleString()} ใบ (${human(
            h.egress.photo_bytes,
          )}) ในรอบ 30 วัน คูณสองเพราะรูปวิ่งผ่านทั้งตอนอัปและตอนเปิดดู · ไม่รวมข้อมูลปลีกย่อยอื่น`}
        />

        <Gauge
          title="จำนวนครั้งที่เรียก Edge Function"
          used={h.edge.est_calls}
          limit={h.edge.limit_calls}
          usedText={`${h.edge.est_calls.toLocaleString()} ครั้ง`}
          limitText={`${h.edge.limit_calls.toLocaleString()} ครั้ง`}
          estimated
          note={`อัปรูป ${h.edge.uploads.toLocaleString()} + เปิดดูรูปอีกประมาณเท่ากัน + แจ้งเตือน ${h.edge.pushes.toLocaleString()} ในรอบ 30 วัน`}
        />

        <Gauge
          title="ผู้ใช้ที่เข้าระบบใน 30 วัน"
          used={h.mau.used}
          limit={h.mau.limit}
          usedText={`${h.mau.used.toLocaleString()} คน`}
          limitText={`${h.mau.limit.toLocaleString()} คน`}
          note={`มีบัญชีที่เปิดใช้อยู่ทั้งหมด ${h.mau.active_profiles} คน`}
        />
      </div>

      {/* ------------------------------------------------ ตารางที่กินที่สุด */}
      <section className="panel mt-3 overflow-x-auto p-2">
        <h2 className="px-2 pb-2 pt-1 font-display text-md">ตารางที่กินที่มากที่สุด</h2>
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="text-ink-500">
            <tr className="border-b border-line">
              <th className="p-2 font-medium">ตาราง</th>
              <th className="p-2 font-medium">ขนาด</th>
              <th className="p-2 font-medium">จำนวนแถว</th>
            </tr>
          </thead>
          <tbody>
            {(h.tables ?? []).map((t) => (
              <tr key={t.name} className="border-b border-line last:border-0">
                <td className="p-2 font-mono text-xs">{t.name}</td>
                <td className="p-2">{human(t.bytes)}</td>
                <td className="p-2 text-ink-500">{t.rows.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel mt-3 p-4">
        <h2 className="mb-2 font-display text-md">อ่านหน้านี้ยังไง</h2>
        <ul className="space-y-2 text-sm text-ink-700">
          <li>
            <b>ขนาดฐานข้อมูล</b> กับ <b>ผู้ใช้</b> คือตัวเลขจริงที่ถามจากฐานข้อมูลตรง ๆ เชื่อได้เต็มร้อย
          </li>
          <li>
            <b>Egress</b> กับ <b>Edge Function</b> ติดป้าย “ประมาณการ” เพราะ Supabase นับที่ชั้นเครือข่าย
            ไม่ได้เก็บไว้ในฐานข้อมูลของเรา เราจึงคำนวณย้อนจากขนาดรูปที่บันทึกไว้ —
            ครอบคลุมส่วนที่กินเยอะสุดจริง แต่ตัวเลขทางการต้องดูที่ Supabase
          </li>
          <li>
            รูปหลักฐานเก็บที่ <b>Google Drive</b> ไม่ได้กินพื้นที่ Supabase เลย จึงไม่มีในหน้านี้
          </li>
          <li>
            ถ้าแถบไหนขึ้น <span className="text-warn-txt">เหลือง</span> หรือ{' '}
            <span className="text-danger-txt">แดง</span> บอกผมได้ มีวิธีลดโดยไม่ต้องเสียเงิน เช่น
            ลดจำนวนรูปสูงสุดต่อใบ หรือลดขนาดรูปที่ย่อก่อนส่ง
          </li>
        </ul>

        <a
          href="https://supabase.com/dashboard/project/ajcdzmfefoyyisgwnpky/settings/billing/usage"
          target="_blank"
          rel="noreferrer"
          className="btn-soft mt-3 inline-flex h-tap items-center px-3 text-sm"
        >
          เปิดหน้า Usage ตัวจริงของ Supabase ↗
        </a>
      </section>

      <p className="mt-3 text-center text-xs text-ink-400">
        เปอร์เซ็นต์ยิ่งต่ำยิ่งดี · เขียวคือสบาย เหลืองคือเริ่มต้องจับตา แดงคือต้องจัดการ
      </p>
    </div>
  )
}
