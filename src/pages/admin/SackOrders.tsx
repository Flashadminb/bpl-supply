import { useState } from 'react'
import {
  countSackExportRows,
  createSackOrder,
  deleteSackOrder,
  exportToSheet,
  updateSackOrder,
  listSackOrders,
  sackBranches,
  sackNotifyTargets,
} from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { useAuth } from '../../lib/auth'
import { MANAGER_ROLES } from '../../lib/roles'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { SackFormView } from '../../components/SackFormView'
import { sackStatusLabel } from '../../lib/sackCard'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { SackRow } from '../../lib/types'

/**
 * กระจายกระสอบ — ฝั่งเว็บ
 *
 * ใครเห็น    แอดมินและผู้ตรวจสอบ
 * ใครตั้งได้  เจ้าของระบบกับแอดมินเท่านั้น (ฐานข้อมูลกันอีกชั้น ไม่ได้กันแค่ปุ่ม)
 *
 * ผู้ตรวจสอบเห็นแต่ไม่ได้ตั้ง เพราะหน้าที่เขาคือตามว่าของถึงหรือยัง
 * ไม่ใช่สั่งงาน ถ้าให้ตั้งได้ ของจะโผล่เข้าคิวโดยส่วนกลางไม่ได้สั่ง
 */

type Tab = 'pending' | 'sent'

export default function SackOrders() {
  const { can } = useAuth()
  const mayCreate = can(...MANAGER_ROLES)

  const [tab, setTab] = useState<Tab>('pending')
  const list = useAsync(() => listSackOrders({ status: 'all', limit: 300 }), [])
  const branches = useAsync(() => sackBranches(), [])
  const targets = useAsync(() => (mayCreate ? sackNotifyTargets() : Promise.resolve([])), [mayCreate])

  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState<'ชิ้น' | 'กระสอบ'>('ชิ้น')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [made, setMade] = useState<string | null>(null)

  const [view, setView] = useState<SackRow | null>(null)
  /** ใบที่กำลังแก้อยู่ · null = กล่องนี้กำลังใช้ตั้งรายการใหม่ */
  const [editing, setEditing] = useState<SackRow | null>(null)

  /**
   * ส่งลง Google Sheet — คนละไฟล์กับของเบิก
   *
   * ใบที่ยังไม่ได้ส่งของก็ลงไปด้วย ส่วนกลางจะได้เห็นคิวที่ค้าง
   * พอหน้างานกดส่ง กดปุ่มนี้อีกทีจะเขียนทับแถวเดิม สถานะในชีตขยับตามเอง
   */
  const pendingPush = useAsync(() => (mayCreate ? countSackExportRows() : Promise.resolve(0)), [mayCreate])
  const [pushing, setPushing] = useState(false)
  const [pushed, setPushed] = useState<string | null>(null)

  async function pushSheet() {
    setPushing(true)
    setErr(null)
    setPushed(null)
    try {
      const res = await exportToSheet({ scope: 'sack' })
      setPushed(`เพิ่มใหม่ ${res.appended} แถว · อัปของเดิม ${res.updated} แถว · ${res.sheet}`)
      pendingPush.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ส่งลงชีตไม่สำเร็จ')
    } finally {
      setPushing(false)
    }
  }

  const rows = list.data ?? []
  const shown = rows.filter((r) => (tab === 'pending' ? r.status === 'pending' : r.status !== 'pending'))
  const pendingCount = rows.filter((r) => r.status === 'pending').length
  const notify = targets.data ?? []

  function openCreate() {
    setEditing(null)
    setBranch('')
    setQty('')
    setUnit('ชิ้น')
    setNote('')
    setErr(null)
    setOpen(true)
  }

  function openEdit(row: SackRow) {
    setEditing(row)
    setBranch(row.branch)
    setQty(String(row.qty))
    setUnit(row.unit === 'กระสอบ' ? 'กระสอบ' : 'ชิ้น')
    setNote(row.note ?? '')
    setErr(null)
    setOpen(true)
  }

  async function submit() {
    const n = Number(qty)
    if (!branch.trim()) {
      setErr('ต้องใส่ชื่อสาขาที่ขอ')
      return
    }
    if (!Number.isFinite(n) || n <= 0) {
      setErr('จำนวนต้องมากกว่าศูนย์')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      if (editing) {
        const res = await updateSackOrder({
          id: editing.id,
          branch: branch.trim(),
          qty: Math.round(n),
          unit,
          // สตริงว่าง = ลบหมายเหตุทิ้ง ซึ่งต่างจากไม่ส่งมาเลย
          note: note.trim(),
        })
        setMade(`แก้ ${res.ref_no} แล้ว · ${res.branch} ${res.qty.toLocaleString('th-TH')} ${res.unit}`)
      } else {
        const res = await createSackOrder({
          branch: branch.trim(),
          qty: Math.round(n),
          unit,
          note: note.trim() || null,
        })
        setMade(`ตั้งรายการ ${res.ref_no} แล้ว · แจ้งเตือนไปหา ${notify.length} คน`)
        setTab('pending')
      }
      setOpen(false)
      setEditing(null)
      setBranch('')
      setQty('')
      setNote('')
      list.reload()
      branches.reload()
      pendingPush.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : editing ? 'แก้รายการไม่สำเร็จ' : 'ตั้งรายการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: SackRow) {
    if (!window.confirm(`ลบ ${row.ref_no} (${row.branch}) ทิ้ง?`)) return
    try {
      await deleteSackOrder(row.id)
      list.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">กระจายกระสอบ</h1>
          <p className="text-sm text-ink-400">
            ส่วนกลางส่งกระสอบมาที่ฮับ แล้วเรากระจายต่อไปสาขาปลายทาง
          </p>
        </div>
        {mayCreate && (
          <span className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={pushSheet} disabled={pushing}>
              {pushing ? <Spinner /> : 'ส่งลง Google Sheet'}
              {!pushing && (pendingPush.data ?? 0) > 0 && (
                <span className="rounded-pill bg-brand-500 px-2 font-display text-xs text-ink">
                  {(pendingPush.data ?? 0) > 99 ? '99+' : pendingPush.data}
                </span>
              )}
            </button>
            <button type="button" className="btn-primary" onClick={openCreate}>
              ตั้งรายการใหม่
            </button>
          </span>
        )}
      </div>

      {pushed && (
        <div className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          ส่งลงชีตแล้ว · {pushed}
          <button type="button" className="ml-2 underline" onClick={() => setPushed(null)}>
            ปิด
          </button>
        </div>
      )}

      {made && (
        <div className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          {made}
          <button type="button" className="ml-2 underline" onClick={() => setMade(null)}>
            ปิด
          </button>
        </div>
      )}

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className={`chip ${tab === 'pending' ? 'chip-on' : ''}`}
          onClick={() => setTab('pending')}
        >
          รอส่ง {pendingCount > 0 && `· ${pendingCount}`}
        </button>
        <button
          type="button"
          className={`chip ${tab === 'sent' ? 'chip-on' : ''}`}
          onClick={() => setTab('sent')}
        >
          ส่งแล้ว
        </button>
      </div>

      {list.loading && <Loading />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {err && <ErrorBox message={err} />}

      {!list.loading && !list.error && shown.length === 0 && (
        <EmptyState
          title={tab === 'pending' ? 'ไม่มีรายการรอส่ง' : 'ยังไม่มีรายการที่ส่งแล้ว'}
          hint={tab === 'pending' && mayCreate ? 'กดตั้งรายการใหม่เพื่อเข้าคิวให้หน้างาน' : undefined}
        />
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2">เลขที่</th>
                <th className="px-3 py-2">สาขาที่ขอ</th>
                <th className="px-3 py-2 text-right">จำนวน</th>
                <th className="px-3 py-2">สถานะ</th>
                <th className="px-3 py-2">ผู้ส่ง</th>
                <th className="px-3 py-2">รูป</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.ref_no}
                    <span className="block text-ink-400">{relativeAge(r.created_at)}</span>
                  </td>
                  <td className="px-3 py-2">
                    {r.branch}
                    {r.note && <span className="block text-xs text-ink-400">{r.note}</span>}
                    {r.updated_by_name && (
                      <span className="block text-xs text-warn-txt">
                        แก้โดย {r.updated_by_name}
                        {r.updated_at ? ` · ${fmtDateTime(r.updated_at)}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-display">
                    {r.qty.toLocaleString('th-TH')} {r.unit}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`badge ${
                        r.status === 'pending'
                          ? 'bg-warn-bg text-warn-txt'
                          : r.status === 'relay'
                            ? 'bg-brand-100 text-ink-700'
                            : 'bg-success-bg text-success-txt'
                      }`}
                    >
                      {sackStatusLabel(r)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500">
                    {r.sent_by_name ?? '—'}
                    {r.sent_at && <span className="block text-ink-400">{fmtDateTime(r.sent_at)}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500">{r.photo_count || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button type="button" className="btn-ghost h-9 px-3 text-sm" onClick={() => setView(r)}>
                      ฟอร์ม
                    </button>
                    {mayCreate && (
                      <button
                        type="button"
                        className="btn-ghost ml-2 h-9 px-3 text-sm"
                        onClick={() => openEdit(r)}
                      >
                        แก้ไข
                      </button>
                    )}
                    {mayCreate && r.status === 'pending' && (
                      <button
                        type="button"
                        className="btn-ghost ml-2 h-9 px-3 text-sm text-danger-txt"
                        onClick={() => remove(r)}
                      >
                        ลบ
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------ ตั้งรายการใหม่ */}
      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          setEditing(null)
        }}
        title={editing ? `แก้ ${editing.ref_no}` : 'ตั้งรายการกระสอบ'}
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="sack-branch">
              สาขาที่ขอ
            </label>
            <input
              id="sack-branch"
              className="input w-full"
              list="sack-branch-list"
              placeholder="พิมพ์ชื่อสาขา"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
            <datalist id="sack-branch-list">
              {(branches.data ?? []).map((b) => (
                <option key={b.branch} value={b.branch} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-ink-400">
              รายการสาขาโตเองจากการใช้งาน เลือกจากที่เคยพิมพ์จะได้ชื่อตรงกันทุกใบ
            </p>
          </div>

          <div className="flex gap-3">
            <span className="flex-1">
              <label className="label" htmlFor="sack-qty">
                จำนวน
              </label>
              <input
                id="sack-qty"
                className="input w-full"
                type="number"
                inputMode="numeric"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </span>
            <span>
              <p className="label">หน่วย</p>
              <div className="flex gap-2">
                {(['ชิ้น', 'กระสอบ'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={`chip ${unit === u ? 'chip-on' : ''}`}
                    onClick={() => setUnit(u)}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </span>
          </div>

          <div>
            <label className="label" htmlFor="sack-note">
              หมายเหตุ · ไม่บังคับ
            </label>
            <input
              id="sack-note"
              className="input w-full"
              placeholder="เช่น ของด่วน รอบเช้า"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/*
            แก้ใบที่หน้างานส่งของไปแล้ว ตัวเลขในระบบจะไม่ตรงกับใบที่เขาถือไปตอนนั้น
            ไม่ได้ห้าม เพราะเคสที่เจอบ่อยคือตั้งไว้ผิดแล้วเขาส่งตามจำนวนจริง
            แต่ต้องรู้ตัวว่ากำลังแก้อะไรอยู่
          */}
          {editing && editing.status !== 'pending' && (
            <p className="rounded-card border border-warn/30 bg-warn-bg p-3 text-sm text-warn-txt">
              ใบนี้หน้างานกดส่งไปแล้ว ({sackStatusLabel(editing)}) ·
              แก้ได้ แต่ฟอร์มกับการ์ดที่เขาส่งออกไปแล้วจะไม่ตรงกับตัวเลขใหม่
            </p>
          )}

          {editing?.updated_by_name && (
            <p className="text-xs text-ink-400">
              แก้ล่าสุดโดย {editing.updated_by_name}
              {editing.updated_at ? ` · ${fmtDateTime(editing.updated_at)}` : ''}
            </p>
          )}

          {/* ใครจะได้รับแจ้งเตือน — โชว์ก่อนกด · ตอนแก้ไม่ได้ยิงแจ้งเตือนซ้ำ */}
          {!editing && (
          <div className="rounded-card border border-line bg-surface-2 p-3">
            <p className="text-sm font-medium text-ink-700">
              กดแล้วเด้งเตือน {notify.length} คน
            </p>
            <ul className="mt-1 space-y-[2px] text-xs text-ink-500">
              {notify.map((t) => (
                <li key={t.employee_code}>
                  {t.full_name} · {t.reason}
                  {!t.has_push && <span className="text-warn-txt"> · ยังไม่เปิดแจ้งเตือน</span>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-400">
              เพิ่มคนในทีมซัพพอร์ต = ใส่ SPADMIN ในช่องแผนกย่อยของเขาที่หน้าผู้ใช้และสิทธิ์
            </p>
          </div>
          )}

          {err && <ErrorBox message={err} />}

          <button type="button" className="btn-primary w-full" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : editing ? 'บันทึกการแก้ไข' : 'ตั้งรายการและแจ้งเตือน'}
          </button>
        </div>
      </Modal>

      {/* ------------------------------------------------------ ดูฟอร์ม */}
      <Modal
        open={Boolean(view)}
        onClose={() => setView(null)}
        title={view ? `${view.ref_no} · ${view.branch}` : ''}
      >
        {view && <SackFormView row={view} />}
      </Modal>
    </div>
  )
}
