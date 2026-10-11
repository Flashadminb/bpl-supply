import { useState } from 'react'
import { useAsync } from '../lib/useAsync'
import { permissionUsage } from '../lib/api'
import { FLAG_SPECS } from '../lib/capabilities'
import { ErrorBox, Loading } from './ui'

/**
 * เปิดธงนี้แล้วทำอะไรได้บ้าง
 *
 * สองชั้นคู่กันเสมอ
 *   ① คำอธิบายภาษาคน — เขียนไว้ที่ lib/capabilities.ts ที่เดียว
 *   ② ที่มาในฐานข้อมูลจริง — อ่านสดจาก catalog ทุกครั้งที่เปิดหน้า
 *
 * ที่ต้องมีชั้น ② เพราะชั้น ① เป็นคำที่คนเขียน ซึ่งวันหนึ่งจะล้าสมัย
 * ชั้น ② ไม่มีทางล้าสมัยเพราะมันคือของจริงที่บังคับใช้อยู่
 * วันที่สองชั้นไม่ตรงกัน คือวันที่รู้ว่าต้องกลับมาแก้คำอธิบาย
 */
export function FlagGuide() {
  const usage = useAsync(permissionUsage, [])
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section className="mb-4 rounded-card border border-line bg-surface p-3">
      <h2 className="font-display text-base">เปิดแต่ละอันแล้วทำอะไรได้บ้าง</h2>
      <p className="mt-[2px] text-sm text-ink-400">
        กดที่ชื่อเพื่อดูรายละเอียด · ส่วน “ที่มาในระบบ” อ่านสดจากฐานข้อมูลทุกครั้ง
        เปลี่ยนอะไรในอนาคตตรงนั้นจะขึ้นเองโดยไม่ต้องมาแก้หน้านี้
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {FLAG_SPECS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip ${open === f.key ? 'chip-on' : ''}`}
            onClick={() => setOpen(open === f.key ? null : f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {FLAG_SPECS.filter((f) => f.key === open).map((f) => {
        const u = usage.data?.[f.key]
        return (
          <div key={f.key} className="mt-3 rounded-card bg-surface-2 p-3">
            <p className="font-display text-base">{f.label}</p>

            <p className="label mt-2">เปิดแล้วทำได้</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
              {f.grants.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>

            {f.limits && (
              <>
                <p className="label mt-3">ยังทำไม่ได้</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-500">
                  {f.limits.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </>
            )}

            {f.needsAlso && (
              <p className="mt-3 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
                <b>เปิดธงอย่างเดียวยังไม่พอ</b> · {f.needsAlso}
              </p>
            )}

            {f.risk && (
              <p className="mt-2 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">
                {f.risk}
              </p>
            )}

            {/* ชั้นที่สอง · ของจริงที่บังคับใช้อยู่ในฐานข้อมูลตอนนี้ */}
            <p className="label mt-3">ที่มาในระบบ · อ่านสดจากฐานข้อมูล</p>
            {usage.loading && <Loading />}
            {usage.error && <ErrorBox message={usage.error} onRetry={usage.reload} />}
            {usage.data && (
              <p className="text-sm text-ink-500">
                {u && (u.tables.length > 0 || u.functions.length > 0) ? (
                  <>
                    คุมการเข้าถึงข้อมูล <b>{u.tables.length}</b> ตาราง
                    {u.tables.length > 0 && (
                      <span className="block font-mono text-xs text-ink-400">
                        {u.tables.join(' · ')}
                      </span>
                    )}
                    {u.functions.length > 0 && (
                      <span className="mt-1 block">
                        ถูกอ้างถึงในกติกาฝั่งฐานข้อมูล <b>{u.functions.length}</b> จุด
                        <span className="block font-mono text-xs text-ink-400">
                          {u.functions.join(' · ')}
                        </span>
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-warn-txt">
                    ธงนี้ยังไม่ถูกบังคับใช้ที่ฐานข้อมูลเลย · ถูกใช้ซ่อนปุ่มบนหน้าจออย่างเดียว
                    ซึ่งแปลว่าคนที่รู้ทางยังเรียกตรงได้
                  </span>
                )}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
