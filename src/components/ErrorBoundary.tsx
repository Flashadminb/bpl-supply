import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * ตัวดักข้อผิดพลาดทั้งแอป
 *
 * React 18 ถ้ามีจุดไหนพังตอนวาดหน้า แล้วไม่มีตัวดัก มันจะถอดทั้งแอปออกจากจอ
 * ผลคือ "จอขาวโล่ง" ไม่มีข้อความ ไม่มีปุ่ม กดอะไรไม่ได้ ต้องปิดแอปเปิดใหม่อย่างเดียว
 * หน้างานจะรายงานกลับมาได้แค่ว่า "แอพพัง" ซึ่งตามหาสาเหตุไม่ได้เลย
 *
 * อาการที่เจอบ่อยที่สุดคือหลัง deploy
 * หน้าจอที่เปิดค้างไว้ยังถือโค้ดชุดเก่า พอกดเปลี่ยนหน้าจะไปโหลดไฟล์ย่อยของชุดเก่า
 * ซึ่งถูกลบไปแล้วตอน deploy ใหม่ → โหลดไม่เจอ → พังทั้งแอป → จอขาว
 * เคสนี้ไม่ต้องให้ใครมาแก้ แค่โหลดหน้าใหม่ก็ได้โค้ดชุดใหม่ครบ จึงรีโหลดให้เองเลย
 *
 * กันรีโหลดวน: จำเวลาไว้ใน sessionStorage ถ้าเพิ่งรีโหลดไปไม่ถึงครึ่งนาที
 * จะไม่รีโหลดซ้ำ แต่โชว์หน้าขอโทษแทน ไม่งั้นถ้าพังจริงจะวนไม่จบ
 */

const RELOAD_KEY = 'bpl.chunk.reload'
const RELOAD_GAP_MS = 30_000

/** ข้อผิดพลาดจากโหลดไฟล์ย่อยไม่เจอ — แปลว่าโค้ดในจอเก่ากว่าบนเซิร์ฟเวอร์ */
function isStaleBuildError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Failed to fetch/i.test(
    msg,
  )
}

function reloadedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    return Date.now() - last < RELOAD_GAP_MS
  } catch {
    // โหมดไม่ระบุตัวตนอ่านเขียนไม่ได้ · ถือว่ายังไม่เคยรีโหลด
    return false
  }
}

function markReloaded() {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    /* ไม่เป็นไร แค่จะกันวนได้ไม่ดีเท่าเดิม */
  }
}

interface State {
  err: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // เก็บลง console ไว้ให้เปิดดูย้อนหลังได้ตอนมีคนแจ้งว่าเจอจอขาว
    console.error('[BPL] แอปพังตอนวาดหน้า', err, info.componentStack)
  }

  render() {
    const { err } = this.state
    if (!err) return this.props.children

    if (isStaleBuildError(err) && !reloadedRecently()) {
      markReloaded()
      window.location.reload()
      return null
    }

    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-phone text-center">
          <p className="font-display text-lg">หน้านี้มีปัญหา</p>
          <p className="mt-2 text-sm text-ink-500">
            ระบบเจอข้อผิดพลาดจนแสดงหน้านี้ต่อไม่ได้
            <br />
            ข้อมูลที่บันทึกไปแล้วไม่หาย กดปุ่มข้างล่างเพื่อเริ่มใหม่ได้เลย
          </p>

          {/* ข้อความดิบไว้ให้แคปหน้าจอส่งให้แอดมิน ตามหาสาเหตุได้เร็วกว่าคำว่า "แอพพัง" */}
          <p className="mt-3 break-words rounded-card bg-surface-2 p-3 text-left font-mono text-xs text-ink-500">
            {err.name}: {err.message}
          </p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-primary h-tap flex-1"
              onClick={() => window.location.reload()}
            >
              โหลดหน้านี้ใหม่
            </button>
            <button
              type="button"
              className="btn-soft h-tap flex-1"
              onClick={() => window.location.assign('/')}
            >
              กลับหน้าแรก
            </button>
          </div>
        </div>
      </div>
    )
  }
}

/**
 * ตัวดักเฉพาะส่วน — ใช้ครอบกล่องถ่ายรูป
 *
 * ถ้ากล้องหรือการบีบอัดรูปพัง ต้องพังแค่กล่องนั้น
 * คนที่กำลังคืนของอยู่จะได้ไม่เสียรายการที่เลือกไว้ทั้งหมดแล้วต้องเริ่มใหม่
 */
export class PartBoundary extends Component<{ children: ReactNode; label: string }, State> {
  state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error) {
    console.error('[BPL] ส่วนย่อยพัง', this.props.label, err)
  }

  render() {
    const { err } = this.state
    if (!err) return this.props.children

    return (
      <div className="rounded-card border border-danger/25 bg-danger-bg p-3 text-sm text-danger-txt">
        <p className="font-display">{this.props.label} มีปัญหา</p>
        <p className="mt-1 break-words font-mono text-xs">{err.message}</p>
        <button
          type="button"
          className="btn-soft mt-2 h-tap w-full text-sm"
          onClick={() => this.setState({ err: null })}
        >
          ลองใหม่
        </button>
      </div>
    )
  }
}
