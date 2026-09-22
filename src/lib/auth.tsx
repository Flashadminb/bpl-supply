import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, emailFromEmployeeCode, readableError } from './supabase'
import type { Profile, UserRole } from './types'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  hubName: string | null
  loading: boolean
  signIn: (employeeCode: string, password: string, remember: boolean) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  can: (...roles: UserRole[]) => boolean
}

const Ctx = createContext<AuthValue | null>(null)
const REMEMBER_KEY = 'bpl.remember.code'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [hubName, setHubName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setHubName(null)
        setLoading(false)
      }
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, hubs(name)')
      .eq('id', userId)
      .single()
    if (error || !data) {
      console.error('[BPL] โหลดโปรไฟล์ไม่สำเร็จ', error)
      setProfile(null)
      return
    }
    const { hubs, ...rest } = data as Profile & { hubs?: { name: string } | null }
    setProfile(rest as Profile)
    setHubName(hubs?.name ?? rest.hub_code)
  }, [])

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return
    let alive = true
    setLoading(true)
    loadProfile(userId).finally(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [session?.user?.id, loadProfile])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      hubName,
      loading,
      can: (...roles: UserRole[]) => !!profile && roles.includes(profile.role),
      async signIn(employeeCode, password, remember) {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailFromEmployeeCode(employeeCode),
          password,
        })
        if (error) throw new Error(readableError(error))
        if (remember) localStorage.setItem(REMEMBER_KEY, employeeCode.trim())
        else localStorage.removeItem(REMEMBER_KEY)
      },
      async signOut() {
        await supabase.auth.signOut()
        setProfile(null)
      },
      async refreshProfile() {
        if (session?.user?.id) await loadProfile(session.user.id)
      },
    }),
    [session, profile, hubName, loading, loadProfile],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth ต้องอยู่ภายใน AuthProvider')
  return v
}

export function rememberedCode(): string {
  return localStorage.getItem(REMEMBER_KEY) ?? ''
}
