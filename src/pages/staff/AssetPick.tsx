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
import type { Asset, AssetIssueInput } from '../../lib/types'

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

  // ของพ่วง (เช่น เลเซอร์ลบ) ไม่ขึ้นเป็นเมนูเอง ไปอยู่ในหน้าเบิกของประเภทแม่
  const rows = (types.data ?? []).filter(
    (t) => !t.parent_code && (assets.data ?? []).some((a) => a.type_code === t.code),
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
                <Link to={`/assets/${t.code}`} className="card flex items-center gap-3 p-4">
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

/* ----------------------------------------------------------------- ขั้นตอน */

type Step = 'pick' | 'photo' | 'review'

const ORDER: Step[] = ['pick', 'photo', 'review']

const STEP_TITLE: Record<Step, string> = {
  pick: 'เลือกเครื่อง',
  photo: 'ถ่ายรูป',
  review: 'ตรวจก่อนยืนยัน',
}

/**
 * เบิกอุปกรณ์แบบสามขั้น
 *
 * เดิมยัดทุกอย่างไว้หน้าเดียว พอมีเครื่องหลายสิบตัวต้องเลื่อนยาวมาก
 * ตอนนี้เลือกเครื่องให้เสร็จก่อน แล้วค่อยถ่ายรูป แล้วค่อยตรวจก่อนกดยืนยัน
 * รายชื่อเครื่องเป็นปุ่มสามคอลัมน์ เห็นได้เยอะในจอเดียว
 */
export default function AssetPick() {
  const { typeCode = '' } = useParams()
  const { profile } = useAuth()
  const nav = useNavigate()

  const types = useAsync(() => listAssetTypes(), [])
  const steps = useAsync(() => listAssetPhotoSteps(typeCode), [typeCode])
  const held = useAsync(() => listAssetHoldings(false), [])
  const issues = useAsync(() => listAssetOpenIssues(), [])
  const depts = useAsync(() => listDepartments(), [])

  const extraTypes = useMemo(
    () => (types.data ?? []).filter((t) => t.parent_code === typeCode && t.is_active),
    [types.data, typeCode],
  )
  const wanted = useMemo(() => [typeCode, ...extraTypes.map((t) => t.code)], [typeCode, extraTypes])
  const assets = useAsync(() => listAssets(wanted), [wanted])

  const [step, setStep] = useState<Step>('pick')
  const [picked, setPicked] = useState<string[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [newIssues, setNewIssues] = useState<Record<string, string>>({})
  const [issueFor, setIssueFor] = useState<string | null>(null)
  const [issueText, setIssueText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnAsset, setWarn] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  // ของพ่วงซ่อนไว้ก่อน ไม่ได้หยิบทุกครั้ง กดเปิดเมื่อจะเอา
  const [extraOpen, setExtraOpen] = useState(false)

  const type = (types.data ?? []).find((t) => t.code === typeCode)
  const holdBy = useMemo(() => new Map((held.data ?? []).map((h) => [h.asset_code, h])), [held.data])
  const issueBy = useMemo(
    () => new Map((issues.data ?? []).map((i) => [i.asset_code, i])),
    [issues.data],
  )
  const deptName = useMemo(
    () => new Map((depts.data ?? []).map((d) => [d.code, d.name])),
    [depts.data],
  )
  const byCode = useMemo(() => new Map((assets.data ?? []).map((a) => [a.code, a])), [assets.data])

  /** จัดกลุ่ม: แผนกตัวเองมาก่อน แล้วส่วนกลาง แล้วแผนกอื่นที่มีสิทธิ์ */
  const groups = useMemo(() => {
    const mine = profile?.dept_code ?? 'ALL'
    const rowsAll = (assets.data ?? []).filter((a) => a.type_code === typeCode)
    const buckets = new Map<string, Asset[]>()
    for (const a of rowsAll) {
      const key =
        a.dept_code === mine ? 'mine' : !a.dept_code || a.dept_code === 'ALL' ? 'central' : 'other'
      const list = buckets.get(key) ?? []
      list.push(a)
      buckets.set(key, list)
    }
    const order = [
      { key: 'mine', label: `แผนกของคุณ · ${deptName.get(mine) ?? mine}` },
      { key: 'central', label: 'ส่วนกลาง' },
      { key: 'other', label: 'แผนกอื่นที่คุณมีสิทธิ์' },
    ]
    return order
      .map((g) => ({ ...g, rows: buckets.get(g.key) ?? [] }))
      .filter((g) => g.rows.length > 0)
  }, [assets.data, typeCode, profile?.dept_code, deptName])

  const photos = shotsToPhotos(shots)
  const needPhotos = steps.data && steps.data.length > 0 ? steps.data.length : (type?.photo_min ?? 1)
  const photosReady = photos.length >= needPhotos && !shots.some((s) => s.state !== 'done')

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
    const hit = (assets.data ?? []).find((a) => a.code.toLowerCase() === code.toLowerCase())
    if (!hit) return { ok: false, message: `ไม่พบ ${code} ในกลุ่มนี้` }
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

      const res = await assetCheckout({ typeCode, codes: picked, photos, issues: issueList })
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

  /** ปุ่มเครื่องหนึ่งดวง — เล็กพอให้เห็นหลายตัวโดยไม่ต้องเลื่อนยาว */
  function Chip({ a }: { a: Asset }) {
    const h = holdBy.get(a.code)
    const iss = issueBy.get(a.code)
    const on = picked.includes(a.code)
    const off = !a.is_enabled
    return (
      <button
        type="button"
        disabled={off}
        onClick={() => toggle(a.code)}
        className={`min-h-tap rounded-card border px-2 py-1 text-left leading-tight ${
          on
            ? 'border-ink bg-ink text-white'
            : off || h
              ? 'border-line bg-surface-2 text-ink-400'
              : 'border-line-2 bg-surface text-ink'
        }`}
      >
        <span className="block truncate font-display text-sm">
          {a.code}
          {h ? ' 🔒' : iss ? ' ⚠' : ''}
        </span>
        {h && <span className="block truncate text-[10px]">{h.holder_name}</span>}
        {off && <span className="block text-[10px]">ปิดซ่อม</span>}
      </button>
    )
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar
        title={`${type?.name ?? 'เบิกอุปกรณ์'} · ${STEP_TITLE[step]}`}
        back={step === 'pick' ? '/assets' : undefined}
        right={
          step !== 'pick' ? (
            <button
              type="button"
              className="min-h-tap px-2 text-sm underline"
              onClick={() => setStep(step === 'review' ? 'photo' : 'pick')}
            >
              ย้อนกลับ
            </button>
          ) : undefined
        }
      />

      {/* แถบบอกว่าอยู่ขั้นไหนใน 3 ขั้น */}
      <div className="mx-auto flex max-w-phone gap-1 px-4 pt-3">
        {ORDER.map((k, i) => (
          <span
            key={k}
            className={`h-1 flex-1 rounded-pill ${
              ORDER.indexOf(step) >= i ? 'bg-brand-500' : 'bg-line-2'
            }`}
          />
        ))}
      </div>

      <StaffPage nav={false} className="pb-[150px]">
        {loading && <Loading />}
        {assets.error && <ErrorBox message={assets.error} onRetry={assets.reload} />}

        {/* -------------------------------------------------- ขั้น 1 เลือกเครื่อง */}
        {step === 'pick' && (
          <>
            {!loading && groups.length === 0 && (
              <EmptyState title="ไม่มีเครื่องให้เบิก" hint="แผนกของคุณยังไม่มีเครื่องประเภทนี้" />
            )}

            {groups.length > 0 && (
              <button
                type="button"
                className="btn-dark mb-3 w-full py-3"
                onClick={() => setScanning(true)}
              >
                สแกน QR ติ๊กเครื่อง
              </button>
            )}

            {groups.map((g) => (
              <section key={g.key} className="mb-3">
                <h2 className="mb-1 text-sm font-medium text-ink-500">{g.label}</h2>
                <div className="grid grid-cols-3 gap-1">
                  {g.rows.map((a) => (
                    <Chip key={a.code} a={a} />
                  ))}
                </div>
              </section>
            ))}

            {extraTypes.map((ex) => {
              const pool = (assets.data ?? []).filter((a) => a.type_code === ex.code)
              if (pool.length === 0) return null
              const chosen = pool.filter((a) => picked.includes(a.code)).length
              return (
                <section
                  key={ex.code}
                  className="mb-3 rounded-card border border-line bg-surface p-3"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left"
                    onClick={() => setExtraOpen((v) => !v)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-display">เบิก{ex.name}ด้วยไหม</span>
                      <span className="block text-sm text-ink-400">
                        {chosen > 0 ? `เลือกไว้ ${chosen} อัน` : 'ไม่เอาก็ข้ามได้ ไม่บังคับ'}
                      </span>
                    </span>
                    <span aria-hidden className="text-ink-400">
                      {extraOpen ? '▲' : '▼'}
                    </span>
                  </button>

                  {extraOpen && (
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      {pool.map((a) => (
                        <Chip key={a.code} a={a} />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}

            {groups.length > 0 && (
              <p className="mt-2 text-center text-xs text-ink-400">
                🔒 มีคนถืออยู่ · ⚠ มีอาการค้าง — กดที่เครื่องเพื่อดูรายละเอียด
              </p>
            )}
          </>
        )}

        {/* ----------------------------------------------------- ขั้น 2 ถ่ายรูป */}
        {step === 'photo' && (
          <>
            <p className="mb-3 rounded-card border border-line bg-surface p-3 text-sm text-ink-500">
              เลือกไว้ <b className="text-ink">{picked.length} เครื่อง</b> · ถ่ายรวมครั้งเดียว
              ไม่ว่าจะเบิกกี่เครื่องก็ถ่ายเท่าเดิม
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
          </>
        )}

        {/* ------------------------------------------------- ขั้น 3 ตรวจก่อนยืนยัน */}
        {step === 'review' && (
          <>
            <section className="rounded-card border border-line bg-surface p-3">
              <h2 className="font-display">กำลังจะเบิก {picked.length} เครื่อง</h2>
              <ul className="mt-2 space-y-1">
                {picked.map((code) => {
                  const a = byCode.get(code)
                  const iss = issueBy.get(code)
                  return (
                    <li key={code} className="rounded-card border border-line p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display">{code}</span>
                        <span className="text-xs text-ink-400">
                          {a?.asset_types?.name ?? a?.type_code}
                        </span>
                      </div>
                      {iss && <p className="text-sm text-warn-txt">⚠ อาการเดิม: {iss.symptoms}</p>}
                      {newIssues[code] && (
                        <p className="text-sm text-danger-txt">แจ้งใหม่: {newIssues[code]}</p>
                      )}
                      <div className="mt-1 flex gap-3">
                        <button
                          type="button"
                          className="min-h-tap text-sm underline"
                          onClick={() => {
                            setIssueFor(code)
                            setIssueText(newIssues[code] ?? '')
                          }}
                        >
                          {newIssues[code] ? 'แก้อาการที่แจ้ง' : 'แจ้งชำรุด'}
                        </button>
                        <button
                          type="button"
                          className="min-h-tap text-sm text-danger-txt underline"
                          onClick={() => setPicked((v) => v.filter((c) => c !== code))}
                        >
                          เอาออก
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>

            <p className="mt-3 text-center text-sm text-success-txt">
              รูปหลักฐาน {photos.length} ใบ ส่งขึ้นเรียบร้อย
            </p>

            {error && (
              <div className="mt-3">
                <ErrorBox message={error} />
              </div>
            )}
          </>
        )}
      </StaffPage>

      {/* ------------------------------------------------- แถบปุ่มติดขอบล่าง */}
      <div className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface p-3 shadow-float">
        <div className="mx-auto max-w-phone">
          {step === 'pick' && (
            <>
              <p className="mb-2 text-center text-sm text-ink-500">
                {picked.length === 0 ? 'ยังไม่ได้เลือกเครื่อง' : `เลือกไว้ ${picked.length} เครื่อง`}
              </p>
              <button
                type="button"
                className="btn-primary w-full py-4 text-md"
                disabled={picked.length === 0}
                onClick={() => setStep('photo')}
              >
                ถัดไป · ถ่ายรูป
              </button>
            </>
          )}

          {step === 'photo' && (
            <button
              type="button"
              className="btn-primary w-full py-4 text-md"
              disabled={!photosReady}
              onClick={() => setStep('review')}
            >
              {photosReady ? 'ถัดไป · ตรวจรายการ' : `ต้องถ่ายให้ครบ ${needPhotos} ใบก่อน`}
            </button>
          )}

          {step === 'review' && (
            <button
              type="button"
              className="btn-primary w-full py-4 text-md"
              disabled={busy || picked.length === 0}
              onClick={() => void submit()}
            >
              {busy ? <Spinner /> : null}
              {busy ? 'กำลังบันทึก…' : `ยืนยันเบิก ${picked.length} เครื่อง`}
            </button>
          )}
        </div>
      </div>

      {scanning && (
        <CodeScanner
          title={`สแกน ${type?.name ?? 'เครื่อง'}`}
          hint={`ติ๊กแล้ว ${picked.length} เครื่อง · สแกนต่อได้เรื่อย ๆ`}
          onCode={onScan}
          onClose={() => setScanning(false)}
        />
      )}

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
