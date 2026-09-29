import { useEffect, useRef, useState } from 'react'
import { fetchEvidenceImage } from '../lib/api'
import { SackResult } from './SackResult'
import { Loading } from './ui'
import type { SackRow } from '../lib/types'

/**
 * ฟอร์มของใบที่ส่งไปแล้ว — ดึงรูปกลับมาจาก Drive ก่อนวาดการ์ด
 *
 * วาดจากลิงก์ Drive ตรง ๆ ไม่ได้ canvas จะถูกมาร์กว่าเปื้อน
 * แล้ว toBlob จะโยน SecurityError ทิ้งทั้งใบ
 * จึงต้องโหลดเป็น blob ในเครื่องก่อนเสมอ
 *
 * รูปกระสอบเปิดให้ทุกคนที่ล็อกอินดูได้ ต่างจากรูปหลักฐานเบิก-คืน
 * (ดูเหตุผลใน supabase/functions/evidence-image/index.ts)
 */
export function SackFormView({ row }: { row: SackRow }) {
  const [urls, setUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(row.photos.length > 0)
  const madeRef = useRef<string[]>([])

  useEffect(() => {
    let alive = true
    const ids = row.photos.map((p) => p.file_id)
    if (ids.length === 0) {
      setLoading(false)
      return
    }
    setLoading(true)
    // ใบไหนโหลดไม่ได้ก็ข้าม ดีกว่าค้างทั้งการ์ดเพราะรูปเดียว
    Promise.all(ids.map((id) => fetchEvidenceImage(id).catch(() => null))).then((res) => {
      const ok = res.filter((u): u is string => Boolean(u))
      if (!alive) {
        ok.forEach((u) => URL.revokeObjectURL(u))
        return
      }
      madeRef.current = ok
      setUrls(ok)
      setLoading(false)
    })
    return () => {
      alive = false
      madeRef.current.forEach((u) => URL.revokeObjectURL(u))
      madeRef.current = []
    }
  }, [row.id])

  if (loading) {
    return (
      <div className="flex min-h-[160px] items-center justify-center">
        <Loading label="กำลังโหลดรูปหลักฐาน…" />
      </div>
    )
  }
  // มีรูปในฐานข้อมูลแต่โหลดกลับมาไม่ได้สักใบ — บอกไปตรง ๆ
  // ดีกว่าให้การ์ดออกมาไม่มีรูปเฉย ๆ แล้วคนคิดว่ารูปหายไปจากระบบ
  const missing = row.photos.length > 0 && urls.length === 0

  return (
    <>
      {missing && (
        <p className="mb-3 rounded-card bg-warn-bg p-3 text-sm text-warn-txt">
          ใบนี้มีรูปหลักฐาน {row.photos.length} ใบ แต่เปิดจากเครื่องนี้ไม่ได้
          การ์ดข้างล่างจึงมีแต่ข้อความ · ขอรูปได้ที่แอดมิน
        </p>
      )}
      <SackResult row={row} photoUrls={urls} loadingPhotos={false} />
    </>
  )
}
