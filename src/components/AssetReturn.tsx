import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/useAsync'
import {
  assetReturn,
  listAssetHoldings,
  listAssetOpenIssues,
  listAssetPhotoSteps,
  listAssetTypes,
} from '../lib/api'
import { readableError } from '../lib/supabase'
import { ErrorBox, Loading, Sheet, Spinner } from './ui'
import { PhotoSteps, shotsToPhotos, type Shot } from './PhotoSteps'
import { stampLines } from '../lib/image'
import { fmtDateTime, relativeAge } from '../lib/format'
import type { AssetIssueInput } from '../lib/types'

/**
 * คืนอุปกรณ์ที่ถืออยู่
 *
 * คืนบางเครื่องได้ ที่เหลือยังค้างชื่อเดิม เวลานับต่อจากตอนเบิกครั้งแรก ไม่รีเซ็ต
 * เลือกได้ทีละประเภท เพราะจำนวนรูปที่บังคับของแต่ละประเภทไม่เท่ากัน
 * (Power Pallet ห้าใบตามขั้นตอน ที่เหลือหนึ่งใบขึ้นไป)
 */

export function AssetReturn({ onCount }: { onCount?: (n: number) => void }) {
  const { profile } = useAuth()
  const nav = useNavigate()

  const held = useAsync(() => listAssetHoldings(true, profile?.id), [profile?.id])
  const types = useAsync(() => listAssetTypes(), [])
  const issues = useAsync(() => listAssetOpenIssues(), [])

  const [typeCode, setTypeCode] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [newIssues, setNewIssues] = useState<Record<string, string>>({})
  const [issueFor, setIssueFor] = useState<string | null>(null)
  const [issueText, setIssueText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const steps = useAsync(
    () => (typeCode ? listAssetPhotoSteps(typeCode) : Promise.resolve([])),
    [typeCode],
  )

  const rows = held.data ?? []


  // บอกหน้าแม่ว่าถืออุปกรณ์อยู่กี่เครื่อง จะได้ไม่ขึ้น "ไม่มีของค้างคืน" ทั้งที่ยังมี
  const reported = useRef<number>(-1)
  useEffect(() => {
    if (held.loading || reported.current === rows.length) return
    reported.current = rows.length
    onCount?.(rows.length)
  }, [rows.length, held.loading, onCount])
  // ของพ่วงคืนพร้อมประเภทแม่ในรอบเดียว จึงจับกลุ่มด้วย "ประเภทหลัก"
  const rootOf = useMemo(() => {
    const m = new Map((types.data ?? []).map((t) => [t.code, t.parent_code ?? t.code]))
    return (code: string) => m.get(code) ?? code
  }, [types.data])
  const nameOf = useMemo(() => {
    const m = new Map((types.data ?? []).map((t) => [t.code, t.name]))
    return (code: string) => m.get(code) ?? code
  }, [types.data])

  const type = (types.data ?? []).find((t) => t.code === typeCode)
  const issueBy = useMemo(
    () => new Map((issues.data ?? []).map((i) => [i.asset_code, i])),
    [issues.data],
  )

  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const h of rows) {
      const root = rootOf(h.type_code)
      const list = map.get(root) ?? []
      list.push(h)
      map.set(root, list)
    }
    return [...map.entries()].map(([code, list]) => ({
      code,
      name: nameOf(code),
      list,
    }))
  }, [rows, rootOf, nameOf])

  const photos = shotsToPhotos(shots)
  const needPhotos =
    steps.data && steps.data.length > 0 ? steps.data.length : (type?.photo_min ?? 1)
  const photosReady = photos.length >= needPhotos && !shots.some((s) => s.state !== 'done')

  function toggle(code: string, tCode: string) {
    // สลับประเภทแล้วต้องเริ่มใหม่ เพราะจำนวนรูปที่บังคับไม่เท่ากัน
    if (typeCode && tCode !== typeCode) {
      setPicked([code])
      setTypeCode(tCode)
      setShots([])
      return
    }
    setTypeCode(tCode)
    setPicked((v) => {
      const next = v.includes(code) ? v.filter((c) => c !== code) : [...v, code]
      if (next.length === 0) setTypeCode(null)
      return next
    })
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const issueList: AssetIssueInput[] = Object.entries(newIssues)
        .filter(([code, text]) => picked.includes(code) && text.trim())
        .map(([code, text]) => ({ asset_code: code, symptom: text.trim() }))

      const res = await assetReturn({ codes: picked, photos, issues: issueList })
      nav(`/assets/done/${res.ref_no}`, {
        state: {
          kind: 'in',
          refNo: res.ref_no,
          codes: picked,
          typeName: type?.name ?? '',
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

  if (held.loading) return <Loading />
  if (held.error) return <ErrorBox message={held.error} onRetry={held.reload} />
  if (rows.length === 0) return null

  return (
    <section className="mb-5">
      <h2 className="mb-2 font-display text-md">
        อุปกรณ์ที่ถืออยู่ {rows.length} เครื่อง
      </h2>

      {groups.map((g) => (
        <div key={g.code} className="mb-3">
          <p className="mb-1 text-sm text-ink-500">{g.name}</p>
          <ul className="space-y-1">
            {g.list.map((h) => {
              const on = picked.includes(h.asset_code)
              const dim = Boolean(typeCode) && typeCode !== g.code
              const late = h.due_at ? Date.now() > Date.parse(h.due_at) : false
              const iss = issueBy.get(h.asset_code)
              return (
                <li key={h.asset_code}>
                  <button
                    type="button"
                    onClick={() => toggle(h.asset_code, g.code)}
                    className={`flex w-full items-start gap-3 rounded-card border p-3 text-left ${
                      on ? 'border-ink bg-brand-50' : dim ? 'border-line bg-surface-2 opacity-60' : 'border-line bg-surface'
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
                      <span className="font-display">{h.asset_code}</span>
                      {rootOf(h.type_code) !== h.type_code && (
                        <span className="ml-1 text-xs text-ink-400">{h.type_name}</span>
                      )}
                      <span className="block text-sm text-ink-500">
                        เบิก {fmtDateTime(h.taken_at)} · ถือมาแล้ว {relativeAge(h.taken_at)}
                      </span>
                      {late && (
                        <span className="block text-sm text-danger-txt">
                          เลยเวลาคืนของกะแล้ว{' '}
                          {h.due_at ? relativeAge(h.due_at) : ''}
                        </span>
                      )}
                      {iss && <span className="block text-sm text-warn-txt">⚠ {iss.symptoms}</span>}
                      {newIssues[h.asset_code] && (
                        <span className="block text-sm text-danger-txt">
                          แจ้งใหม่: {newIssues[h.asset_code]}
                        </span>
                      )}
                    </span>
                  </button>

                  {on && (
                    <button
                      type="button"
                      className="mt-1 min-h-tap w-full rounded-card border border-line-2 bg-surface px-3 text-sm text-ink-700"
                      onClick={() => {
                        setIssueFor(h.asset_code)
                        setIssueText(newIssues[h.asset_code] ?? '')
                      }}
                    >
                      {newIssues[h.asset_code]
                        ? `แก้อาการที่แจ้ง · ${h.asset_code}`
                        : `แจ้งชำรุด · ${h.asset_code}`}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {picked.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-3">
          <h3 className="mb-1 font-display">รูปสภาพตอนคืน</h3>
          <p className="mb-2 text-sm text-ink-500">
            คืน {picked.length} เครื่อง · ถ่ายรวมครั้งเดียว บังคับ {needPhotos} ใบ
          </p>
          {steps.loading ? (
            <Loading />
          ) : (
            <PhotoSteps
              steps={steps.data ?? []}
              maxFree={type?.photo_max ?? 5}
              stamp={stampLines(
                profile?.full_name ?? '',
                profile?.employee_code ?? '',
                profile?.dept_code ?? 'BPL',
                `คืน ${type?.name ?? ''}`,
              )}
              shots={shots}
              onShots={setShots}
            />
          )}

          {error && <div className="mt-2"><ErrorBox message={error} /></div>}

          <button
            type="button"
            className="btn-primary mt-3 w-full py-4 text-md"
            disabled={!photosReady || busy}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : null}
            {busy
              ? 'กำลังบันทึก…'
              : photosReady
                ? `ยืนยันคืน ${picked.length} เครื่อง`
                : 'ถ่ายรูปก่อนจึงยืนยันได้'}
          </button>

          {picked.length < rows.filter((h) => h.type_code === typeCode).length && (
            <p className="mt-2 text-center text-sm text-ink-500">
              เครื่องที่ไม่ได้ติ๊กจะยังค้างชื่อคุณอยู่ นับเวลาต่อจากตอนเบิกเดิม
            </p>
          )}
        </div>
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
                ถ้าเป็นอาการเดิม <b>ไม่ต้องแจ้งซ้ำ</b> แจ้งเฉพาะที่พังเพิ่ม
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
    </section>
  )
}
