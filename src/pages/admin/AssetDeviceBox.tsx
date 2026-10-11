import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  assetHistory,
  assetReturn,
  cancelTransfer,
  listAssetIssues,
  resolveAssetIssue,
  resolveAssetIssuesFor,
  TRANSFER_CANCEL_REASONS,
} from '../../lib/api'
import { IssueFixSheet } from '../../components/IssueFixSheet'
import { useAuth } from '../../lib/auth'
import { deptName } from '../../lib/deptNames'
import { fmtDateTime } from '../../lib/format'
import { stampLines } from '../../lib/image'
import { readableError } from '../../lib/supabase'
import { AssetTransfer, type TransferCandidate } from '../../components/AssetTransfer'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { PartBoundary } from '../../components/ErrorBoundary'
import { ErrorBox, Loading, Modal, Spinner } from '../../components/ui'
import type { AssetBoardRow } from '../../lib/types'

/**
 * กล่องของเครื่องเดียว · ดูประวัติและสั่งงานจบในที่เดียว
 *
 * ทุกปุ่มเรียกคำสั่งตัวเดียวกับที่หน้าอื่นใช้อยู่ ไม่ได้เขียนทางเดินใหม่ซ้อนของเดิม
 * ถ้าเขียนใหม่ วันหนึ่งกติกาฝั่งหนึ่งจะเปลี่ยนแล้วอีกฝั่งไม่เปลี่ยนตาม
 * แล้วจะมีเครื่องที่คืนจากกระดานได้แต่คืนจากหน้าคืนของไม่ได้ โดยไม่มีใครรู้ว่าทำไม
 *
 * กล่องถ่ายรูปกับกล่องโอน เป็นตัวเดียวกับที่หน้าคืนของใช้ ไม่ได้ลอกมาวาง
 */

const TONE: Record<string, { bg: string; txt: string; label: string }> = {
  free: { bg: '#25A35A', txt: '#fff', label: 'ว่าง' },
  held: { bg: '#E8B931', txt: '#1A1405', label: 'ถืออยู่' },
  late: { bg: '#E5484D', txt: '#fff', label: 'เลยกำหนด' },
  off: { bg: '#55616F', txt: '#fff', label: 'ปิดใช้งาน' },
}

export function AssetDeviceBox({
  r,
  candidates = [],
  onClose,
  onDone,
}: {
  r: AssetBoardRow
  /**
   * เครื่องอื่นที่ติ๊กโอนไปพร้อมกันได้
   *
   * ส่งมาทั้งกระดาน ไม่ใช่แค่ที่ตัวกรองโชว์อยู่
   * เพราะคนกรองหาเครื่องหนึ่งอยู่ แล้วนึกออกว่าต้องย้ายอีกคันไปด้วย
   * ตัวกล่องโอนคัดเครื่องที่อยู่กับผู้รับอยู่แล้วออกให้เอง
   */
  candidates?: TransferCandidate[]
  onClose: () => void
  /** บอกกระดานให้โหลดใหม่หลังสั่งงานสำเร็จ */
  onDone: () => void
}) {
  const { profile } = useAuth()
  const hist = useAsync(() => assetHistory(r.code), [r.code])
  /** ประวัติแจ้งเสีย · โหลดตอนเปิดกล่องเท่านั้น ไม่ได้ติดมากับกระดาน */
  const issues = useAsync(() => listAssetIssues(r.code), [r.code])
  const t = TONE[r.state] ?? TONE.free

  const [mode, setMode] = useState<null | 'return' | 'cancel'>(null)
  /**
   * ใบแจ้งเสียที่กำลังจะเคลียร์ · number = ใบเดียว · 'all' = ทุกใบของเครื่องนี้
   * ฐานข้อมูลบังคับให้มีรูปตอนซ่อมเสร็จอย่างน้อยหนึ่งใบ ไม่ได้กันแค่ที่หน้าจอ
   * จึงใช้กล่องถ่ายรูปตัวเดียวกับหน้าทะเบียนเครื่อง ไม่ได้ทำกล่องใหม่
   */
  const [fixing, setFixing] = useState<number | 'all' | null>(null)
  const [moving, setMoving] = useState(false)
  const [shots, setShots] = useState<Shot[]>([])
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const held = r.state === 'held' || r.state === 'late'

  function run(job: () => Promise<string>) {
    setBusy(true)
    setErr(null)
    void job()
      .then((msg) => {
        setOk(msg)
        setMode(null)
        setShots([])
        setReason('')
        hist.reload()
        onDone()
      })
      .catch((e) => setErr(readableError(e)))
      .finally(() => setBusy(false))
  }

  return (
    <Modal open onClose={onClose} title={'เครื่อง ' + r.code}>
      <div className="mb-3 rounded-card p-3" style={{ background: t.bg, color: t.txt }}>
        <p className="font-display text-lg font-bold">{t.label}</p>
        {r.holder_name ? (
          <p className="mt-1 text-sm">
            อยู่กับ <b>{r.holder_name}</b> ({r.holder_code})
            <br />
            เบิกเมื่อ {fmtDateTime(r.out_at)}
            {r.due_at ? <> · ต้องคืน {fmtDateTime(r.due_at)}</> : null}
            {r.late_min ? <> · เลยมา {r.late_min} นาที</> : null}
          </p>
        ) : (
          <p className="mt-1 text-sm">
            {r.type_name} · {deptName(r.dept_code, 'ส่วนกลาง')}
          </p>
        )}
      </div>

      {/* แจ้งเสียที่ยังไม่เคลียร์ · ขึ้นก่อนทุกอย่าง เพราะเปลี่ยนการตัดสินใจว่าจะให้ใครเอาไปใช้ไหม */}
      {r.open_issues > 0 ? (
        <div
          className="mb-3 rounded-card px-3 py-2 text-sm"
          style={{ background: '#7C2D12', color: '#fff' }}
        >
          <p className="font-display text-base font-bold">
            เครื่องนี้แจ้งเสียค้างอยู่ {r.open_issues} รายการ
          </p>
          {r.issue_symptom ? <p className="mt-1">ล่าสุด · {r.issue_symptom}</p> : null}
          <p className="mt-[2px] text-xs opacity-80">
            {r.issue_by ? 'แจ้งโดย ' + r.issue_by : ''}
            {r.issue_at ? ' · ' + fmtDateTime(r.issue_at) : ''}
          </p>
          {r.open_issues > 1 ? (
            <button
              type="button"
              className="btn-soft mt-2 text-sm"
              onClick={() => setFixing('all')}
            >
              เคลียร์ทั้งหมด {r.open_issues} ใบ
            </button>
          ) : null}
        </div>
      ) : null}

      {r.pending_transfer_id ? (
        <p className="mb-3 rounded-card px-3 py-2 text-sm" style={{ background: '#6D28D9', color: '#fff' }}>
          <b>รอรับโอน</b> · โอนให้ {r.pending_to_name ?? 'ปลายทาง'} แล้ว แต่ปลายทางยังไม่กดเบิก
          {r.pending_since ? <> · โอนเมื่อ {fmtDateTime(r.pending_since)}</> : null}
        </p>
      ) : null}

      {ok ? (
        <p className="mb-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">{ok}</p>
      ) : null}
      {err ? (
        <div className="mb-3">
          <ErrorBox message={err} />
        </div>
      ) : null}

      {mode === null && !moving ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-sm" onClick={() => setMoving(true)}>
            โอนเครื่อง
          </button>
          {held ? (
            <button type="button" className="btn-soft text-sm" onClick={() => setMode('return')}>
              คืนแทน
            </button>
          ) : null}
          {r.pending_transfer_id ? (
            <button type="button" className="btn-danger text-sm" onClick={() => setMode('cancel')}>
              ยกเลิกการโอน
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'return' ? (
        <div className="mb-4 rounded-card border border-line p-3">
          <p className="font-display text-base">คืนแทน {r.holder_name}</p>
          <p className="mb-2 text-sm text-ink-500">
            ของจะหลุดจากชื่อเขาทันที · ประวัติจะจดว่าคุณเป็นคนกดคืนแทน
          </p>
          <input
            className="input"
            placeholder="เหตุผลที่คืนแทน เช่น เจ้าตัวกลับบ้านแล้ว"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <div className="mt-3">
            <p className="font-display text-sm">รูปสภาพตอนคืน (ไม่บังคับ)</p>
            <p className="mb-2 text-xs text-ink-400">
              ถ่ายกี่ใบก็ได้ หรือไม่ถ่ายเลยก็ได้ · แนะนำให้ถ่ายถ้าเครื่องมีรอยหรือสภาพผิดปกติ
            </p>
            <PartBoundary label="กล่องถ่ายรูป">
              <PhotoSteps
                steps={[]}
                maxFree={5}
                minFree={0}
                stamp={stampLines(
                  profile?.full_name ?? '',
                  profile?.employee_code ?? '',
                  deptName(profile?.dept_code, 'BPL'),
                  'คืนแทน',
                )}
                shots={shots}
                onShots={setShots}
              />
            </PartBoundary>
          </div>

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-soft text-sm" onClick={() => setMode(null)}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                run(async () => {
                  const res = await assetReturn({
                    codes: [r.code],
                    photos: shotsToPhotos(shots),
                    note: 'คืนแทน · ' + reason.trim(),
                  })
                  return 'คืนแทนแล้ว · ' + res.ref_no
                })
              }
            >
              {busy ? <Spinner /> : null} ยืนยันคืนแทน
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'cancel' && r.pending_transfer_id ? (
        <div className="mb-4 rounded-card border border-line p-3">
          <p className="font-display text-base">ยกเลิกการโอน</p>
          <p className="mb-2 text-sm text-ink-500">
            แถวการโอนไม่ได้ถูกลบ · ยังอยู่ในประวัติพร้อมเหตุผลและชื่อคนกดยกเลิก
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            {TRANSFER_CANCEL_REASONS.map((x) => (
              <button
                key={x}
                type="button"
                className={'chip ' + (reason === x ? 'chip-on' : '')}
                onClick={() => setReason(x)}
              >
                {x}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="หรือพิมพ์เหตุผลเอง"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-soft text-sm" onClick={() => setMode(null)}>
              ไม่ยกเลิกแล้ว
            </button>
            <button
              type="button"
              className="btn-danger text-sm"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                run(async () => {
                  await cancelTransfer(r.pending_transfer_id as number, reason.trim())
                  return 'ยกเลิกการโอนแล้ว'
                })
              }
            >
              {busy ? <Spinner /> : null} ยืนยันยกเลิก
            </button>
          </div>
        </div>
      ) : null}

      {/*
        เคลียร์ใบแจ้งเสีย · ต้องมีรูปตอนซ่อมเสร็จ เป็นกติกาที่ฐานข้อมูลบังคับ
        ไม่ใช่แค่หน้าจอขอ · ใบที่เคลียร์โดยไม่มีหลักฐาน คือใบที่พิสูจน์ทีหลังไม่ได้
      */}
      <IssueFixSheet
        open={fixing !== null}
        title={fixing === 'all' ? 'เคลียร์แจ้งเสียทั้งหมดของ ' + r.code : 'เคลียร์ใบแจ้งเสีย'}
        hint="ถ่ายรูปตอนซ่อมเสร็จ แล้วเขียนว่าแก้อะไรไป"
        onClose={() => setFixing(null)}
        onSubmit={async (photos, note) => {
          if (fixing === 'all') await resolveAssetIssuesFor(r.code, photos, note ?? undefined)
          else if (typeof fixing === 'number') await resolveAssetIssue(fixing, photos, note ?? undefined)
          setFixing(null)
          setOk('เคลียร์ใบแจ้งเสียแล้ว')
          issues.reload()
          onDone()
        }}
      />

      {moving ? (
        <AssetTransfer
          asset={{
            code: r.code,
            type_code: r.type_code,
            dept_code: r.dept_code,
            asset_types: { name: r.type_name },
          }}
          holding={undefined}
          candidates={candidates}
          onClose={() => setMoving(false)}
          onDone={() => {
            setMoving(false)
            setOk('โอนเครื่องแล้ว · รอปลายทางกดเบิก')
            hist.reload()
            onDone()
          }}
        />
      ) : null}

      {/* ประวัติแจ้งเสีย · เคลียร์แล้วก็ยังโชว์ เพราะเครื่องที่เสียซ้ำ ๆ คือเครื่องที่ควรเลิกใช้ */}
      {issues.data && issues.data.length > 0 ? (
        <>
          <p className="label">ประวัติแจ้งเสีย · ซ่อม</p>
          <ul className="mb-4 rounded-card border border-line">
            {issues.data.map((s) => (
              <li key={s.id} className="border-b border-line-2 px-3 py-2 last:border-0">
                <span className="flex items-start gap-2">
                  <span
                    className="mt-[2px] shrink-0 rounded-pill px-2 py-[2px] text-[11px] font-bold"
                    style={
                      s.resolved_at
                        ? { background: '#25A35A', color: '#fff' }
                        : { background: '#7C2D12', color: '#fff' }
                    }
                  >
                    {s.resolved_at ? 'ซ่อมแล้ว' : 'ยังเสีย'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{s.symptom}</span>
                    <span className="block text-xs text-ink-400">
                      แจ้ง {fmtDateTime(s.reported_at)}
                      {s.reported_name ? ' · ' + s.reported_name : ''}
                    </span>
                    {s.resolved_at ? (
                      <span className="block text-xs text-success-txt">
                        เคลียร์ {fmtDateTime(s.resolved_at)}
                        {s.resolve_note ? ' · ' + s.resolve_note : ''}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-soft mt-1 text-xs"
                        onClick={() => setFixing(s.id)}
                      >
                        เคลียร์ใบนี้
                      </button>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="label">ประวัติเบิก-คืน</p>
      {hist.loading ? <Loading /> : null}
      {hist.error ? <ErrorBox message={hist.error} onRetry={hist.reload} /> : null}
      {hist.data && hist.data.length === 0 ? (
        <p className="text-sm text-ink-400">เครื่องนี้ยังไม่เคยถูกเบิก</p>
      ) : null}
      {hist.data && hist.data.length > 0 ? (
        <ul className="rounded-card border border-line">
          {hist.data.map((h, i) => (
            <li
              key={h.ref_no + i}
              className="flex items-start gap-2 border-b border-line-2 px-3 py-2 last:border-0"
            >
              <span
                className="mt-[2px] shrink-0 rounded-pill px-2 py-[2px] text-[11px] font-bold"
                style={
                  h.kind === 'out'
                    ? { background: '#E8B931', color: '#1A1405' }
                    : { background: '#25A35A', color: '#fff' }
                }
              >
                {h.kind === 'out' ? 'เบิก' : 'คืน'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{h.who_name ?? '—'}</span>
                <span className="block text-xs text-ink-400">
                  {fmtDateTime(h.at)} · {h.ref_no}
                </span>
                {h.note ? <span className="block text-xs text-ink-500">{h.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
