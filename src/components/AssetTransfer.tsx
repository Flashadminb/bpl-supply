import { useEffect, useMemo, useState } from 'react'
import { assetTransferMany, listTransferTargets } from '../lib/api'
import { readableError } from '../lib/supabase'
import { fmtDateTime } from '../lib/format'
import { Sheet, Spinner } from './ui'
import type { Asset, AssetHolding, TransferTargetRow } from '../lib/types'

/**
 * ข้อมูลเครื่องเท่าที่หน้าต่างนี้ใช้จริง
 *
 * หน้าทะเบียนส่งวัตถุ Asset เต็ม ๆ มาได้อยู่แล้ว
 * แต่หน้าของค้างคืนมีแค่แถว holding ในมือ การบังคับให้ไปโหลดทะเบียน
 * ทั้ง 139 เครื่องมาเพื่อเปิดหน้าต่างเดียวคือการจ่ายโควต้าฟรี ๆ
 */
export type TransferTarget = Pick<Asset, 'code' | 'type_code' | 'dept_code'> & {
  asset_types?: { name: string } | null
}

/** เครื่องอื่นที่เลือกโอนไปพร้อมกันได้ */
export interface TransferCandidate {
  code: string
  type_name: string
  /** แผนกเจ้าของเครื่อง · ไว้โชว์เฉย ๆ ให้รู้ว่าเครื่องมาจากไหน */
  dept: string | null
  /** ใครถืออยู่ · ว่าง = เครื่องว่าง */
  holder?: string | null
  /** id ของคนที่ถืออยู่ · ใช้คัดเครื่องที่อยู่กับผู้รับโอนอยู่แล้วออก */
  holderId?: string | null
}

/** ประกอบร่างจากแถวของค้างคืน ให้ใช้แทนวัตถุ Asset เต็มได้ */
export function targetFromHolding(h: AssetHolding): TransferTarget {
  return {
    code: h.asset_code,
    type_code: h.type_code,
    dept_code: h.asset_dept,
    asset_types: { name: h.type_name },
  }
}

/** แถวของค้างคืน → ตัวเลือกในรายการโอนพร้อมกัน */
export function candidateFromHolding(h: AssetHolding): TransferCandidate {
  return {
    code: h.asset_code,
    type_name: h.type_name,
    dept: h.asset_dept,
    holder: h.holder_name,
    holderId: h.user_id,
  }
}

/**
 * โอนเครื่องให้คนอื่นใช้ชั่วคราว
 *
 * ปัญหาที่แก้: รถแดงคันหนึ่งอยู่กับคนหนึ่งทั้งกะ แต่อีกแผนกต้องใช้ด่วน
 * คนที่อยากใช้มองไม่เห็นเครื่องนั้นในระบบ จึงเบิกไม่ได้เลยแม้จะเดินไปเอามาได้จริง
 *
 * เดิมโอนเป็น "แผนก" ซึ่งแปลว่าทั้งแผนกเห็นและแย่งกดเบิกได้
 * ตอนนี้ระบุเป็น "คน" ตรงกับที่หน้างานพูดกันจริงว่าให้พี่คนนั้นไปใช้ก่อน
 * และเห็นคนเดียวคือคนที่ถูกระบุชื่อ ไม่หลุดไปให้คนอื่นกดตัดหน้า
 *
 * การโอนไม่ได้ยัดเครื่องใส่มือเขา แต่เปิดสิทธิ์ให้ไปกดเบิกเองตามขั้นตอน
 * ตั้งใจให้เป็นแบบนี้ เพราะจังหวะกดเบิกคือจังหวะที่ถ่ายรูปสภาพเครื่อง
 * ถ้าโอนแล้วผูกให้เลย จะไม่มีหลักฐานว่าตอนรับมอบสภาพเป็นยังไง
 * แล้วพอมีรอยเพิ่มทีหลังจะเถียงกันไม่จบว่าใครทำ
 *
 * ฝั่งที่ถืออยู่ ระบบตัดรายการค้างให้ทันทีเฉพาะเครื่องที่โอน
 * เครื่องอื่นในใบเดียวกันยังค้างชื่อเขาตามเดิม
 */
export function AssetTransfer({
  asset,
  holding,
  candidates = [],
  onClose,
  onDone,
}: {
  asset: TransferTarget | null
  holding: AssetHolding | undefined
  candidates?: TransferCandidate[]
  onClose: () => void
  onDone: () => void
}) {
  const [to, setTo] = useState<TransferTargetRow | null>(null)
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<TransferTargetRow[]>([])
  const [loadingPeople, setLoadingPeople] = useState(false)
  const [reason, setReason] = useState('')
  const [also, setAlso] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = Boolean(asset)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoadingPeople(true)
    listTransferTargets()
      .then((r) => alive && setPeople(r))
      .catch((e) => alive && setError(readableError(e)))
      .finally(() => alive && setLoadingPeople(false))
    return () => {
      alive = false
    }
  }, [open])

  // กรองในเครื่อง รายชื่อไม่กี่สิบคน ไม่ต้องยิงถามทุกตัวอักษร
  const shownPeople = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return people
    return people.filter((r) =>
      `${r.full_name} ${r.employee_code} ${r.dept_code ?? ''} ${r.sub_dept ?? ''}`
        .toLowerCase()
        .includes(s),
    )
  }, [people, q])

  /** เครื่องอื่นที่ยังไม่ได้อยู่กับผู้รับโอน และไม่ใช่ตัวที่กดเปิด */
  const alsoCan = useMemo(() => {
    if (!asset || !to) return []
    return candidates.filter((c) => c.code !== asset.code && c.holderId !== to.id)
  }, [candidates, asset, to])

  const picked = asset ? [asset.code, ...also.filter((c) => alsoCan.some((x) => x.code === c))] : []

  function reset() {
    setTo(null)
    setQ('')
    setReason('')
    setAlso([])
    setError(null)
  }

  async function go() {
    if (!asset || !to) return
    setBusy(true)
    setError(null)
    try {
      await assetTransferMany(picked, to.id, reason.trim() || undefined)
      reset()
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
      open={open}
      title={`โอนเครื่อง ${asset?.code ?? ''}`}
      onClose={() => {
        setError(null)
        onClose()
      }}
    >
      {asset && (
        <>
          <p className="text-sm text-ink-500">
            {asset.asset_types?.name ?? asset.type_code}
            {asset.dept_code ? ` · เครื่องของแผนก ${asset.dept_code}` : ''}
          </p>

          {holding ? (
            <div className="mt-3 rounded-btn bg-warn-bg px-3 py-2 text-sm text-warn-txt">
              ตอนนี้ <b>{holding.holder_name}</b> ถืออยู่ ตั้งแต่ {fmtDateTime(holding.taken_at)}
              <br />
              พอกดโอน เครื่องนี้จะหลุดจากรายการค้างของเขาทันที และเขาจะได้รับแจ้งว่าไม่ต้องคืนแล้ว
              {/* ย้ำว่าตัดเฉพาะเครื่องที่โอน ไม่ใช่ล้างทั้งใบ — เป็นคำถามแรกที่จะถูกถาม */}
              <br />
              เครื่องอื่นที่เขาเบิกไว้ในใบเดียวกันยังค้างตามเดิม
            </div>
          ) : (
            <div className="mt-3 rounded-btn bg-surface-2 px-3 py-2 text-sm text-ink-500">
              ตอนนี้เครื่องว่างอยู่ โอนแล้วคนที่รับไปกดเบิกได้เลย
            </div>
          )}

          {/* ---------------------------------------------------- เลือกคน */}
          <p className="label mt-3">โอนให้ใคร</p>

          {to ? (
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-card border border-ink bg-brand-50 p-3 text-left"
              onClick={() => setTo(null)}
            >
              <span className="min-w-0 flex-1">
                <span className="font-display">{to.full_name}</span>
                <span className="block text-sm text-ink-500">
                  {to.employee_code}
                  {to.dept_code ? ` · ${to.dept_code}` : ''}
                  {to.sub_dept ? ` · ${to.sub_dept}` : ''}
                </span>
              </span>
              <span className="text-sm underline">เปลี่ยน</span>
            </button>
          ) : (
            <>
              <input
                className="input"
                type="search"
                placeholder="ค้นหาชื่อ รหัสพนักงาน หรือแผนก"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="mt-2 max-h-[240px] overflow-y-auto rounded-card border border-line">
                {loadingPeople && (
                  <p className="p-3 text-sm text-ink-400">
                    <Spinner /> กำลังโหลดรายชื่อ…
                  </p>
                )}
                {!loadingPeople && shownPeople.length === 0 && (
                  <p className="p-3 text-sm text-ink-400">ไม่พบคนตามคำค้น</p>
                )}
                <ul>
                  {shownPeople.map((r) => (
                    <li key={r.id} className="border-b border-line last:border-0">
                      <button
                        type="button"
                        className="w-full p-3 text-left"
                        onClick={() => {
                          setTo(r)
                          setQ('')
                        }}
                      >
                        <span className="font-display">{r.full_name}</span>
                        <span className="block text-sm text-ink-500">
                          {r.employee_code}
                          {r.dept_code ? ` · ${r.dept_code}` : ''}
                          {r.sub_dept ? ` · ${r.sub_dept}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {/* คนที่เบิก Asset ไม่ได้ถูกตัดออกจากรายการแล้ว
                  ถ้าไม่บอกไว้ จะงงว่าทำไมหาชื่อคนที่ต้องการไม่เจอ */}
              <p className="mt-1 text-xs text-ink-400">
                รายชื่อนี้ไม่รวมคนที่เบิก Asset ไม่ได้ เพราะโอนไปแล้วเขาจะกดรับไม่ได้
              </p>
            </>
          )}

          {alsoCan.length > 0 && (
            <>
              <p className="label mt-3">โอนเครื่องอื่นไปพร้อมกัน (ไม่บังคับ)</p>
              <ul className="max-h-[220px] space-y-1 overflow-y-auto">
                {alsoCan.map((c) => {
                  const on = also.includes(c.code)
                  return (
                    <li key={c.code}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-3 rounded-card border p-2 text-left ${
                          on ? 'border-ink bg-brand-50' : 'border-line bg-surface'
                        }`}
                        onClick={() =>
                          setAlso((v) =>
                            v.includes(c.code) ? v.filter((x) => x !== c.code) : [...v, c.code],
                          )
                        }
                      >
                        <span
                          aria-hidden
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-btn border text-sm ${
                            on ? 'border-ink bg-ink text-white' : 'border-line-2 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-display">{c.code}</span>
                          <span className="block truncate text-xs text-ink-500">
                            {c.type_name}
                            {c.dept ? ` · ${c.dept}` : ''}
                            {c.holder ? ` · ${c.holder} ถืออยู่` : ' · ว่าง'}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

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
            คนที่รับจะเห็นแถบเตือนว่ามีเครื่องโอนมาให้ และต้องกดเบิกเองตามขั้นตอน
            เพื่อให้มีรูปสภาพตอนรับของ · พอคืนแล้วเครื่องกลับไปอยู่แผนกเดิมเหมือนเดิม
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
              disabled={busy || !to}
              onClick={() => void go()}
            >
              {busy ? <Spinner /> : null}
              {to ? `ยืนยันโอน ${picked.length} เครื่อง` : 'เลือกคนก่อน'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
