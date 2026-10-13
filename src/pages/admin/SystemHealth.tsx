import { useEffect, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { useAuth } from '../../lib/auth'
import { isOwner } from '../../lib/roles'
import { pairCall } from '../../lib/pairBackend'
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

/**
 * ข้อมูลหน้าจับคู่ไปอยู่อีกที่แล้ว · อ่านเท่านั้น
 *
 * มีขึ้นเพราะมาตรวัดทั้งหน้านี้วัดเฉพาะฐานข้อมูลหลัก
 * ถ้าไม่บอกไว้ วันหนึ่งจะมีคนสงสัยว่าของหน้าจับคู่ห้าหมื่นแถวไปอยู่ไหน
 * แล้วสรุปว่ามาตรวัดหน้านี้นับไม่ครบ ซึ่งจะทำให้เลิกเชื่อหน้านี้ทั้งหน้า
 */
function PairDbNote() {
  const [probe, setProbe] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const check = async () => {
    setBusy(true)
    setProbe(null)
    try {
      const r = await pairCall<{
        ms: number
        parcels: string
        products: string
        runs: string
        db: string
        bytes: string
      }>('/dbcheck')
      /* เขียนกำกับว่าเป็นยอดรวมทุกรอบ ไม่ใช่ยอดที่หน้าจับคู่แสดง
         สองเลขนี้ไม่เท่ากันเป็นเรื่องปกติ เพราะรอบเก่าจะยังอยู่จนกว่าจะถูกเก็บกวาด
         ถ้าไม่บอกไว้ คนอ่านจะเทียบกับหน้าจับคู่แล้วสรุปว่ามีอะไรผิด */
      /* โควตาของ Neon แผนฟรีคือหนึ่งกิกะไบต์ต่อโปรเจกต์
         เขียนตัวเลขนี้ไว้ตรงนี้เพราะมันคือเพดานที่ต้องคอยดู ไม่ใช่ค่าคงที่ที่ใช้คำนวณอะไรต่อ */
      const mb = Number(r.bytes) / (1024 * 1024)
      setProbe(
        `ต่อติด · ฐาน ${r.db} ตอบใน ${r.ms} มิลลิวินาที · ` +
          `ใช้ไป ${mb.toFixed(0)} MB จาก 1,024 MB (${Math.round((mb / 1024) * 100)}%) · ` +
          `เก็บอยู่ ${Number(r.parcels).toLocaleString('th-TH')} + ` +
          `${Number(r.products).toLocaleString('th-TH')} แถว จาก ${r.runs} รอบอัป ` +
          `(รวมรอบเก่าที่ยังรอเก็บกวาด จึงมากกว่าที่หน้าจับคู่แสดง)`,
      )
    } catch (e) {
      setProbe(`ต่อไม่ติด · ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /* ตรวจให้เองตั้งแต่เปิดหน้า ไม่ต้องรอให้กด
     คำถามที่หน้านี้ต้องตอบคือ ตอนนี้ของอยู่ไหนและยังดีอยู่ไหม
     ถ้าต้องกดก่อนถึงจะรู้ แปลว่าคนที่ไม่ได้กดจะเดินออกไปโดยยังไม่ได้คำตอบ */
  useEffect(() => {
    void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="panel mt-3 p-4">
      <h2 className="font-display text-md">ข้อมูลหน้าจับคู่ไม่ได้นับรวมอยู่ในนี้</h2>
      <p className="mt-1 text-sm text-ink-600">
        ไฟล์สองใบของหน้าจับคู่กินที่ราวเก้าสิบเปอร์เซ็นต์ของฐานข้อมูลเดิม จึงย้ายไปอยู่ฐานข้อมูลของตัวเอง
        ตั้งแต่ 14 ต.ค. 2569 และของเก่าที่นี่ถูกลบทิ้งแล้ว
        <br />
        มาตรวัดด้านบนทั้งหมดจึงเป็นของงานอื่นล้วน ๆ และโตช้ากว่าที่เคยเห็นมาก
        ส่วนการล็อกอินยังเป็นที่เดิมทั้งหมด ไม่มีอะไรเปลี่ยนในมุมของคนใช้งาน
      </p>

      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        <div className="rounded-card bg-neutralbg px-3 py-2">
          <dt className="text-xs text-ink-500">งานอื่นทั้งหมด</dt>
          <dd className="font-display">Supabase · วัดอยู่ด้านบน</dd>
        </div>
        <div className="rounded-card bg-neutralbg px-3 py-2">
          <dt className="text-xs text-ink-500">หน้าจับคู่อย่างเดียว</dt>
          <dd className="font-display">Neon · แยกโควตาคนละก้อน</dd>
        </div>
      </dl>

      <button type="button" className="btn-soft mt-3 h-tap px-3 text-sm" onClick={check} disabled={busy}>
        {busy ? 'กำลังตรวจ…' : 'ตรวจใหม่อีกครั้ง'}
      </button>

      {probe && (
        <p
          className={`mt-2 rounded-card px-3 py-2 text-sm ${
            probe.startsWith('ต่อติด') ? 'bg-success-bg text-success-txt' : 'bg-danger-bg text-danger-txt'
          }`}
        >
          {probe}
        </p>
      )}
    </section>
  )
}

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
  const { profile } = useAuth()
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

      {/* เห็นเฉพาะเจ้าของระบบ · เส้นทางนี้ผู้ตรวจสอบกับแอดมินเข้าถึงได้ด้วย
          แต่เรื่องว่าข้อมูลไปอยู่ฐานไหนเป็นของเจ้าของระบบคนเดียว */}
      {isOwner(profile) && <PairDbNote />}

      <p className="mt-3 text-center text-xs text-ink-400">
        เปอร์เซ็นต์ยิ่งต่ำยิ่งดี · เขียวคือสบาย เหลืองคือเริ่มต้องจับตา แดงคือต้องจัดการ
      </p>
    </div>
  )
}
