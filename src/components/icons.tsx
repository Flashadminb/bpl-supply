/**
 * ไอคอนเมนู
 *
 * วาดเองด้วย SVG เส้น ไม่ดึงไลบรารีเข้ามา เพราะใช้แค่สิบกว่าตัว
 * ไลบรารีไอคอนตัวเล็กสุดก็ยังหนักกว่าไฟล์นี้หลายเท่า และหน้างานเน็ตไม่นิ่ง
 *
 * ทุกตัวเป็นเส้น 1.6 หน่วยบนกริด 24 ใช้ currentColor
 * จึงเปลี่ยนสีตามข้อความรอบ ๆ ได้เองโดยไม่ต้องส่ง prop
 */

export type IconName =
  | 'home'
  | 'photo'
  | 'clock'
  | 'device-clock'
  | 'box'
  | 'inbox'
  | 'barcode'
  | 'device'
  | 'chart'
  | 'pie'
  | 'qr'
  | 'sheet'
  | 'users'
  | 'bell'

const PATHS: Record<IconName, JSX.Element> = {
  // บ้าน — หน้าแรก
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  // รูปถ่าย — หลักฐาน
  photo: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2.5" />
      <path d="M8 6l1.5-2h5L16 6" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  // นาฬิกาในกล่อง — ของค้างคืน
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  // เครื่องกับนาฬิกา — Asset ที่ยังไม่คืน
  'device-clock': (
    <>
      <rect x="3.5" y="3.5" width="11" height="17" rx="2" />
      <path d="M7 17.5h4" />
      <circle cx="18" cy="16" r="4.2" />
      <path d="M18 13.8V16l1.5 1" />
    </>
  ),
  // กล่องซ้อน — สต็อก
  box: (
    <>
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" />
      <path d="M3.5 7.5 12 11.5l8.5-4" />
      <path d="M12 11.5v9" />
    </>
  ),
  // ถาดรับเรื่อง — คำขอเบิก
  inbox: (
    <>
      <path d="M3.5 13.5 6 5h12l2.5 8.5v5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" />
    </>
  ),
  // บาร์โค้ด — BY
  barcode: (
    <>
      <path d="M3.5 5.5v13M7 5.5v13M10.5 5.5v13M14 5.5v9M17.5 5.5v13M20.5 5.5v13" />
    </>
  ),
  // แท็บเล็ต — ทะเบียนเครื่อง
  device: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <path d="M10 18.5h4" />
    </>
  ),
  // กราฟแท่ง — รายงานสิ้นเปลือง
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8.5 20v-6M13 20v-10M17.5 20v-4" />
    </>
  ),
  // วงกลมแบ่งส่วน — รายงาน Asset
  pie: (
    <>
      <path d="M12 3.8a8.2 8.2 0 1 0 8.2 8.2H12z" />
      <path d="M14.8 2.6a8.2 8.2 0 0 1 6.6 6.6h-6.6z" />
    </>
  ),
  // คิวอาร์ — พิมพ์ QR
  qr: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <path d="M13.5 13.5h3v3h-3zM18 18h2.5v2.5H18zM13.5 20.5h1.5M20.5 13.5V16" />
    </>
  ),
  // ตาราง — ส่งออก Sheet
  sheet: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M9.5 9.5V20M15 9.5V20" />
    </>
  ),
  // คนสองคน — ผู้ใช้และสิทธิ์
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.8 20c0-3.4 2.8-5.5 6.2-5.5s6.2 2.1 6.2 5.5" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M17.6 14.9c2.2.6 3.6 2.3 3.6 5.1" />
    </>
  ),
  // กระดิ่ง — แจ้งเตือน
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  ),
}

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-5 w-5 shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  )
}
