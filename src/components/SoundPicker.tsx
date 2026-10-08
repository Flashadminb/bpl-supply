import { useEffect, useState } from 'react'
import { Modal } from './ui'
import { hasThaiVoice, onVoicesReady, type AlarmKit, type Stage } from '../lib/alarmKit'

/**
 * เลือกชุดเสียงเตือน · ใช้ได้ทั้งตารางปล่อยรถและรถรอลงงาน
 *
 * เสียงที่ตัดผ่านเสียงสายพานได้ กับเสียงที่ฟังทั้งกะแล้วไม่รำคาญ
 * เป็นคนละเรื่องกัน และขึ้นกับคลังจริงซึ่งไม่มีทางรู้จากฝั่งโค้ด
 * จึงให้คนที่ยืนอยู่ตรงนั้นเลือกเอง
 *
 * ฟังได้ทีละขั้น ไม่ใช่ฟังรวดเดียว เพราะเสียงที่ต้องแยกออกจากกันให้ได้
 * คือเสียงของสามขั้นในชุดเดียวกัน ไม่ใช่เสียงของชุดนี้กับชุดอื่น
 *
 * คำตอบเก็บในเครื่อง แปลว่าจอทีวีกับมือถือตั้งคนละเสียงกันได้
 * ซึ่งถูกแล้ว เพราะจอทีวีอยู่กลางคลังส่วนมือถืออยู่ในกระเป๋า
 */

const STAGES: { k: Stage; label: string }[] = [
  { k: 'm20', label: 'เหลือ 20 นาที' },
  { k: 'm10', label: 'เหลือ 10 นาที' },
  { k: 'late', label: 'เลยเวลาแล้ว' },
]

export function SoundPicker({
  kit,
  title,
  onClose,
}: {
  kit: AlarmKit
  title: string
  onClose: () => void
}) {
  const [pick, setPick] = useState(kit.getKey)
  /**
   * รายชื่อเสียงของเครื่องมาแบบไม่พร้อมกับหน้า จึงต้องถามใหม่เมื่อมันพร้อม
   * ถ้าถามครั้งเดียวตอนเปิดหน้า เครื่องที่โหลดช้าจะขึ้นว่าพูดไทยไม่ได้ทั้งที่ได้
   */
  const [thai, setThai] = useState(hasThaiVoice)
  useEffect(() => onVoicesReady(() => setThai(hasThaiVoice())), [])

  function choose(k: string) {
    setPick(k)
    kit.setKey(k)
    kit.previewStage(k, 'late')
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <p className="mb-3 text-sm text-ink-500">
        กดที่ชื่อชุดเพื่อเลือกและฟังเสียงขั้นสุดท้าย · กดปุ่มขั้นเพื่อฟังทีละขั้น
        <br />
        เสียงชุดนี้ใช้เฉพาะกระดานนี้ อีกกระดานตั้งแยกของตัวเอง
      </p>

      {!thai && (
        <p className="mb-3 rounded-xl bg-warn-bg p-3 text-sm font-bold text-warn-txt">
          เครื่องนี้ยังไม่มีเสียงพูดภาษาไทย · ชุดที่มีคนพูดจะอ่านไทยไม่ออกหรือเงียบไปเลย
          <br />
          ถ้าจะใช้ ต้องลงเสียงภาษาไทยในเครื่องก่อน ไม่งั้นเลือกชุดที่เป็นเสียงล้วนแทน
        </p>
      )}

      <div className="space-y-2">
        {kit.packs.map((p) => {
          const on = p.key === pick
          const off = p.kind === 'voice' && !thai
          return (
            <div
              key={p.key}
              className={`rounded-xl border p-3 ${on ? 'border-brand-500 bg-brand-50' : ''}`}
              style={{ opacity: off ? 0.5 : 1 }}
            >
              <button
                onClick={() => choose(p.key)}
                className="flex w-full items-start gap-3 text-left"
              >
                <span
                  className={`mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    on ? 'border-brand-500 bg-brand-500' : 'border-ink-300'
                  }`}
                >
                  {on && <span className="block h-2 w-2 rounded-full bg-ink" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-base font-extrabold">
                    {p.name}
                    {p.kind === 'voice' && (
                      <span className="rounded-md bg-ink px-2 py-[1px] text-[11px] font-bold text-white">
                        เสียงพูด
                      </span>
                    )}
                  </span>
                  <span className="block text-sm text-ink-500">{p.hint}</span>
                  {p.say && (
                    <span className="mt-1 block text-[12px] text-ink-400">
                      เลยเวลาพูดว่า “{p.say('late')}”
                    </span>
                  )}
                </span>
              </button>

              <div className="mt-2 flex flex-wrap gap-2 pl-8">
                {STAGES.map((s) => (
                  <button
                    key={s.k}
                    onClick={() => kit.previewStage(p.key, s.k)}
                    className="h-10 rounded-lg bg-canvas px-3 text-xs font-bold"
                  >
                    ▶ {s.label}
                  </button>
                ))}
                <button
                  onClick={() => kit.previewAll(p.key)}
                  className="h-10 rounded-lg border px-3 text-xs font-bold"
                >
                  ▶ ฟังทั้งสามขั้น
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={onClose}
        className="mt-4 h-12 w-full rounded-xl bg-ink text-sm font-extrabold text-white"
      >
        ใช้เสียง {kit.packs.find((p) => p.key === pick)?.name}
      </button>
    </Modal>
  )
}
