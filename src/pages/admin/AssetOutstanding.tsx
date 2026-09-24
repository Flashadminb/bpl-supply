import { useMemo, useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import {
  adminCancelAssetOut,
  adminReleaseAsset,
  assetReturn,
  listAssetHoldings,
  listAssetPhotoSteps,
  listAssetTypes,
} from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { MANAGER_ROLES } from '../../lib/roles'
import { readableError } from '../../lib/supabase'
import { PhotoSteps, shotsToPhotos, type Shot } from '../../components/PhotoSteps'
import { stampLines } from '../../lib/image'
import { EmptyState, ErrorBox, Loading, Modal, Sheet, Spinner } from '../../components/ui'
import { fmtDateTime, relativeAge } from '../../lib/format'
import type { AssetHolding } from '../../lib/types'

/**
 * เครื่องที่ยังไม่ได้คืน
 *
 * ต่างจากหน้าของค้างคืนของวัสดุตรงที่วัดด้วย "กะ" ไม่ใช่จำนวนชั่วโมงตายตัว
 * เพราะแต่ละคนเลิกกะไม่พร้อมกัน เลยเวลาเลิกกะของตัวเองเมื่อไหร่ถือว่าเกิน
 */

type SortKey = 'late' | 'oldest' | 'person' | 'asset'

const hoursLate = (h: AssetHolding) =>
  h.due_at ? (Date.now() - Date.parse(h.due_at)) / 3_600_000 : -Infinity

const shift = (h: AssetHolding) =>
  h.shift_start && h.shift_end
    ? `${h.shift_start.slice(0, 5)}–${h.shift_end.slice(0, 5)}`
    : '—'

export default function AssetOutstanding() {
  const { profile, can } = useAuth()
  const feed = useAsync(() => listAssetHoldings(false), [])
  const types = useAsync(() => listAssetTypes(), [])

  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [sort, setSort] = useState<SortKey>('late')
  const [lateOnly, setLateOnly] = useState(false)

  const all = feed.data ?? []
  const late = all.filter((h) => hoursLate(h) > 0)

  // คืนแทนเจ้าตัว — เปิดจากปุ่มท้ายแถว แล้วติ๊กเครื่องของคนนั้นที่จะคืน
  const [giveBack, setGiveBack] = useState<AssetHolding | null>(null)
  // ปิดรายการโดยไม่มีรูป · ใช้ตอนของกลับเข้าคลังแล้วแต่ลืมกดคืน
  // และยกเลิกทิ้ง · ใช้ตอนเจ้าตัวกดเบิกผิด ของไม่เคยออกไปไหน
  const [closing, setClosing] = useState<AssetHolding | null>(null)
  const [closeNote, setCloseNote] = useState('')
  const [closeBusy, setCloseBusy] = useState(false)
  const [closeErr, setCloseErr] = useState<string | null>(null)
  const mayCancel = can(...MANAGER_ROLES)
  const [picked, setPicked] = useState<string[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const steps = useAsync(
    () => (giveBack ? listAssetPhotoSteps(giveBack.type_code) : Promise.resolve([])),
    [giveBack?.type_code],
  )

  /** เครื่องของคนคนนั้น ประเภทเดียวกัน — คืนรอบเดียวได้หลายตัว */
  const sameHolder = useMemo(
    () =>
      giveBack
        ? all.filter((h) => h.user_id === giveBack.user_id && h.type_code === giveBack.type_code)
        : [],
    [all, giveBack],
  )

  const photos = shotsToPhotos(shots)
  const typeInfo = (types.data ?? []).find((t) => t.code === giveBack?.type_code)
  const needPhotos =
    steps.data && steps.data.length > 0 ? steps.data.length : (typeInfo?.photo_min ?? 1)
  const photosReady =
    photos.length >= needPhotos && !shots.some((s) => s.state !== 'done')

  function openReturn(h: AssetHolding) {
    setGiveBack(h)
    setPicked([h.asset_code])
    setShots([])
    setErr(null)
  }

  async function submitReturn() {
    if (!giveBack) return
    setBusy(true)
    setErr(null)
    try {
      const res = await assetReturn({ codes: picked, photos, note: 'คืนแทนโดยแอดมิน' })
      setOkMsg(`คืนแทนแล้ว ${res.count} เครื่อง · ${res.ref_no}`)
      setGiveBack(null)
      setShots([])
      feed.reload()
    } catch (e) {
      setErr(readableError(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    const out = all.filter((h) => {
      if (type && h.type_code !== type) return false
      if (lateOnly && hoursLate(h) <= 0) return false
      if (!s) return true
      return `${h.asset_code} ${h.holder_name} ${h.holder_code} ${h.holder_dept ?? ''} ${h.ref_no}`
        .toLowerCase()
        .includes(s)
    })
    const by: Record<SortKey, (a: AssetHolding, b: AssetHolding) => number> = {
      late: (a, b) => hoursLate(b) - hoursLate(a),
      oldest: (a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at),
      person: (a, b) => a.holder_name.localeCompare(b.holder_name, 'th'),
      asset: (a, b) => a.asset_code.localeCompare(b.asset_code, 'th'),
    }
    return [...out].sort(by[sort])
  }, [all, search, type, sort, lateOnly])

  /** จับกลุ่มว่าใครถือกี่เครื่อง ไว้ตามคนเดียวจบทีเดียว */
  const worst = useMemo(() => {
    const map = new Map<string, { name: string; code: string; n: number }>()
    for (const h of late) {
      const k = h.holder_code
      const cur = map.get(k) ?? { name: h.holder_name, code: k, n: 0 }
      cur.n++
      map.set(k, cur)
    }
    return [...map.values()].sort((a, b) => b.n - a.n).slice(0, 4)
  }, [late])

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg">Asset ที่ยังไม่คืน</h1>
        <button type="button" className="btn-soft h-tap px-3 text-sm" onClick={feed.reload}>
          รีเฟรช
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-500">ถูกยืมอยู่</p>
          <p className="mt-1 font-display text-xl leading-none">{all.length}</p>
          <p className="mt-1 text-xs text-ink-400">เครื่อง</p>
        </div>
        <div
          className={`rounded-card border p-4 ${
            late.length > 0 ? 'border-danger/25 bg-danger-bg' : 'border-line bg-surface'
          }`}
        >
          <p className="text-sm text-ink-500">เลยเวลาเลิกกะ</p>
          <p className="mt-1 font-display text-xl leading-none">{late.length}</p>
          <p className="mt-1 text-xs text-ink-400">ควรตามถามเจ้าตัว</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4 sm:col-span-2">
          <p className="text-sm text-ink-500">คนที่ค้างมากที่สุด</p>
          {worst.length === 0 ? (
            <p className="mt-1 text-sm text-success-txt">ไม่มีใครค้างเกินกะ</p>
          ) : (
            <ul className="mt-1 space-y-[2px] text-sm">
              {worst.map((w) => (
                <li key={w.code}>
                  {w.name} <span className="font-mono text-xs text-ink-400">{w.code}</span> ·{' '}
                  <b className="text-danger-txt">{w.n} เครื่อง</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[260px]"
          type="search"
          placeholder="ค้นหารหัสเครื่อง ชื่อคน หรือรหัสพนักงาน"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input h-tap max-w-[170px]"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="ประเภท"
        >
          <option value="">ทุกประเภท</option>
          {(types.data ?? []).map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className="input h-tap max-w-[180px]"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="เรียงลำดับ"
        >
          <option value="late">เกินกะนานสุดก่อน</option>
          <option value="oldest">เบิกนานสุดก่อน</option>
          <option value="person">เรียงตามคน</option>
          <option value="asset">เรียงตามรหัสเครื่อง</option>
        </select>
        <button
          type="button"
          className={`chip ${lateOnly ? 'chip-on' : ''}`}
          onClick={() => setLateOnly((v) => !v)}
        >
          เฉพาะที่เลยเวลาเลิกกะ
        </button>
      </div>

      {okMsg && (
        <p className="mb-3 rounded-card bg-success-bg px-3 py-2 text-sm text-success-txt">
          {okMsg}
          <button type="button" className="ml-2 underline" onClick={() => setOkMsg(null)}>
            ปิด
          </button>
        </p>
      )}

      {feed.loading && <Loading />}
      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

      {!feed.loading && rows.length === 0 && (
        <EmptyState
          title={all.length === 0 ? 'ไม่มีเครื่องค้างคืน' : 'ไม่พบตามเงื่อนไข'}
          hint={all.length === 0 ? 'เครื่องที่ถูกเบิกออกไปจะขึ้นที่นี่' : 'ลองล้างคำค้นหรือตัวกรอง'}
        />
      )}

      {rows.length > 0 && (
        <>
          <section className="panel overflow-x-auto p-2">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="text-ink-500">
                <tr className="border-b border-line">
                  <th className="p-2 font-medium">เครื่อง</th>
                  <th className="p-2 font-medium">ผู้ถือ</th>
                  <th className="p-2 font-medium">กะ</th>
                  <th className="p-2 font-medium">เบิกเมื่อ</th>
                  <th className="p-2 font-medium">ถือมาแล้ว</th>
                  <th className="p-2 font-medium">กำหนดคืน</th>
                  <th className="p-2 font-medium">เลขที่</th>
                  <th className="p-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const over = hoursLate(h)
                  const isLate = over > 0
                  return (
                    <tr
                      key={h.out_item_id}
                      className={`border-b border-line last:border-0 ${isLate ? 'bg-danger-bg/40' : ''}`}
                    >
                      <td className="p-2">
                        <p className="font-display">{h.asset_code}</p>
                        <p className="text-xs text-ink-400">{h.type_name}</p>
                        {h.asset_loan_dept && (
                          <p className="text-xs text-warn-txt">โอนให้ {h.asset_loan_dept}</p>
                        )}
                      </td>
                      <td className="p-2">
                        {h.holder_name}
                        <span className="ml-1 font-mono text-xs text-ink-400">{h.holder_code}</span>
                        <p className="text-xs text-ink-400">
                          {h.holder_dept}
                          {h.holder_sub_dept ? ` · ${h.holder_sub_dept}` : ''}
                        </p>
                        {/* เบิกแทนต้องเห็นว่าใครกดให้ ไม่งั้นตามเรื่องไม่ถูกคนตอนของหาย */}
                        {h.acted_by_name && (
                          <p className="text-xs text-ink-500">เบิกให้โดย {h.acted_by_name}</p>
                        )}
                      </td>
                      <td className="p-2 font-mono text-xs text-ink-500">{shift(h)}</td>
                      <td className="p-2 text-ink-500">{fmtDateTime(h.taken_at)}</td>
                      <td className="p-2">
                        <span className={isLate ? 'badge-dang' : 'badge-mute'}>
                          {relativeAge(h.taken_at)}
                        </span>
                      </td>
                      <td className="p-2">
                        {h.due_at ? (
                          <>
                            <span className={isLate ? 'text-danger-txt' : 'text-ink-500'}>
                              {fmtDateTime(h.due_at)}
                            </span>
                            {isLate && (
                              <p className="text-xs text-danger-txt">
                                เกินมาแล้ว {relativeAge(h.due_at)}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-300">ยังไม่ได้ตั้งกะ</span>
                        )}
                      </td>
                      <td className="p-2 font-mono text-xs">{h.ref_no}</td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn-soft h-tap px-3 text-sm"
                            onClick={() => openReturn(h)}
                          >
                            คืนแทน
                          </button>
                          <button
                            type="button"
                            className="btn-ghost h-tap px-3 text-sm"
                            onClick={() => {
                              setCloseErr(null)
                              setCloseNote('')
                              setClosing(h)
                            }}
                          >
                            ปิด/ยกเลิก
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          <p className="mt-2 text-sm text-ink-500">
            แสดง {rows.length} เครื่อง จากที่ถูกยืมอยู่ {all.length} เครื่อง
          </p>
        </>
      )}

      <Sheet
        open={Boolean(giveBack)}
        title={giveBack ? `คืนแทน ${giveBack.holder_name}` : ''}
        onClose={() => setGiveBack(null)}
      >
        {giveBack && (
          <>
            <p className="rounded-card bg-surface-2 px-3 py-2 text-sm text-ink-500">
              บันทึกว่าเป็นการคืนแทนโดยแอดมิน · ประวัติจะยังขึ้นชื่อ{' '}
              <b>{giveBack.holder_name}</b> เป็นผู้เบิกเหมือนเดิม
            </p>

            <p className="label mt-3">เลือกเครื่องที่จะคืน</p>
            <ul className="space-y-1">
              {sameHolder.map((h) => {
                const on = picked.includes(h.asset_code)
                return (
                  <li key={h.out_item_id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-3 rounded-card border p-3 text-left ${
                        on ? 'border-ink bg-brand-50' : 'border-line bg-surface'
                      }`}
                      onClick={() =>
                        setPicked((v) =>
                          v.includes(h.asset_code)
                            ? v.filter((c) => c !== h.asset_code)
                            : [...v, h.asset_code],
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
                        <span className="font-display">{h.asset_code}</span>
                        <span className="block text-sm text-ink-500">
                          เบิก {fmtDateTime(h.taken_at)} · {relativeAge(h.taken_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {picked.length > 0 && (
              <div className="mt-3 rounded-card border border-line p-3">
                <p className="font-display">รูปสภาพตอนคืน</p>
                <p className="mb-2 text-sm text-ink-400">
                  คืน {picked.length} เครื่อง · บังคับ {needPhotos} ใบ เหมือนตอนหน้างานคืนเอง
                </p>
                {steps.loading ? (
                  <Loading />
                ) : (
                  <PhotoSteps
                    steps={steps.data ?? []}
                    maxFree={typeInfo?.photo_max ?? 5}
                    stamp={stampLines(
                      profile?.full_name ?? '',
                      profile?.employee_code ?? '',
                      profile?.dept_code ?? 'BPL',
                      `คืนแทน ${giveBack.holder_name}`,
                    )}
                    shots={shots}
                    onShots={setShots}
                  />
                )}
              </div>
            )}

            {err && (
              <div className="mt-3">
                <ErrorBox message={err} />
              </div>
            )}

            <button
              type="button"
              className="btn-primary mt-3 w-full py-4 text-md"
              disabled={picked.length === 0 || !photosReady || busy}
              onClick={() => void submitReturn()}
            >
              {busy ? <Spinner /> : null}
              {busy
                ? 'กำลังบันทึก…'
                : picked.length === 0
                  ? 'เลือกเครื่องก่อน'
                  : photosReady
                    ? `ยืนยันคืนแทน ${picked.length} เครื่อง`
                    : `ต้องถ่ายรูปให้ครบ ${needPhotos} ใบก่อน`}
            </button>
          </>
        )}
      </Sheet>

      <p className="mt-4 rounded-card bg-brand-50 px-3 py-2 text-sm text-warn-txt">
        แถวสีแดงคือเลยเวลาเลิกกะของเจ้าตัวแล้ว — กำหนดคืนคำนวณจากกะที่ตั้งไว้ในบัญชีของแต่ละคน
        <br />
        คนที่ยังไม่ได้ตั้งกะจะไม่มีกำหนดคืน ตั้งได้ที่หน้าผู้ใช้และสิทธิ์
      </p>

      {/* ------------------------------------------- ปิดรายการโดยไม่มีรูป */}
      <Modal
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        title={closing ? `${closing.asset_code} · ${closing.holder_name}` : ''}
      >
        {closing && (
          <>
            <p className="text-sm text-ink-500">
              {closing.type_name} · เบิกเมื่อ {fmtDateTime(closing.taken_at)}
            </p>

            {/* สองปุ่มนี้ต่างกันที่ประวัติ ไม่ใช่แค่คำ จึงต้องอธิบายให้ชัด */}
            <div className="mt-3 rounded-card border border-line p-3">
              <p className="font-display">ได้ของคืนแล้ว แต่เขาลืมกดในแอพ</p>
              <p className="mt-1 text-sm text-ink-500">
                บันทึกเป็นการคืนตามปกติ แต่ไม่มีรูปประกอบ · ประวัติจะขึ้นว่าคุณเป็นคนปิดให้
              </p>
            </div>

            {mayCancel && (
              <div className="mt-2 rounded-card border border-line p-3">
                <p className="font-display">เขากดเบิกผิด ของไม่เคยออกไปไหน</p>
                <p className="mt-1 text-sm text-ink-500">
                  ลบรายการเบิกนี้ทิ้งเลย ไม่บันทึกว่าเคยคืน
                  เพราะถ้าบันทึกจะกลายเป็นประวัติที่ไม่เคยเกิดขึ้นจริง
                </p>
              </div>
            )}

            <label className="label mt-3" htmlFor="ao-why">เหตุผล</label>
            <input
              id="ao-why"
              className="input"
              placeholder="เช่น เอาเครื่องมาคืนที่ห้องแล้ว"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
            />

            {closeErr && (
              <p className="mt-3 rounded-btn bg-danger-bg px-3 py-2 text-sm text-danger-txt">
                {closeErr}
              </p>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setClosing(null)}>
                ปิดหน้าต่าง
              </button>
              {mayCancel && (
                <button
                  type="button"
                  className="h-tap rounded-btn bg-danger px-3 text-sm text-white"
                  disabled={closeBusy}
                  onClick={() => {
                    const row = closing
                    setCloseBusy(true)
                    setCloseErr(null)
                    void adminCancelAssetOut(row.out_item_id)
                      .then(() => {
                        setClosing(null)
                        feed.reload()
                      })
                      .catch((e) => setCloseErr(readableError(e)))
                      .finally(() => setCloseBusy(false))
                  }}
                >
                  ยกเลิก — กดผิด
                </button>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={closeBusy}
                onClick={() => {
                  const row = closing
                  setCloseBusy(true)
                  setCloseErr(null)
                  void adminReleaseAsset(row.out_item_id, closeNote)
                    .then(() => {
                      setClosing(null)
                      feed.reload()
                    })
                    .catch((e) => setCloseErr(readableError(e)))
                    .finally(() => setCloseBusy(false))
                }}
              >
                {closeBusy ? <Spinner /> : null} ปิดรายการ — ได้ของคืนแล้ว
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
