import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import {
  assetCheckout,
  listAssetHoldings,
  listAssetOpenIssues,
  listAssetPhotoSteps,
  listAssetTypes,
  listAssets,
  listDepartments,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { StaffPage, TopBar } from '../../components/Shell'
import { EmptyState, ErrorBox, Loading, Modal, Sheet, Spinner } from '../../components/ui'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { CodeScanner } from '../../components/CodeScanner'
import { stampLines } from '../../lib/image'
import { fmtDateTime } from '../../lib/format'
import type { AssetIssueInput } from '../../lib/types'

/* ------------------------------------------------------------ เลือกประเภท */

export function AssetTypes() {
  const types = useAsync(() => listAssetTypes(), [])
  const assets = useAsync(() => listAssets(), [])
  const held = useAsync(() => listAssetHoldings(false), [])

  const freeBy = useMemo(() => {
    const out = new Map<string, number>()
    const taken = new Set((held.data ?? []).map((h) => h.asset_code))
    for (const a of assets.data ?? []) {
      if (!a.is_enabled || taken.has(a.code)) continue
      out.set(a.type_code, (out.get(a.type_code) ?? 0) + 1)
    }
    return out
  }, [assets.data, held.data])

  const rows = (types.data ?? []).filter((t) =>
    (assets.data ?? []).some((a) => a.type_code === t.code),
  )

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar title="เบิกอุปกรณ์" back="/" />
      <StaffPage>
        {(types.loading || assets.loading) && <Loading />}
        {types.error && <ErrorBox message={types.error} onRetry={types.reload} />}

        {!types.loading && rows.length === 0 && (
          <EmptyState
            title="ไม่มีอุปกรณ์ให้เบิก"
            hint="บัญชีนี้อาจไม่มีสิทธิ์เบิกอุปกรณ์ หรือแผนกของคุณยังไม่มีเครื่องลงทะเบียน"
          />
        )}

        <ul className="space-y-2">
          {rows.map((t) => {
            const free = freeBy.get(t.code) ?? 0
            return (
              <li key={t.code}>
                <Link
                  to={`/assets/${t.code}`}
                  className="card flex items-center gap-3 p-4"
                  aria-disabled={free === 0}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-md">{t.name}</p>
                    <p className={`text-sm ${free > 0 ? 'text-ink-500' : 'text-danger-txt'}`}>
                      {free > 0 ? `ว่าง ${free} เครื่อง` : 'ไม่มีเครื่องว่าง'}
                    </p>
                  </div>
                  <span aria-hidden className="text-ink-400">
                    ›
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </StaffPage>
    </div>
  )
}

/* -------------------------------------------------------- เลือกเครื่องและถ่ายรูป */

export default function AssetPick() {
  const { typeCode = '' } = useParams()
  const { profile } = useAuth()
  const nav = useNavigate()

  const types = useAsync(() => listAssetTypes(), [])
  const steps = useAsync(() => listAssetPhotoSteps(typeCode), [typeCode])
  const assets = useAsync(() => listAssets(typeCode), [typeCode])
  const held = useAsync(() => listAssetHoldings(false), [])
  const issues = useAsync(() => listAssetOpenIssues(), [])
  const depts = useAsync(() => listDepartments(), [])

  const [picked, setPicked] = useState<string[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [newIssues, setNewIssues] = useState<Record<string, string>>({})
  const [issueFor, setIssueFor] = useState<string | null>(null)
  const [issueText, setIssueText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnAsset, setWarn] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const type = (types.data ?? []).find((t) => t.code === typeCode)
  const holdBy = useMemo(
    () => new Map((held.data ?? []).map((h) => [h.asset_code, h])),
    [held.data],
  )
  const issueBy = useMemo(
    () => new Map((issues.data ?? []).map((i) => [i.asset_code, i])),
    [issues.data],
  )
  const deptName = useMemo(
    () => new Map((depts.data ?? []).map((d) => [d.code, d.name])),
    [depts.data],
  )

  /** จัดกลุ่ม: แผนกตัวเองมาก่อน แล้วส่วนกลาง แล้วแผนกอื่นที่มีสิทธิ์ */
  const groups = useMemo(() => {
    const mine = profile?.dept_code ?? 'ALL'
    const buckets = new Map<string, typeof rowsAll>()
    const rowsAll = assets.data ?? []
    for (const a of rowsAll) {
      const key =
        a.dept_code === mine ? 'mine' : !a.dept_code || a.dept_code === 'ALL' ? 'central' : 'other'
      const list = buckets.get(key) ?? []
      list.push(a)
      buckets.set(key, list)
    }
    const order: { key: string; label: string }[] = [
      { key: 'mine', label: `แผนกของคุณ · ${deptName.get(mine) ?? mine}` },
      { key: 'central', label: 'ส่วนกลาง — ทุกกะใช้ได้' },
      { key: 'other', label: 'แผนกอื่นที่คุณมีสิทธิ์' },
    ]
    return order
      .map((g) => ({ ...g, rows: buckets.get(g.key) ?? [] }))
      .filter((g) => g.rows.length > 0)
  }, [assets.data, profile?.dept_code, deptName])

  const photos = shotsToPhotos(shots)
  const needPhotos = steps.data && steps.data.length > 0 ? steps.data.length : (type?.photo_min ?? 1)
  const photosReady = photos.length >= needPhotos && !shots.some((s) => s.state !== 'done')
  const canSend = picked.length > 0 && photosReady && !busy

  function toggle(code: string) {
    const h = holdBy.get(code)
    if (h) {
      setWarn(`${code} ยังไม่ได้คืน อยู่กับ ${h.holder_name} ตั้งแต่ ${fmtDateTime(h.taken_at)}`)
      return
    }
    setPicked((v) => (v.includes(code) ? v.filter((c) => c !== code) : [...v, code]))
  }

  /** สแกนแล้วติ๊กให้เลย แต่ยังไม่ส่ง — ต้องเห็นกับตาก่อนว่าติ๊กถูกตัว */
  function onScan(raw: string): { ok: boolean; message: string } {
    const code = raw.trim()
    const hit = (assets.data ?? []).find(
      (a) => a.code.toLowerCase() === code.toLowerCase(),
    )
    if (!hit) return { ok: false, message: `ไม่พบ ${code} ในประเภทนี้` }
    if (!hit.is_enabled) return { ok: false, message: `${hit.code} ถูกปิดไม่ให้เบิก` }

    const h = holdBy.get(hit.code)
    if (h) return { ok: false, message: `${hit.code} อยู่กับ ${h.holder_name} ยังไม่ได้คืน` }

    if (picked.includes(hit.code)) return { ok: true, message: `${hit.code} ติ๊กไว้แล้ว` }
    setPicked((v) => [...v, hit.code])
    return { ok: true, message: `เพิ่ม ${hit.code} แล้ว · รวม ${picked.length + 1} เครื่อง` }
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const issueList: AssetIssueInput[] = Object.entries(newIssues)
        .filter(([code, text]) => picked.includes(code) && text.trim())
        .map(([code, text]) => ({ asset_code: code, symptom: text.trim() }))

      const res = await assetCheckout({
        typeCode,
        codes: picked,
        photos,
        issues: issueList,
      })
      nav(`/assets/done/${res.ref_no}`, {
        state: {
          kind: 'out',
          refNo: res.ref_no,
          dueAt: res.due_at,
          codes: picked,
          typeName: type?.name ?? typeCode,
          issues: issueList,
          photoCount: photos.length,
        },
      })
    } catch (e) {
      setError(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const loading = assets.loading || held.loading || steps.loading

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar title={type?.name ?? 'เบิกอุปกรณ์'} back="/assets" />
      <StaffPage>
        {loading && <Loading />}
        {assets.error && <ErrorBox message={assets.error} onRetry={assets.reload} />}

        {!loading && groups.length === 0 && (
          <EmptyState title="ไม่มีเครื่องให้เบิก" hint="แผนกของคุณยังไม่มีเครื่องประเภทนี้" />
        )}

        {groups.length > 0 && (
          <button
            type="button"
            className="btn-dark mb-3 w-full py-4"
            onClick={() => setScanning(true)}
          >
            สแกน QR ติ๊กเครื่อง
          </button>
        )}

        {groups.map((g) => (
          <section key={g.key} className="mb-4">
            <h2 className="mb-2 text-sm font-medium text-ink-500">{g.label}</h2>
            <ul className="space-y-1">
              {g.rows.map((a) => {
                const h = holdBy.get(a.code)
                const iss = issueBy.get(a.code)
                const off = !a.is_enabled
                const on = picked.includes(a.code)
                const blocked = off || Boolean(h)
                return (
                  <li key={a.code}>
                    <button
                      type="button"
                      disabled={off}
                      onClick={() => toggle(a.code)}
                      className={`flex w-full items-start gap-3 rounded-card border p-3 text-left ${
                        on
                          ? 'border-ink bg-brand-50'
                          : blocked
                            ? 'border-line bg-surface-2 opacity-70'
                            : 'border-line bg-surface'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`mt-[2px] flex h-6 w-6 shrink-0 items-center justify-center rounded-btn border text-sm ${
                          on ? 'border-ink bg-ink text-white' : 'border-line-2 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-display">{a.code}</span>
                        {off && <span className="ml-2 badge-dang">ปิดซ่อม</span>}
                        {h && (
                          <span className="block text-sm text-warn-txt">
                            🔒 {h.holder_name} {h.holder_code} · ตั้งแต่ {fmtDateTime(h.taken_at)}
                          </span>
                        )}
                        {iss && (
                          <span className="block text-sm text-warn-txt">⚠ {iss.symptoms}</span>
                        )}
                        {newIssues[a.code] && (
                          <span className="block text-sm text-danger-txt">
                            แจ้งใหม่: {newIssues[a.code]}
                          </span>
                        )}
                      </span>
                    </button>

                    {on && (
                      <button
                        type="button"
                        className="mt-1 min-h-tap w-full rounded-card border border-line-2 bg-surface px-3 text-sm text-ink-700"
                        onClick={() => {
                          setIssueFor(a.code)
                          setIssueText(newIssues[a.code] ?? '')
                        }}
                      >
                        {newIssues[a.code] ? `แก้อาการที่แจ้ง · ${a.code}` : `แจ้งชำรุด · ${a.code}`}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {picked.length > 0 && (
          <section className="mt-4 rounded-card border border-line bg-surface p-3">
            <h2 className="mb-2 font-display">
              รูปหลักฐาน · เลือกไว้ {picked.length} เครื่อง
            </h2>
            <p className="mb-2 text-sm text-ink-500">
              ถ่ายรวมครั้งเดียว ไม่ว่าจะเบิกกี่เครื่องก็ถ่ายเท่าเดิม
            </p>
            <PhotoSteps
              steps={steps.data ?? []}
              maxFree={type?.photo_max ?? 5}
              stamp={stampLines(
                profile?.full_name ?? '',
                profile?.employee_code ?? '',
                profile?.dept_code ?? 'BPL',
                `เบิก ${type?.name ?? ''}`,
              )}
              shots={shots}
              onShots={setShots}
            />
          </section>
        )}

        {error && <div className="mt-3"><ErrorBox message={error} /></div>}
      </StaffPage>

      {/* แถบยืนยันติดขอบล่าง กดถึงได้ตลอดไม่ต้องเลื่อนหา */}
      {picked.length > 0 && (
        <div className="safe-b sticky bottom-0 border-t border-line bg-surface p-3 shadow-float">
          <div className="mx-auto max-w-phone">
            <p className="mb-2 text-center text-sm text-ink-500">
              {picked.length} เครื่อง ·{' '}
              {photosReady ? (
                <span className="text-success-txt">รูปครบแล้ว</span>
              ) : (
                <span className="text-warn-txt">ต้องถ่ายรูปให้ครบ {needPhotos} ใบก่อน</span>
              )}
            </p>
            <button
              type="button"
              className="btn-primary w-full py-4 text-md"
              disabled={!canSend}
              onClick={() => void submit()}
            >
              {busy ? <Spinner /> : null}
              {busy ? 'กำลังบันทึก…' : `ยืนยันเบิก ${picked.length} เครื่อง`}
            </button>
          </div>
        </div>
      )}

      {/* แจ้งชำรุดรายเครื่อง */}
      <Sheet
        open={Boolean(issueFor)}
        title={`แจ้งชำรุด · ${issueFor ?? ''}`}
        onClose={() => setIssueFor(null)}
      >
        {issueFor && (
          <>
            {issueBy.get(issueFor) && (
              <p className="mb-2 rounded-card bg-warn-bg px-3 py-2 text-sm text-warn-txt">
                อาการที่แจ้งไว้แล้ว: {issueBy.get(issueFor)?.symptoms}
                <br />
                ถ้าเป็นอาการเดิม <b>ไม่ต้องแจ้งซ้ำ</b> แจ้งเฉพาะที่เจอใหม่
              </p>
            )}

            {(type?.issue_tags ?? []).length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {(type?.issue_tags ?? []).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="chip"
                    onClick={() => setIssueText((v) => (v ? `${v} · ${tag}` : tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            <textarea
              className="input h-[90px] w-full"
              placeholder="อาการที่เจอ"
              value={issueText}
              onChange={(e) => setIssueText(e.target.value)}
            />

            <div className="mt-3 flex gap-2">
              {newIssues[issueFor] && (
                <button
                  type="button"
                  className="btn-ghost flex-1"
                  onClick={() => {
                    setNewIssues((m) => {
                      const next = { ...m }
                      delete next[issueFor]
                      return next
                    })
                    setIssueFor(null)
                  }}
                >
                  ลบที่แจ้งไว้
                </button>
              )}
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!issueText.trim()}
                onClick={() => {
                  setNewIssues((m) => ({ ...m, [issueFor]: issueText.trim() }))
                  setIssueFor(null)
                }}
              >
                บันทึกอาการ
              </button>
            </div>
          </>
        )}
      </Sheet>

      {scanning && (
        <CodeScanner
          title={`สแกน ${type?.name ?? 'เครื่อง'}`}
          hint={`ติ๊กแล้ว ${picked.length} เครื่อง · สแกนต่อได้เรื่อย ๆ`}
          onCode={onScan}
          onClose={() => setScanning(false)}
        />
      )}

      <Modal open={Boolean(warnAsset)} onClose={() => setWarn(null)} title="เครื่องนี้ยังไม่ได้คืน">
        <p className="text-ink-700">{warnAsset}</p>
        <p className="mt-2 text-sm text-ink-500">ตามจากเจ้าตัวก่อน หรือเลือกเครื่องอื่นแทน</p>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-primary" onClick={() => setWarn(null)}>
            เข้าใจแล้ว
          </button>
        </div>
      </Modal>
    </div>
  )
}
