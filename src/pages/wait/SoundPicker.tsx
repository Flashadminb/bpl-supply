import { useState } from 'react'
import { Modal } from '../../components/ui'
import { getPackKey, previewStage, previewWaitAll, setPackKey, WAIT_PACKS } from './waitAlarm'
import type { Stage } from '../trucks/alarm'

/**
 * เลือกชุดเสียงเตือน
 *
 * เสียงที่ตัดผ่านเสียงสายพานได้ กับเสียงที่ฟังทั้งกะแล้วไม่รำคาญ
 * เป็นคนละเรื่องกัน และขึ้นกับคลังจริงที่ไม่มีทางรู้จากฝั่งโค้ด
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

export function SoundPicker({ onClose }: { onClose: () => void }) {
  const [pick, setPick] = useState(getPackKey)

  function choose(k: string) {
    setPick(k)
    setPackKey(k)
    previewStage(k, 'late')
  }

  return (
    <Modal open onClose={onClose} title="เลือกเสียงเตือนรถรอลงงาน">
      <p className="mb-3 text-sm text-ink-500">
        กดที่ชื่อชุดเพื่อเลือกและฟังเสียงเลยกำหนด · กดปุ่มขั้นเพื่อฟังทีละขั้น
        <br />
        เสียงชุดนี้ใช้เฉพาะรถรอลงงาน ไม่เกี่ยวกับเสียงของตารางปล่อยรถ
      </p>

      <div className="space-y-2">
        {WAIT_PACKS.map((p) => {
          const on = p.key === pick
          return (
            <div
              key={p.key}
              className={`rounded-xl border p-3 ${on ? 'border-brand-500 bg-brand-50' : ''}`}
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
                  <span className="block text-base font-extrabold">{p.name}</span>
                  <span className="block text-sm text-ink-500">{p.hint}</span>
                </span>
              </button>

              <div className="mt-2 flex flex-wrap gap-2 pl-8">
                {STAGES.map((s) => (
                  <button
                    key={s.k}
                    onClick={() => previewStage(p.key, s.k)}
                    className="h-10 rounded-lg bg-canvas px-3 text-xs font-bold"
                  >
                    ▶ {s.label}
                  </button>
                ))}
                <button
                  onClick={() => previewWaitAll(p.key)}
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
        ใช้เสียง {WAIT_PACKS.find((p) => p.key === pick)?.name}
      </button>
    </Modal>
  )
}
