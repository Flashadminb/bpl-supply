import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/useAsync'
import {
  assetReturnGroups,
  listAssetHoldings,
  listAssetOpenIssues,
  listAssetPhotoSteps,
  listAssetTypes,
} from '../lib/api'
import { readableError } from '../lib/supabase'
import { ErrorBox, Loading, Spinner } from './ui'
import { PhotoSteps, shotsToPhotos, type Shot } from './PhotoSteps'
import {
  IssuePhotosBlock,
  flushIssuePhotos,
  issuePhotosReady,
  type IssueShots,
} from './IssuePhotosBlock'
import { PartBoundary } from './ErrorBoundary'
import { stampLines } from '../lib/image'
import { fmtDateTime, relativeAge } from '../lib/format'
import { LOST, isLost, symptomsFor } from '../lib/symptoms'
import type { AssetIssueInput, AssetPhotoStep } from '../lib/types'

/**
 * คืนอุปกรณ์ — ตะกร้าแบบเดียวกับหน้าเบิก
 *
 * เลือกข้ามประเภทได้ในรอบเดียว มีเลือกทั้งหมดต่อประเภท
 * แต่ขั้นถ่ายรูปแยกเป็นช่วงตามประเภท เพราะจำนวนรูปบังคับไม่เท่ากัน
 * ถ้าถ่ายกองรวมแล้วยัดใส่ทุกใบ รูปรถแดงจะไปติดใบวิทยุด้วย ซึ่งใช้เป็นหลักฐานไม่ได้
 *
 * คืนบางเครื่องได้ ที่เหลือยังค้างชื่อเดิม เวลานับต่อจากตอนเบิกครั้งแรก ไม่รีเซ็ต
 *
 * "แจ้งเสีย" ตอนคืนคนละความหมายกับ "เสียมาก่อนเบิก"
 * อันนี้คือเสียระหว่างที่เราใช้งาน เป็นเรื่องที่ต้องตามต่อ จึงใช้ชุดอาการคนละชุด
 */

export function AssetReturn({ onCount }: { onCount?: (n: number) => void }) {
  const { profile } = useAuth()
  const nav = useNavigate()

  const held = useAsync(() => listAssetHoldings(true, profile?.id), [profile?.id])
  const types = useAsync(() => listAssetTypes(), [])
  const issues = useAsync(() => listAssetOpenIssues(), [])

  const [picked, setPicked] = useState<string[]>([])
  const [shotsBy, setShotsBy] = useState<Record<string, Shot[]>>({})
  const [stepsBy, setStepsBy] = useState<Record<string, AssetPhotoStep[]>>({})
  const [newIssues, setNewIssues] = useState<Record<string, string>>({})
  // รูปอาการของเครื่องที่แจ้งเสีย · คนละชุดกับรูปตอนคืน
  const [issueShots, setIssueShots] = useState<IssueShots>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = held.data ?? []

  // บอกหน้าแม่ว่าถืออุปกรณ์อยู่กี่เครื่อง จะได้ไม่ขึ้น "ไม่มีของค้างคืน" ทั้งที่ยังมี
  const reported = useRef<number>(-1)
  useEffect(() => {
    if (held.loading || reported.current === rows.length) return
    reported.current = rows.length
    onCount?.(rows.length)
  }, [rows.length, held.loading, onCount])

  const issueBy = useMemo(
    () => new Map((issues.data ?? []).map((i) => [i.asset_code, i])),
    [issues.data],
  )

  // ของพ่วงคืนพร้อมประเภทแม่ในรอบเดียว จึงจับกลุ่มด้วย "ประเภทหลัก"
  const rootOf = useMemo(() => {
    const m = new Map((types.data ?? []).map((t) => [t.code, t.parent_code ?? t.code]))
    return (code: string) => m.get(code) ?? code
  }, [types.data])
  const nameOf = useMemo(() => {
    const m = new Map((types.data ?? []).map((t) => [t.code, t.name]))
    return (code: string) => m.get(code) ?? code
  }, [types.data])

  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>()
    for (const h of rows) {
      const root = rootOf(h.type_code)
      const list = map.get(root) ?? []
      list.push(h)
      map.set(root, list)
    }
    return [...map.entries()].map(([code, list]) => ({ code, name: nameOf(code), list }))
  }, [rows, rootOf, nameOf])

  /** ประเภทที่มีเครื่องถูกติ๊กอยู่ — ใช้กำหนดว่าต้องถ่ายรูปกี่ช่วง */
  const chosenTypes = useMemo(
    () => groups.filter((g) => g.list.some((h) => picked.includes(h.asset_code))).map((g) => g.code),
    [groups, picked],
  )

  useEffect(() => {
    let alive = true
    for (const code of chosenTypes) {
      if (stepsBy[code]) continue
      void listAssetPhotoSteps(code).then((r) => {
        if (alive) setStepsBy((v) => ({ ...v, [code]: r }))
      })
    }
    return () => {
      alive = false
    }
  }, [chosenTypes, stepsBy])

  function needOf(typeCode: string) {
    const st = stepsBy[typeCode]
    if (st && st.length > 0) return st.length
    return (types.data ?? []).find((t) => t.code === typeCode)?.photo_min ?? 1
  }

  function toggle(code: string) {
    setPicked((v) => (v.includes(code) ? v.filter((c) => c !== code) : [...v, code]))
  }

  function toggleAll(codes: string[]) {
    const allOn = codes.every((c) => picked.includes(c))
    setPicked((v) => (allOn ? v.filter((c) => !codes.includes(c)) : [...new Set([...v, ...codes])]))
  }

  const faulted = Object.keys(newIssues).filter(
    (c) => (newIssues[c] ?? '').trim() !== '' && picked.includes(c),
  )
  const faultPhotosOk = issuePhotosReady(faulted, issueShots)

  const photoReady = chosenTypes.every((code) => {
    const shots = shotsBy[code] ?? []
    return (
      shotsToPhotos(shots).length >= needOf(code) && !shots.some((s) => s.state !== 'done')
    )
  })
  const missing = chosenTypes.reduce(
    (n, code) => n + Math.max(needOf(code) - shotsToPhotos(shotsBy[code] ?? []).length, 0),
    0,
  )

  /**
   * สรุปจำนวนต่อประเภทสำหรับปุ่มยืนยัน — "ไอดาต้า 2 · Power Pallet 1"
   *
   * เดิมปุ่มบอกแค่จำนวนรวม หน้างานที่คืนหลายประเภทพร้อมกันจึงไม่รู้ว่า
   * ที่กำลังจะส่งคือของอะไรบ้าง แล้วมารู้ตัวตอนเครื่องหายไปจากมือแล้ว
   * เขียนแยกประเภทไว้ให้เห็นก่อนกด จะได้ทักท้วงได้ทัน
   */
  const pickedSummary = chosenTypes
    .map((code) => {
      const n = (groups.find((g) => g.code === code)?.list ?? []).filter((h) =>
        picked.includes(h.asset_code),
      ).length
      return `${nameOf(code)} ${n}`
    })
    .join(' · ')

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const payload = chosenTypes.map((code) => {
        const g = groups.find((x) => x.code === code)
        const codes = (g?.list ?? [])
          .map((h) => h.asset_code)
          .filter((c) => picked.includes(c))
        return {
          type_code: code,
          codes,
          photos: shotsToPhotos(shotsBy[code] ?? []),
          issues: codes
            .filter((c) => (newIssues[c] ?? '').trim())
            .map<AssetIssueInput>((c) => ({ asset_code: c, symptom: newIssues[c].trim() })),
        }
      })
      const res = await assetReturnGroups({ groups: payload })
      // ใบคืนผ่านแล้ว ย้อนกลับไม่ได้ · แนบรูปอาการต่อท้าย ไม่ล้มทั้งก้อนถ้าใบใดใบหนึ่งพลาด
      await flushIssuePhotos(faulted, issueShots)
      nav(`/assets/done/${res.refs[0]}`, {
        state: {
          kind: 'in',
          refNo: res.ref_no,
          codes: picked,
          typeName: chosenTypes.map(nameOf).join(' · '),
          photoCount: chosenTypes.reduce(
            (n, c) => n + shotsToPhotos(shotsBy[c] ?? []).length,
            0,
          ),
        },
      })
    } catch (e) {
      setError(readableError(e))
      setBusy(false)
    }
  }

  if (held.loading) return <Loading />
  if (rows.length === 0) return null

  return (
    <section className="mb-4">
      <h2 className="mb-2 font-display text-md">อุปกรณ์ที่คุณถืออยู่</h2>

      {groups.map((g) => {
        const codes = g.list.map((h) => h.asset_code)
        const allOn = codes.every((c) => picked.includes(c))
        return (
          <div key={g.code} className="mb-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-sm text-ink-500">
                {g.name}
                <span className="text-ink-400"> · {g.list.length} เครื่อง</span>
              </p>
              {g.list.length > 1 && (
                <button
                  type="button"
                  className="h-tap rounded-btn px-2 text-sm underline decoration-line-2"
                  onClick={() => toggleAll(codes)}
                >
                  {allOn ? 'เอาออกทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
              )}
            </div>

            <ul className="overflow-hidden rounded-card border border-line bg-surface px-3">
              {g.list.map((h) => {
                const on = picked.includes(h.asset_code)
                const late = h.due_at ? Date.now() > Date.parse(h.due_at) : false
                const old = issueBy.get(h.asset_code)
                const note = newIssues[h.asset_code]
                return (
                  <li key={h.asset_code} className="border-b border-line last:border-0">
                    <div className="flex items-center gap-3 py-2">
                      <button
                        type="button"
                        aria-label={`เลือก ${h.asset_code}`}
                        onClick={() => toggle(h.asset_code)}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-btn border text-sm ${
                          on ? 'border-ink bg-ink text-white' : 'border-line-2 text-transparent'
                        }`}
                      >
                        ✓
                      </button>

                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-base">{h.asset_code}</span>
                        {/* ปัญหาเดิมอ่านอย่างเดียว บรรทัดเดียวพอ */}
                        {old && (
                          <span className="block truncate text-xs text-warn-txt">
                            ⚠ เสียมาก่อนเบิก · {old.symptoms}
                          </span>
                        )}
                      </span>

                      <span className="shrink-0 text-right">
                        <span
                          className={`block text-xs ${late ? 'text-danger-txt' : 'text-ink-500'}`}
                        >
                          {late ? 'เลยกะแล้ว' : `ถือ ${relativeAge(h.taken_at)}`}
                        </span>
                        {/* ปุ่มแจ้งเสีย — เดิมเป็นตัวหนังสือขีดเส้นใต้เล็ก ๆ หน้างานใส่ถุงมือกดไม่โดน
                            ตอนนี้เป็นปุ่มสีแดงเต็มตัว สูงพอให้นิ้วโป้งกดได้ */}
                        {on && note === undefined && (
                          <button
                            type="button"
                            className="mt-1 h-tap rounded-btn bg-danger-bg px-3 text-sm font-semibold text-danger-txt"
                            onClick={() => setNewIssues((v) => ({ ...v, [h.asset_code]: '' }))}
                          >
                            ⚠ แจ้งเครื่องเสีย
                          </button>
                        )}
                      </span>
                    </div>

                    {on && note !== undefined && (
                      <div className="mb-2 rounded-card bg-danger-bg p-3">
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-danger-txt">
                            แจ้งเครื่องเสีย · {h.asset_code}
                            <span className="block text-xs font-normal">
                              เสียระหว่างที่เราใช้งาน
                            </span>
                          </p>
                          <button
                            type="button"
                            className="shrink-0 text-sm underline"
                            onClick={() =>
                              setNewIssues((v) => {
                                const n = { ...v }
                                delete n[h.asset_code]
                                return n
                              })
                            }
                          >
                            ไม่แจ้ง
                          </button>
                        </div>
                        <div className="mb-2 flex flex-wrap gap-2">
                          {symptomsFor(h.type_code, 'in').map((sym) => (
                            <button
                              key={sym}
                              type="button"
                              className={`chip ${note === sym ? 'chip-on' : ''}`}
                              onClick={() =>
                                setNewIssues((v) => ({ ...v, [h.asset_code]: sym }))
                              }
                            >
                              {sym}
                            </button>
                          ))}
                        </div>
                        <input
                          className="input"
                          placeholder="หรือพิมพ์เอง"
                          value={note}
                          onChange={(e) =>
                            setNewIssues((v) => ({ ...v, [h.asset_code]: e.target.value }))
                          }
                        />
                        {isLost(note) && (
                          <p className="mt-1 rounded-btn bg-danger-bg px-2 py-1 text-xs text-danger-txt">
                            แจ้ง{LOST} · แอดมินจะได้รับแจ้งเตือนทันทีที่กดส่ง
                          </p>
                        )}
                      </div>
                    )}

                    {on && (
                      <p className="pb-2 pl-9 text-xs text-ink-400">
                        เบิก {fmtDateTime(h.taken_at)}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      {/* ------------------------------------------ ถ่ายรูป แยกตามประเภท */}
      {chosenTypes.length > 0 && (
        <>
          <p className="mb-2 rounded-card bg-brand-50 px-3 py-2 text-sm text-ink-700">
            ถ่ายแยกตามประเภท · แต่ละประเภทบังคับจำนวนไม่เท่ากัน
          </p>

          {chosenTypes.map((code) => {
            const t = (types.data ?? []).find((x) => x.code === code)
            const st = stepsBy[code]
            const shots = shotsBy[code] ?? []
            const done = shotsToPhotos(shots).length
            const need = needOf(code)
            const codes = (groups.find((g) => g.code === code)?.list ?? [])
              .map((h) => h.asset_code)
              .filter((c) => picked.includes(c))
            return (
              <section key={code} className="mb-3 rounded-card border border-line p-3">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-md">{nameOf(code)}</p>
                  <span
                    className={`text-sm ${done >= need ? 'text-success-txt' : 'text-warn-txt'}`}
                  >
                    {done} จาก {need} ใบ
                  </span>
                </div>
                <p className="mb-2 font-mono text-xs text-ink-400">{codes.join(' · ')}</p>

                {st === undefined ? (
                  <Loading />
                ) : (
                  <PartBoundary label="กล่องถ่ายรูป">
                    <PhotoSteps
                      steps={st}
                      maxFree={t?.photo_max ?? 5}
                      minFree={need}
                      stamp={stampLines(
                        profile?.full_name ?? '',
                        profile?.employee_code ?? '',
                        profile?.dept_code ?? 'BPL',
                        `คืน ${nameOf(code)}`,
                      )}
                      shots={shots}
                      onShots={(next) =>
                        setShotsBy((v) => ({
                          ...v,
                          [code]: typeof next === 'function' ? next(v[code] ?? []) : next,
                        }))
                      }
                    />
                  </PartBoundary>
                )}
              </section>
            )
          })}

          <IssuePhotosBlock
            codes={faulted}
            value={issueShots}
            onChange={setIssueShots}
            nameOf={(c) => newIssues[c] ?? ''}
          />

          {error && (
            <div className="mb-2">
              <ErrorBox message={error} />
            </div>
          )}

          <button
            type="button"
            className="btn-primary w-full py-4 text-md"
            disabled={!photoReady || !faultPhotosOk || busy}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : null}
            {busy
              ? 'กำลังบันทึก…'
              : !photoReady
                ? `ยังถ่ายไม่ครบ — เหลือ ${missing} ใบ`
                : !faultPhotosOk
                  ? `ถ่ายรูปอาการของเครื่องที่แจ้งเสียก่อน`
                  : `ยืนยันคืน ${pickedSummary}`}
          </button>

          {photoReady && !busy && (
            <p className="mt-2 text-center text-sm text-ink-500">
              รวม <b className="text-ink">{picked.length}</b> เครื่อง
            </p>
          )}
        </>
      )}
    </section>
  )
}
