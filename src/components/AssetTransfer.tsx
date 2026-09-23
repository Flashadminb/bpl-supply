import { useState } from 'react'
import { assetTransfer } from '../lib/api'
import { readableError } from '../lib/supabase'
import { fmtDateTime } from '../lib/format'
import { Sheet, Spinner } from './ui'
import type { Asset, AssetHolding, Department } from '../lib/types'

/**
 * โอนเครื่องให้แผนกอื่นใช้ชั่วคราว
 *
 * ปัญหาที่แก้: รถแดงคันหนึ่งอยู่กับแผนก A ทั้งกะ แต่แผนก B ต้องใช้ด่วน
 * แผนก B มองไม่เห็นเครื่องนั้นในระบบ จึงเบิกไม่ได้เลยแม้จะเดินไปเอามาได้จริง
 *
 * การโอนไม่ได้ยัดเครื่องใส่มือแผนก B แต่เปิดสิทธิ์ให้ไปกดเบิกเองตามขั้นตอน
 * ตั้งใจให้เป็นแบบนี้ เพราะจังหวะกดเบิกคือจังหวะที่ถ่ายรูปสภาพเครื่อง
 * ถ้าโอนแล้วผูกให้เลย จะไม่มีหลักฐานว่าตอนรับมอบสภาพเป็นยังไง
 * แล้วพอมีรอยเพิ่มทีหลังจะเถียงกันไม่จบว่าใครทำ
 *
 * ฝั่งแผนก A ที่ถืออยู่ ระบบตัดรายการค้างให้ทันทีเฉพาะเครื่องนี้
 * เครื่องอื่นในใบเดียวกันยังค้างชื่อเขาตามเดิม
 */
export function AssetTransfer({
  asset,
  holding,
  depts,
  onClose,
  onDone,
}: {
  asset: Asset | null
  holding: AssetHolding | undefined
  depts: Department[]
  onClose: () => void
  onDone: () => void
}) {
  const [toDept, setToDept] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const here = asset?.loan_dept ?? asset?.dept_code ?? 'ALL'
  const options = depts.filter((d) => d.code !== here && d.code !== 'ALL')

  async function go() {
    if (!asset || !toDept) return
    setBusy(true)
    setError(null)
    try {
      await assetTransfer(asset.code, toDept, reason.trim() || undefined)
      setToDept('')
      setReason('')
      onDone()
      onClose()
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={Boolean(asset)}
      title={`โอนเครื่อง ${asset?.code ?? ''}`}
      onClose={() => {
        setError(null)
        onClose()
      }}
    >
      {asset && (
        <>
          <p className="text-sm text-ink-500">
            {asset.asset_types?.name ?? asset.type_code} · ตอนนี้อยู่แผนก{' '}
            <b className="text-ink">{here === 'ALL' ? 'ส่วนกลาง' : here}</b>
          </p>

          {holding ? (
            <div className="mt-3 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
              ตอนนี้ <b>{holding.holder_name}</b> ถืออยู่ ตั้งแต่ {fmtDateTime(holding.taken_at)}
              <br />
              พอกดโอน เครื่องนี้จะหลุดจากรายการค้างของเขาทันที และเขาจะได้รับแจ้งว่าไม่ต้องคืนแล้ว
              {/* ย้ำว่าตัดเฉพาะเครื่องนี้ ไม่ใช่ล้างทั้งใบ — เป็นคำถามแรกที่จะถูกถาม */}
              <br />
              เครื่องอื่นที่เขาเบิกไว้ในใบเดียวกันยังค้างตามเดิม
            </div>
          ) : (
            <div className="mt-3 rounded-btn bg-surface-2 px-3 py-2 text-sm text-ink-500">
              ตอนนี้เครื่องว่างอยู่ โอนแล้วแผนกปลายทางไปกดเบิกได้เลย
            </div>
          )}

          <label className="label mt-3" htmlFor="tr-dept">
            โอนให้แผนก
          </label>
          <select
            id="tr-dept"
            className="input"
            value={toDept}
            onChange={(e) => setToDept(e.target.value)}
          >
            <option value="">— เลือกแผนก —</option>
            {options.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>

          <label className="label mt-3" htmlFor="tr-why">
            เหตุผล (ไม่บังคับ)
          </label>
          <input
            id="tr-why"
            className="input"
            placeholder="เช่น ต้องใช้ลงของด่วน"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <p className="mt-3 rounded-btn bg-brand-50 px-3 py-2 text-sm text-ink-700">
            แผนกปลายทางจะเห็นแถบเตือนว่ามีเครื่องโอนมาให้ และต้องกดเบิกเองตามขั้นตอน
            เพื่อให้มีรูปสภาพตอนรับของ
          </p>

          {error && (
            <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">{error}</p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !toDept}
              onClick={() => void go()}
            >
              {busy ? <Spinner /> : null} ยืนยันโอน
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
