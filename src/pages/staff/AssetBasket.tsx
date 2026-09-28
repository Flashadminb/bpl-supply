import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import {
  assetCheckoutMany,
  listAssetHoldings,
  listAssetOpenIssues,
  listAssetPhotoSteps,
  listAssetTypes,
  listAssets,
} from '../../lib/api'
import { readableError } from '../../lib/supabase'
import { StaffPage, TopBar } from '../../components/Shell'
import { ErrorBox, Loading, Spinner } from '../../components/ui'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { PartBoundary } from '../../components/ErrorBoundary'
import { ProxyPicker } from '../../components/ProxyPicker'
import { stampLines } from '../../lib/image'
import { canProxy } from '../../lib/roles'
import { LOST, isLost, symptomsFor } from '../../lib/symptoms'
import type { ProxyTarget } from '../../lib/api'
import type { AssetIssueInput, AssetPhotoStep } from '../../lib/types'

/**
 * เบิกอุปกรณ์แบบตะกร้า — เลือกข้ามประเภทได้ในรอบเดียว
 *
 * ของเดิมบังคับเบิกทีละประเภท คนที่ต้องใช้รถกับวิทยุพร้อมกันต้องกดสองรอบ
 * ถ่ายรูปสองรอบ ได้ใบสองใบ ทั้งที่เป็นการรับของครั้งเดียว
 *
 * ตะกร้านี้เลือกรวมได้ แต่ขั้นถ่ายรูป "แยกเป็นช่วงตามประเภท"
 * เพราะจำนวนรูปบังคับไม่เท่ากัน รถแดงห้าใบตามขั้นตอน ที่เหลือหนึ่งใบขึ้นไป
 * ถ้าถ่ายกองรวมจะไม่รู้ว่ารูปไหนของประเภทไหน แล้วหลักฐานใช้ไม่ได้
 *
 * เบื้องหลังยังออกใบแยกตามประเภทเหมือนเดิม หน้าสถานะเบิก-คืนจะรวมกลับมาเป็นการ์ดเดียว
 */

type Step = 'pick' | 'photo'

/**
 * ตำแหน่งแถบปุ่มลอย — เหนือแถบเมนูล่างพอดี
 * แถบเมนูสูง = ปุ่ม 44px + py-2 16px + ขอบล่างปลอดภัยของเครื่อง
 */
const OVER_NAV = 'bottom-[calc(60px+max(16px,env(safe-area-inset-bottom)))]'

export default function AssetBasket() {
  const { profile } = useAuth()
  const nav = useNavigate()

  const types = useAsync(() => listAssetTypes(), [])
  const assets = useAsync(() => listAssets(), [])
  const held = useAsync(() => listAssetHoldings(false), [])
  const issues = useAsync(() => listAssetOpenIssues(), [])

  const [step, setStep] = useState<Step>('pick')
  const [openType, setOpenType] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [newIssue, setNewIssue] = useState<Record<string, string>>({})
  const [shotsBy, setShotsBy] = useState<Record<string, Shot[]>>({})
  const [stepsBy, setStepsBy] = useState<Record<string, AssetPhotoStep[]>>({})
  const [forUser, setForUser] = useState<ProxyTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const holdBy = useMemo(() => new Map((held.data ?? []).map((h) => [h.asset_code, h])), [held.data])
  const faultBy = useMemo(
    () => new Map((issues.data ?? []).map((i) => [i.asset_code, i])),
    [issues.data],
  )

  /**
   * หัวข้อในหน้าจอ — แยกทุกประเภทรวมของพ่วง
   *
   * เดิมของพ่วงซ่อนอยู่ใต้ประเภทแม่ คนหาไม่เจอว่าเลเซอร์ลบอยู่ไหน
   * ตอนนี้แยกหัวข้อของตัวเอง แต่ยังถ่ายรูปรวมกับประเภทแม่เหมือนเดิม
   * เพราะมันคือไอดาต้ารุ่นหนึ่ง ไม่ใช่ของคนละชนิด
   */
  const mainTypes = useMemo(() => {
    const on = (types.data ?? []).filter((t) => t.is_active)
    // ของพ่วงต้องอยู่ต่อจากประเภทแม่ ไม่ใช่ไปโผล่ท้ายรายการ
    const parents = on.filter((t) => !t.parent_code)
    return parents.flatMap((t) => [t, ...on.filter((x) => x.parent_code === t.code)])
  }, [types.data])

  /** ประเภทที่ใช้เก็บรูป — ของพ่วงยืมของประเภทแม่ */
  const photoKeyOf = useMemo(() => {
    const parent = new Map((types.data ?? []).map((t) => [t.code, t.parent_code]))
    return (code: string) => parent.get(code) ?? code
  }, [types.data])

  const rowsOf = useMemo(() => {
    const m = new Map<string, typeof assets.data>()
    for (const t of mainTypes) {
      m.set(
        t.code,
        (assets.data ?? []).filter((a) => a.type_code === t.code && a.is_enabled),
      )
    }
    return m
  }, [mainTypes, assets.data])

  const chosenTypes = useMemo(
    () => Object.keys(picked).filter((k) => picked[k]?.length > 0),
    [picked],
  )

  /** กลุ่มถ่ายรูป — เลเซอร์ลบไปรวมกับไอดาต้า ถ่ายชุดเดียว */
  const photoGroups = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const t of chosenTypes) {
      const key = photoKeyOf(t)
      m.set(key, [...(m.get(key) ?? []), ...picked[t]])
    }
    return [...m.entries()].map(([code, codes]) => ({ code, codes }))
  }, [chosenTypes, picked, photoKeyOf])
  const totalPicked = chosenTypes.reduce((n, k) => n + picked[k].length, 0)

  // โหลดขั้นตอนถ่ายรูปของประเภทที่เลือกไว้ ตอนเข้าขั้นถ่ายรูป
  useEffect(() => {
    if (step !== 'photo') return
    let alive = true
    for (const g of photoGroups) {
      if (stepsBy[g.code]) continue
      void listAssetPhotoSteps(g.code).then((r) => {
        if (alive) setStepsBy((v) => ({ ...v, [g.code]: r }))
      })
    }
    return () => {
      alive = false
    }
  }, [step, photoGroups, stepsBy])

  function toggle(typeCode: string, code: string) {
    if (holdBy.has(code)) return
    setPicked((v) => {
      const cur = v[typeCode] ?? []
      const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]
      return { ...v, [typeCode]: next }
    })
  }

  function needOf(typeCode: string) {
    const st = stepsBy[typeCode]
    if (st && st.length > 0) return st.length
    return (types.data ?? []).find((t) => t.code === typeCode)?.photo_min ?? 1
  }

  const photoReady = photoGroups.every((g) => {
    const shots = shotsBy[g.code] ?? []
    const done = shotsToPhotos(shots).length
    return done >= needOf(g.code) && !shots.some((s) => s.state !== 'done')
  })

  const missing = photoGroups.reduce(
    (n, g) => n + Math.max(needOf(g.code) - shotsToPhotos(shotsBy[g.code] ?? []).length, 0),
    0,
  )

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      /**
       * หนึ่งกลุ่มถ่ายรูป = หนึ่งใบ
       * เลเซอร์ลบรวมอยู่ในใบของไอดาต้า เพราะมันคือไอดาต้ารุ่นหนึ่ง
       * ฐานข้อมูลยอมรับของพ่วงใต้ประเภทแม่ให้แล้ว (047)
       */
      const groups = photoGroups.map((g) => ({
        type_code: g.code,
        codes: g.codes,
        photos: shotsToPhotos(shotsBy[g.code] ?? []),
        issues: g.codes
          .filter((c) => (newIssue[c] ?? '').trim())
          .map<AssetIssueInput>((c) => ({ asset_code: c, symptom: newIssue[c].trim() })),
      }))

      const res = await assetCheckoutMany({ groups, forUserId: forUser?.id ?? null })
      nav(`/assets/done/${res.refs[0]}`, {
        state: {
          kind: 'out',
          refNo: res.ref_no,
          codes: chosenTypes.flatMap((c) => picked[c]),
          typeName: chosenTypes
            .map((c) => (types.data ?? []).find((t) => t.code === c)?.name ?? c)
            .join(' · '),
          photoCount: photoGroups.reduce(
            (n, g) => n + shotsToPhotos(shotsBy[g.code] ?? []).length,
            0,
          ),
        },
      })
    } catch (e) {
      setError(readableError(e))
      setBusy(false)
    }
  }

  const loading = types.loading || assets.loading || held.loading

  return (
    <>
      <TopBar title={step === 'pick' ? 'เบิกอุปกรณ์' : 'ถ่ายรูปสภาพเครื่อง'} back="/" />

      {/* ปุ่มย้อนของ TopBar พาออกจากหน้าไปเลย ซึ่งทิ้งตะกร้าที่เลือกไว้ทั้งกอง
          ขั้นถ่ายรูปจึงต้องมีทางกลับของตัวเองที่ไม่ทำลายสิ่งที่เลือกมาแล้ว */}
      <StaffPage>
        {loading && <Loading />}
        {assets.error && <ErrorBox message={assets.error} onRetry={assets.reload} />}

        {/* ============================================ ขั้นที่ 1 เลือกเครื่อง */}
        {!loading && step === 'pick' && (
          <>
            {canProxy(profile) && (
              <ProxyPicker
                value={forUser}
                onChange={setForUser}
                myName={profile?.full_name ?? ''}
              />
            )}

            <div className="space-y-2">
              {mainTypes.map((t) => {
                const rows = rowsOf.get(t.code) ?? []
                const free = rows.filter((a) => !holdBy.has(a.code)).length
                const mine = picked[t.code] ?? []
                const open = openType === t.code
                return (
                  <section key={t.code} className="overflow-hidden rounded-card border border-line">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 bg-surface-2 px-4 py-3 text-left"
                      onClick={() => setOpenType(open ? null : t.code)}
                    >
                      <span className="min-w-0 font-display text-md">
                        {t.name}
                        {t.parent_code && (
                          <span className="block text-xs font-normal text-ink-400">
                            ถ่ายรูปรวมกับ
                            {' '}
                            {(types.data ?? []).find((x) => x.code === t.parent_code)?.name ??
                              t.parent_code}
                          </span>
                        )}
                      </span>
                      <span className="text-sm text-ink-500">
                        {mine.length > 0
                          ? `เลือก ${mine.length} จาก ${free}`
                          : free === 0
                            ? 'ไม่มีเครื่องว่าง'
                            : `ว่าง ${free}`}{' '}
                        <span aria-hidden>{open ? '▾' : '▸'}</span>
                      </span>
                    </button>

                    {open && (
                      <ul className="bg-surface px-4 pb-2">
                        {rows.length === 0 && (
                          <li className="py-3 text-sm text-ink-400">ไม่มีเครื่องในประเภทนี้</li>
                        )}
                        {rows.map((a) => {
                          const h = holdBy.get(a.code)
                          const on = mine.includes(a.code)
                          const fault = faultBy.get(a.code)
                          const note = newIssue[a.code] ?? ''
                          return (
                            <li key={a.code} className="border-b border-line last:border-0">
                              <div className="flex items-center gap-3 py-2">
                                <button
                                  type="button"
                                  aria-label={`เลือก ${a.code}`}
                                  disabled={Boolean(h)}
                                  onClick={() => toggle(t.code, a.code)}
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-btn border text-sm ${
                                    on
                                      ? 'border-ink bg-ink text-white'
                                      : h
                                        ? 'border-line text-transparent'
                                        : 'border-line-2 text-transparent'
                                  }`}
                                >
                                  ✓
                                </button>

                                <span className={`min-w-0 flex-1 ${h ? 'opacity-60' : ''}`}>
                                  <span className="font-mono text-base">{a.code}</span>
                                  {/* ปัญหาเดิมอ่านอย่างเดียว บรรทัดเดียวพอ ไม่งั้น 20 เครื่องจะยาวเกินจอ */}
                                  {fault && (
                                    <span className="block truncate text-xs text-warn-txt">
                                      ⚠ แจ้งไว้แล้ว · {fault.symptoms}
                                    </span>
                                  )}
                                </span>

                                <span className="shrink-0 text-right">
                                  <span
                                    className={`block text-xs ${h ? 'text-ink-500' : 'text-success-txt'}`}
                                  >
                                    {h ? `${h.holder_name} ถืออยู่` : 'ว่าง'}
                                  </span>
                                  {/* ปุ่มแจ้งเสีย — เดิมเป็นตัวหนังสือขีดเส้นใต้เล็ก ๆ หน้างานใส่ถุงมือไม่เห็นและกดไม่โดน
                                      ตอนนี้เป็นปุ่มสีเหลืองเต็มตัว สูงพอให้นิ้วโป้งกดได้ */}
                                  {on && newIssue[a.code] === undefined && (
                                    <button
                                      type="button"
                                      className="mt-1 h-tap rounded-btn bg-warn-bg px-3 text-sm font-semibold text-warn-txt"
                                      onClick={() => setNewIssue((v) => ({ ...v, [a.code]: '' }))}
                                    >
                                      ⚠ แจ้งเครื่องเสีย
                                    </button>
                                  )}
                                </span>
                              </div>

                              {on && newIssue[a.code] !== undefined && (
                                <div className="mb-2 rounded-card bg-warn-bg p-3">
                                  <div className="mb-2 flex items-start justify-between gap-2">
                                    <p className="text-sm font-semibold text-warn-txt">
                                      แจ้งเครื่องเสีย · {a.code}
                                      <span className="block text-xs font-normal">
                                        เครื่องมีปัญหามาก่อนแล้ว แจ้งไว้กันโดนโทษทีหลัง
                                      </span>
                                    </p>
                                    <button
                                      type="button"
                                      className="shrink-0 text-sm underline"
                                      onClick={() =>
                                        setNewIssue((v) => {
                                          const n = { ...v }
                                          delete n[a.code]
                                          return n
                                        })
                                      }
                                    >
                                      ไม่แจ้ง
                                    </button>
                                  </div>
                                  <div className="mb-2 flex flex-wrap gap-2">
                                    {symptomsFor(a.type_code, 'out').map((sym) => (
                                      <button
                                        key={sym}
                                        type="button"
                                        className={`chip ${note === sym ? 'chip-on' : ''}`}
                                        onClick={() =>
                                          setNewIssue((v) => ({ ...v, [a.code]: sym }))
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
                                      setNewIssue((v) => ({ ...v, [a.code]: e.target.value }))
                                    }
                                  />
                                  {isLost(note) && (
                                    <p className="mt-1 rounded-btn bg-danger-bg px-2 py-1 text-xs text-danger-txt">
                                      แจ้ง{LOST} · แอดมินจะได้รับแจ้งเตือนทันทีที่กดส่ง
                                    </p>
                                  )}
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>

            {/* เว้นที่ให้แถบลอย ไม่งั้นเครื่องตัวสุดท้ายจะถูกบัง */}
            {totalPicked > 0 && <div aria-hidden className="h-[96px]" />}

            {totalPicked > 0 && (
              <div
                className={`fixed inset-x-0 ${OVER_NAV} z-40 border-t border-line bg-surface px-3 py-3 shadow-lg`}
              >
                <div className="mx-auto max-w-phone">
                  <p className="mb-2 text-sm">
                    เลือกแล้ว{' '}
                    <b>
                      {totalPicked} เครื่อง · {chosenTypes.length} ประเภท
                    </b>
                  </p>
                  <button
                    type="button"
                    className="btn-primary w-full py-4 text-md"
                    onClick={() => setStep('photo')}
                  >
                    ถัดไป — ถ่ายรูป
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============================================ ขั้นที่ 2 ถ่ายรูป */}
        {step === 'photo' && (
          <>
            <button
              type="button"
              className="btn-ghost mb-3 h-tap w-full text-sm"
              onClick={() => setStep('pick')}
            >
              ← กลับไปแก้รายการที่เลือก
            </button>

            <p className="mb-3 rounded-card bg-brand-50 px-3 py-2 text-sm text-ink-700">
              ถ่ายแยกตามประเภท · แต่ละประเภทบังคับจำนวนไม่เท่ากัน
              <br />
              ถ่ายรวมกันไม่ได้ เพราะรูปต้องผูกกับประเภทให้ถูกตัว
              <br />
              เลเซอร์ลบถ่ายรวมอยู่ในชุดของไอดาต้า เพราะมันคือไอดาต้ารุ่นหนึ่ง
            </p>

            {photoGroups.map(({ code, codes }) => {
              const t = (types.data ?? []).find((x) => x.code === code)
              const st = stepsBy[code]
              const shots = shotsBy[code] ?? []
              const done = shotsToPhotos(shots).length
              const need = needOf(code)
              return (
                <section key={code} className="mb-4 rounded-card border border-line p-3">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-display text-md">{t?.name ?? code}</p>
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
                          forUser?.full_name ?? profile?.full_name ?? '',
                          forUser?.employee_code ?? profile?.employee_code ?? '',
                          profile?.dept_code ?? 'BPL',
                          `เบิก ${t?.name ?? code}`,
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

            {error && (
              <div className="mb-3">
                <ErrorBox message={error} />
              </div>
            )}

            <div aria-hidden className="h-[96px]" />

            <div
              className={`fixed inset-x-0 ${OVER_NAV} z-40 border-t border-line bg-surface px-3 py-3 shadow-lg`}
            >
              <div className="mx-auto max-w-phone">
              <button
                type="button"
                className="btn-primary w-full py-4 text-md"
                disabled={!photoReady || busy}
                onClick={() => void submit()}
              >
                {busy ? <Spinner /> : null}
                {busy
                  ? 'กำลังบันทึก…'
                  : photoReady
                    ? `ยืนยันเบิก ${totalPicked} เครื่อง`
                    : `ยังถ่ายไม่ครบ — เหลือ ${missing} ใบ`}
                </button>
              </div>
            </div>
          </>
        )}

        {/* เครื่องที่คนอื่นถืออยู่ ติ๊กไม่ได้ ต้องใช้การโอนซึ่งตัดของจากคนเดิมให้ถูกต้อง */}
        {step === 'pick' && !loading && (
          <p className="mt-4 text-center text-xs text-ink-400">
            เครื่องที่มีคนถืออยู่ติ๊กไม่ได้ · ถ้าจำเป็นต้องใช้ ให้แจ้งแอดมินโอนให้
          </p>
        )}
      </StaffPage>
    </>
  )
}
