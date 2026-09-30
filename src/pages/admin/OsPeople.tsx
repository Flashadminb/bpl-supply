import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  deleteOsPerson,
  importOsPeople,
  issueOsCard,
  listOsPeople,
  osFlagTargets,
  revokeOsCard,
  saveOsPerson,
  setOsPersonActive,
  setOsPersonPhoto,
  uploadEvidence,
} from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import { readableError } from '../../lib/supabase'
import { compressImage, prettyBytes, releaseImage } from '../../lib/image'
import { osRowWarnings, parseOsPaste, photoKeyOf } from '../../lib/osImport'
import { EvidenceImg } from '../../components/EvidenceThumbs'
import { EmptyState, ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import { fmtDateTime } from '../../lib/format'
import type { OsPerson } from '../../lib/types'

/**
 * จัดการรายชื่อ OS — เจ้าของระบบ แอดมิน และผู้ตรวจสอบ
 *
 * สามงานที่ทำบ่อยสุดอยู่บนสุดทั้งหมด วางข้อมูล · อัปรูป · ออกบัตร
 * ส่วนการแก้รายคนอยู่ในตาราง เพราะนาน ๆ ทำที
 */

/** รูปหน้าไม่ต้องใหญ่ ใช้ดูหน้าคน ไม่ได้ใช้อ่านตัวหนังสือ */
const FACE_EDGE = 420

type Tab = 'all' | 'nocard' | 'nophoto' | 'warn'

export default function OsPeople() {
  const list = useAsync(() => listOsPeople(), [])
  const targets = useAsync(() => osFlagTargets(), [])
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  /* ------------------------------------------------ วางข้อมูลจากชีต */
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState<string | null>(null)
  const parsed = useMemo(() => parseOsPaste(paste), [paste])

  /* ---------------------------------------------------- อัปรูปทีละกอง */
  const filesRef = useRef<HTMLInputElement>(null)
  const [upBusy, setUpBusy] = useState(false)
  const [upLog, setUpLog] = useState<{ name: string; state: 'ok' | 'fail'; why?: string }[]>([])

  /* ------------------------------------------------------ แก้รายคน */
  const [edit, setEdit] = useState<Partial<OsPerson> | null>(null)
  const [saving, setSaving] = useState(false)

  const rows = list.data ?? []
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab === 'nocard' && r.has_card) return false
      if (tab === 'nophoto' && r.has_photo) return false
      if (tab === 'warn' && osRowWarnings(r).length === 0) return false
      if (!s) return true
      return `${r.full_name} ${r.os_code ?? ''} ${r.affiliation ?? ''} ${r.imei ?? ''} ${
        r.nickname ?? ''
      }`
        .toLowerCase()
        .includes(s)
    })
  }, [rows, tab, q])

  const noCard = rows.filter((r) => !r.has_card && r.is_active).length
  const noPhoto = rows.filter((r) => !r.has_photo && r.is_active).length
  const warned = rows.filter((r) => osRowWarnings(r).length > 0).length

  async function runImport() {
    setImporting(true)
    setErr(null)
    try {
      const res = await importOsPeople(parsed.rows)
      setImportDone(
        `เพิ่มใหม่ ${res.added} คน · อัปเดตของเดิม ${res.updated} คน` +
          (res.skipped ? ` · ข้าม ${res.skipped} แถว` : ''),
      )
      setPaste('')
      setPasteOpen(false)
      list.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setImporting(false)
    }
  }

  /**
   * อัปรูปทีละหลายสิบไฟล์ จับคู่จากชื่อไฟล์
   *
   * ลองรหัส OS ก่อน แล้วค่อยลองชื่อคน เพราะในชีตมีสิบกว่าคนที่ยังไม่มีรหัส
   * ไฟล์ไหนจับคู่ไม่ได้ขึ้นรายการค้างให้เห็น ไม่หายเงียบ
   */
  async function onPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    setUpBusy(true)
    setUpLog([])
    setErr(null)

    const byCode = new Map<string, OsPerson>()
    const byName = new Map<string, OsPerson>()
    for (const p of rows) {
      if (p.os_code) byCode.set(p.os_code.trim().toLowerCase(), p)
      byName.set(p.full_name.trim().toLowerCase(), p)
    }

    const log: typeof upLog = []
    for (const f of Array.from(files)) {
      const key = photoKeyOf(f.name)
      const who = byCode.get(key) ?? byName.get(key)
      if (!who) {
        log.push({ name: f.name, state: 'fail', why: 'จับคู่กับรายชื่อไม่ได้' })
        setUpLog([...log])
        continue
      }
      let img = null
      try {
        img = await compressImage(f, { quality: 0.82, maxEdge: FACE_EDGE })
        const up = await uploadEvidence(img.blob, `os-${who.os_code ?? who.id}.webp`)
        await setOsPersonPhoto(who.id, { file_id: up.fileId, web_link: up.webViewLink })
        log.push({ name: `${f.name} → ${who.full_name}`, state: 'ok' })
      } catch (e) {
        log.push({ name: f.name, state: 'fail', why: readableError(e) })
      } finally {
        releaseImage(img)
      }
      setUpLog([...log])
    }

    setUpBusy(false)
    list.reload()
  }

  async function doIssue(p: OsPerson) {
    setBusyId(p.id)
    setErr(null)
    try {
      await issueOsCard(p.id)
      list.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusyId(null)
    }
  }

  async function doRevoke(p: OsPerson) {
    if (!window.confirm(`ยกเลิกบัตรของ ${p.full_name}? บัตรที่พิมพ์ไปแล้วจะใช้ไม่ได้ทันที`)) return
    setBusyId(p.id)
    try {
      await revokeOsCard(p.id, 'ยกเลิกจากหน้าจัดการ')
      list.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusyId(null)
    }
  }

  async function save() {
    if (!edit?.full_name?.trim()) {
      setErr('ต้องใส่ชื่อ-นามสกุล')
      return
    }
    setSaving(true)
    try {
      await saveOsPerson(edit as OsPerson)
      setEdit(null)
      list.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">บัตร OS นำโทรศัพท์เข้าพื้นที่</h1>
          <p className="text-sm text-ink-400">
            รายชื่อ {rows.length} คน · รปภ สแกนบัตรที่ประตูเพื่อเทียบหน้าและเครื่อง
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/os/scans" className="btn-ghost">
            ประวัติการสแกน
          </Link>
          <Link to="/admin/os/print" className="btn-ghost">
            พิมพ์บัตร
          </Link>
          <button type="button" className="btn-ghost" onClick={() => filesRef.current?.click()}>
            อัปรูปหลายไฟล์
          </button>
          <button type="button" className="btn-primary" onClick={() => setPasteOpen(true)}>
            วางข้อมูลจากชีต
          </button>
        </div>
      </div>

      <input
        ref={filesRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void onPhotos(e.target.files)}
      />

      {err && <ErrorBox message={err} />}
      {importDone && (
        <div className="mb-3 rounded-card border border-success/25 bg-success-bg p-3 text-sm text-success-txt">
          {importDone}
          <button type="button" className="ml-2 underline" onClick={() => setImportDone(null)}>
            ปิด
          </button>
        </div>
      )}

      {(upBusy || upLog.length > 0) && (
        <div className="mb-3 rounded-card border border-line bg-surface p-3">
          <p className="flex items-center gap-2 font-display text-md">
            {upBusy && <Spinner />}
            อัปรูป {upLog.filter((l) => l.state === 'ok').length}/{upLog.length} สำเร็จ
            {!upBusy && (
              <button
                type="button"
                className="ml-auto text-sm text-ink-400 underline"
                onClick={() => setUpLog([])}
              >
                ปิด
              </button>
            )}
          </p>
          <ul className="mt-1 max-h-[180px] space-y-[2px] overflow-y-auto text-xs">
            {upLog.map((l, i) => (
              <li key={i} className={l.state === 'ok' ? 'text-ink-500' : 'text-danger-txt'}>
                {l.state === 'ok' ? '✓' : '✕'} {l.name}
                {l.why ? ` — ${l.why}` : ''}
              </li>
            ))}
          </ul>
          {!upBusy && upLog.some((l) => l.state === 'fail') && (
            <p className="mt-2 text-xs text-ink-400">
              ไฟล์ที่จับคู่ไม่ได้ ให้ตั้งชื่อไฟล์เป็นรหัส OS หรือชื่อ-นามสกุลให้ตรงกับในตาราง
              แล้วอัปใหม่เฉพาะไฟล์นั้น
            </p>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ['all', `ทั้งหมด ${rows.length}`],
            ['nocard', `ยังไม่มีบัตร ${noCard}`],
            ['nophoto', `ยังไม่มีรูป ${noPhoto}`],
            ['warn', `ข้อมูลไม่ครบ ${warned}`],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`chip ${tab === k ? 'chip-on' : ''}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
        <input
          className="input ml-auto w-[240px]"
          type="search"
          placeholder="ค้นชื่อ รหัส IMEI"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn-ghost h-10" onClick={() => setEdit({ full_name: '' })}>
          เพิ่มคน
        </button>
      </div>

      {list.loading && <Loading />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

      {!list.loading && shown.length === 0 && (
        <EmptyState
          title={rows.length === 0 ? 'ยังไม่มีรายชื่อ OS' : 'ไม่พบตามที่กรอง'}
          hint={
            rows.length === 0
              ? 'กดวางข้อมูลจากชีต แล้วก็อปแถวข้อมูลจาก Google Sheet มาวางได้เลย'
              : undefined
          }
        />
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2">รูป</th>
                <th className="px-3 py-2">ชื่อ</th>
                <th className="px-3 py-2">สังกัด · กะ</th>
                <th className="px-3 py-2">เครื่อง</th>
                <th className="px-3 py-2">บัตร</th>
                <th className="px-3 py-2">สแกนล่าสุด</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const warn = osRowWarnings(p)
                return (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <span className="block h-[54px] w-[44px] overflow-hidden rounded bg-surface-2">
                        {p.photo_file_id ? (
                          <EvidenceImg
                            fileId={p.photo_file_id}
                            enabled
                            alt={p.full_name}
                            className="h-full w-full"
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center text-[10px] text-ink-400">
                            ไม่มี
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={p.is_active ? '' : 'text-ink-400 line-through'}>
                        {p.full_name}
                      </span>
                      <span className="block font-mono text-xs text-ink-400">
                        {p.os_code ?? '— ไม่มีรหัส —'}
                        {p.nickname ? ` · ${p.nickname}` : ''}
                      </span>
                      {warn.length > 0 && (
                        <span className="mt-1 block text-xs text-warn-txt">{warn.join(' · ')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-500">
                      {p.affiliation ?? '—'}
                      <span className="block">{p.shift ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.phone_model ?? '—'}
                      <span className="block break-all font-mono text-ink-400">
                        {p.imei ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {p.has_card ? (
                        <span className="badge bg-success-bg text-success-txt">
                          ใบที่ {p.card_rev}
                        </span>
                      ) : (
                        <span className="badge bg-warn-bg text-warn-txt">ยังไม่มี</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-500">
                      {p.last_scan_at ? fmtDateTime(p.last_scan_at) : '—'}
                      <span className="block text-ink-400">{p.scan_count} ครั้ง</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        type="button"
                        className="btn-ghost h-9 px-3 text-sm"
                        onClick={() => setEdit(p)}
                      >
                        แก้ไข
                      </button>
                      <button
                        type="button"
                        className="btn-ghost ml-2 h-9 px-3 text-sm"
                        onClick={() => void doIssue(p)}
                        disabled={busyId === p.id}
                      >
                        {p.has_card ? 'ออกใบใหม่' : 'ออกบัตร'}
                      </button>
                      {p.has_card && (
                        <button
                          type="button"
                          className="btn-ghost ml-2 h-9 px-3 text-sm text-danger-txt"
                          onClick={() => void doRevoke(p)}
                          disabled={busyId === p.id}
                        >
                          ยกเลิก
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-400">
        กดแจ้งไม่ตรงจากหน้า รปภ จะเด้งหา {targets.data?.length ?? 0} คน ·
        เพิ่มคนรับ = ใส่ <span className="font-mono">STD</span> ในช่องแผนกย่อยที่หน้าผู้ใช้และสิทธิ์
      </p>

      {/* ------------------------------------------- วางข้อมูลจากชีต */}
      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title="วางข้อมูลจากชีต" width="max-w-[760px]">
        <p className="mb-2 text-sm text-ink-500">
          เปิด Google Sheet → ลากคลุม<b>เฉพาะแถวข้อมูล</b> (ไม่ต้องเอาหัวตาราง) → Ctrl+C → มาวางในช่องนี้
          <br />
          คนที่รหัส OS ซ้ำกับที่มีอยู่จะอัปเดตทับ ไม่สร้างซ้ำ · วางซ้ำได้ทุกเดือน
        </p>
        <textarea
          className="input min-h-[190px] w-full font-mono text-xs"
          placeholder="วางตรงนี้"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />

        {paste.trim() !== '' && (
          <div className="mt-3">
            <p className="font-display text-md">
              อ่านได้ {parsed.rows.length} คน
              {parsed.bad.length > 0 && (
                <span className="text-danger-txt"> · อ่านไม่ออก {parsed.bad.length} แถว</span>
              )}
            </p>

            {parsed.bad.length > 0 && (
              <ul className="mt-1 space-y-[2px] text-xs text-danger-txt">
                {parsed.bad.slice(0, 5).map((b) => (
                  <li key={b.line}>
                    บรรทัด {b.line}: {b.why} — {b.text}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 max-h-[220px] overflow-y-auto rounded-card border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-ink-400">
                  <tr>
                    <th className="px-2 py-1">รหัส</th>
                    <th className="px-2 py-1">ชื่อ</th>
                    <th className="px-2 py-1">สังกัด</th>
                    <th className="px-2 py-1">เครื่อง</th>
                    <th className="px-2 py-1">ที่ต้องดู</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r, i) => {
                    const w = osRowWarnings(r)
                    return (
                      <tr key={i} className="border-t border-line">
                        <td className="px-2 py-1 font-mono">{r.os_code ?? '—'}</td>
                        <td className="px-2 py-1">{r.full_name}</td>
                        <td className="px-2 py-1">{r.affiliation ?? '—'}</td>
                        <td className="px-2 py-1">
                          {r.phone_model ?? '—'}
                          <span className="block font-mono text-ink-400">{r.imei ?? '—'}</span>
                        </td>
                        <td className="px-2 py-1 text-warn-txt">{w.join(' · ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn-primary mt-3 w-full"
          onClick={() => void runImport()}
          disabled={importing || parsed.rows.length === 0}
        >
          {importing ? <Spinner /> : `บันทึก ${parsed.rows.length} คน`}
        </button>
      </Modal>

      {/* --------------------------------------------------- แก้รายคน */}
      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title={edit?.id ? `แก้ ${edit.full_name}` : 'เพิ่มพนักงาน OS'}
      >
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['full_name', 'ชื่อ-นามสกุล', true],
                ['os_code', 'รหัสพนักงาน OS', false],
                ['affiliation', 'สังกัด', false],
                ['shift', 'กะ', false],
                ['phone_model', 'รุ่นโทรศัพท์', false],
                ['imei', 'IMEI', false],
                ['nickname', 'ชื่อเล่น', false],
                ['note', 'หมายเหตุ', false],
              ] as [keyof OsPerson, string, boolean][]
            ).map(([k, label, wide]) => (
              <span key={k} className={wide ? 'col-span-2' : ''}>
                <label className="label" htmlFor={`os-${k}`}>
                  {label}
                </label>
                <input
                  id={`os-${k}`}
                  className="input w-full"
                  value={(edit[k] as string) ?? ''}
                  onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                />
              </span>
            ))}

            {edit.id && (
              <span className="col-span-2">
                <button
                  type="button"
                  className="btn-ghost w-full"
                  onClick={() => {
                    void setOsPersonActive(edit.id as string, !edit.is_active).then(() => {
                      setEdit(null)
                      list.reload()
                    })
                  }}
                >
                  {edit.is_active ? 'ปิดการใช้งานคนนี้' : 'เปิดใช้งานอีกครั้ง'}
                </button>
                <button
                  type="button"
                  className="mt-2 w-full text-center text-xs text-danger-txt underline"
                  onClick={() => {
                    if (!window.confirm(`ลบ ${edit.full_name} ออกจากระบบถาวร?`)) return
                    void deleteOsPerson(edit.id as string).then(() => {
                      setEdit(null)
                      list.reload()
                    })
                  }}
                >
                  ลบถาวร
                </button>
              </span>
            )}

            <button
              type="button"
              className="btn-primary col-span-2"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? <Spinner /> : 'บันทึก'}
            </button>
          </div>
        )}
      </Modal>

      <p className="mt-4 text-xs text-ink-400">
        รูปย่อเหลือด้านยาวสุด {FACE_EDGE}px ก่อนอัป (~{prettyBytes(25 * 1024)} ต่อใบ)
        เพราะใช้ดูหน้าคน ไม่ได้ใช้อ่านตัวหนังสือ — รูปใหญ่กว่านี้กิน egress โดยไม่ได้อะไรเพิ่ม
      </p>
    </div>
  )
}
