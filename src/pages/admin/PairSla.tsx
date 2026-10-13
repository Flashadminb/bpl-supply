import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { ErrorBox, Loading } from '../../components/ui'
import { readableError } from '../../lib/supabase'
import { p48SlaDelete, p48SlaList, p48SlaSet, type P48Sla } from '../../lib/pair'

/**
 * เกณฑ์ SLA ต่อประเภทลูกค้า · ใช้บนหน้าจับคู่
 *
 * หน้านี้อยู่หลังบ้าน ไม่ใช่บนจอ เหตุผลเดียวกับโซน D0x ของสาขา
 * เป็นงานตั้งค่าที่ทำครั้งเดียวแล้วนาน ๆ แก้ที ของแบบนั้นไม่ควรอยู่บนจอทำงาน
 *
 * ─────────────────────────────────────────────────────────────────
 * สูตรที่หน้าจับคู่ใช้
 *
 *   ครบกำหนด = วันที่เข้ารับสินค้า + SLA ของประเภทลูกค้าเจ้านั้น
 *   เหลือ     = ครบกำหนด − วันนี้
 *
 *   บวก = ยังมีเวลา · ศูนย์ = ครบกำหนดวันนี้ · ลบ = เลยมาแล้วกี่วัน
 *
 * นับเป็นวันตามปฏิทินไทย ไม่ใช่ช่วง 24 ชั่วโมง
 * ─────────────────────────────────────────────────────────────────
 *
 * ของผู้ดูแลระบบคนเดียว · เกณฑ์ที่ใครก็แก้ได้ คือเกณฑ์ที่พอใครสอบตกก็แก้เกณฑ์
 * กติกาเดียวกับเกณฑ์เวลาของรถรอลงงาน · ด่านจริงอยู่ที่ p48_sla_set ในฐานข้อมูล
 * เส้นทางนี้แค่ไม่ให้กดเข้ามาเจอ error
 */
export default function PairSla() {
  const feed = useAsync(() => p48SlaList(), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [newType, setNewType] = useState('')
  const [newDays, setNewDays] = useState('3')

  async function save(type: string, days: number, note: string) {
    setBusy(type)
    setErr(null)
    setMsg(null)
    try {
      await p48SlaSet(type, days)
      setMsg(note)
      feed.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(null)
    }
  }

  async function drop(s: P48Sla) {
    const warn =
      s.used > 0
        ? `ลบเกณฑ์ของ ${s.cust_type}\n\nพัสดุ ${s.used.toLocaleString('th-TH')} ชิ้นของเจ้านี้จะกลายเป็น "ยังไม่ตั้ง SLA"\nหน้าจับคู่จะบอกไม่ได้ว่าช้าหรือยัง จนกว่าจะตั้งใหม่`
        : `ลบเกณฑ์ของ ${s.cust_type}`
    if (!window.confirm(warn)) return
    setBusy(s.cust_type)
    setErr(null)
    setMsg(null)
    try {
      await p48SlaDelete(s.cust_type)
      setMsg(`ลบเกณฑ์ของ ${s.cust_type} แล้ว`)
      feed.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(null)
    }
  }

  if (feed.loading) return <Loading />
  if (feed.error) return <ErrorBox message={feed.error} onRetry={feed.reload} />

  const rows = feed.data ?? []
  /* ยังไม่มีใครแก้เลยสักเจ้า · 3 วันคือค่าที่ใส่ไว้ให้แก้ ไม่ใช่ค่าที่ถูกต้อง */
  const untouched = rows.length > 0 && rows.every((r) => r.days === 3 && !r.by_name)
  const total = rows.reduce((a, b) => a + Number(b.used ?? 0), 0)

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-4">
        <h1 className="font-display text-xl">เกณฑ์ SLA ต่อประเภทลูกค้า</h1>
        <p className="mt-1 text-sm text-ink-500">
          ใช้บนหน้าจับคู่ · ครบกำหนด = วันที่เข้ารับสินค้า + SLA · เหลือ = ครบกำหนด − วันนี้ · นับเป็นวันตามปฏิทิน
        </p>
      </div>

      {untouched && (
        <p className="mb-3 rounded-card bg-warn-bg px-3 py-2 text-sm text-warn-txt">
          ตอนนี้ตั้งไว้ 3 วันเท่ากันหมดทุกเจ้า ซึ่งเป็นค่าที่ระบบใส่ไว้ให้แก้ ไม่ใช่ค่าที่ถูกต้อง
          · ตั้งของจริงก่อนเอาตัวเลขบนหน้าจับคู่ไปตัดสินงาน
        </p>
      )}
      {msg && <p className="mb-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">{msg}</p>}
      {err && <p className="mb-3 rounded-card bg-danger-bg px-3 py-2 text-sm text-danger-txt">{err}</p>}

      <section className="panel mb-3 p-3">
        <p className="label mb-2">
          {rows.length} ประเภท · พัสดุในรอบปัจจุบันรวม {total.toLocaleString('th-TH')} ชิ้น
        </p>

        <div className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-ink-500">
                <th className="px-2 py-2 text-left font-medium">ประเภทลูกค้า</th>
                <th className="px-2 py-2 text-left font-medium">ส่งภายใน (วัน)</th>
                <th className="px-2 py-2 text-right font-medium">พัสดุรอบนี้</th>
                <th className="px-2 py-2 text-left font-medium">แก้ล่าสุด</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.cust_type} r={r} busy={busy === r.cust_type} onSave={save} onDrop={drop} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-ink-500">
                    ยังไม่มีประเภทลูกค้าในตาราง · อัปไฟล์ที่หน้าจับคู่แล้วระบบจะเติมให้เอง หรือเพิ่มเองด้านล่าง
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-3">
        <p className="label mb-2">เพิ่มประเภทใหม่</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-500">ชื่อประเภทลูกค้า</span>
            <input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              placeholder="ต้องสะกดตรงกับในไฟล์"
              className="input h-tap w-[240px] px-3"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-500">ส่งภายใน (วัน)</span>
            <input
              value={newDays}
              onChange={(e) => setNewDays(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              className="input h-tap w-[110px] px-3 text-center font-mono"
            />
          </label>
          <button
            type="button"
            className="btn h-tap px-5 text-sm disabled:opacity-40"
            disabled={!newType.trim() || newDays === '' || busy !== null}
            onClick={() =>
              void save(newType.trim(), Number(newDays), `เพิ่ม ${newType.trim()} แล้ว`).then(() =>
                setNewType(''),
              )
            }
          >
            เพิ่ม
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          ชื่อต้องสะกดตรงกับที่เขียนในไฟล์เป๊ะ ๆ เช่น Shopee · Tiktok · ลูกค้าทั่วไป
          · สะกดไม่ตรงจะไม่มีพัสดุชิ้นไหนเข้าเกณฑ์นี้ แล้วช่องพัสดุรอบนี้จะขึ้น 0
        </p>
      </section>
    </div>
  )
}

/** หนึ่งแถว · แก้ตัวเลขแล้วปุ่มบันทึกถึงจะโผล่ จะได้ไม่กดพลาด */
function Row({
  r,
  busy,
  onSave,
  onDrop,
}: {
  r: P48Sla
  busy: boolean
  onSave: (t: string, d: number, note: string) => void
  onDrop: (r: P48Sla) => void
}) {
  const [v, setV] = useState(String(r.days))
  const dirty = v !== String(r.days) && v !== ''

  return (
    <tr className="border-t border-line-2">
      <td className="px-2 py-2 font-medium">{r.cust_type}</td>
      <td className="px-2 py-2">
        <input
          value={v}
          onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          className="input h-tap w-[110px] px-3 text-center font-mono"
          style={dirty ? { borderColor: 'var(--yellow-500)' } : undefined}
        />
      </td>
      <td className="px-2 py-2 text-right font-mono text-ink-500">{Number(r.used ?? 0).toLocaleString('th-TH')}</td>
      <td className="px-2 py-2 text-xs text-ink-500">
        {r.by_name ? `${new Date(r.updated_at).toLocaleString('th-TH')} · ${r.by_name}` : 'ยังไม่เคยแก้'}
      </td>
      <td className="px-2 py-2">
        <span className="flex justify-end gap-2">
          {dirty && (
            <button
              type="button"
              disabled={busy}
              className="btn h-tap px-4 text-sm"
              onClick={() => onSave(r.cust_type, Number(v), `ตั้ง ${r.cust_type} เป็น ${v} วันแล้ว`)}
            >
              บันทึก
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className="btn-soft h-tap px-3 text-sm text-danger"
            onClick={() => onDrop(r)}
          >
            ลบ
          </button>
        </span>
      </td>
    </tr>
  )
}
