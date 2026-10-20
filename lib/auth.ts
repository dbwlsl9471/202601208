import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

// 관리자 한 명(환경 변수의 ADMIN_ID / ADMIN_PASSWORD_HASH)만 로그인한다.
// 비밀번호는 서버에서만 확인하고, 브라우저에는 서명된 쿠키만 남는다.

export const SESSION_COOKIE = 'pd_session'
const SESSION_HOURS = 12

export type Session = { sub: string; exp: number }

function secret(): string | null {
  const s = process.env.SESSION_SECRET
  return s && s.length >= 32 ? s : null
}

export function authConfigured(): boolean {
  return Boolean(process.env.ADMIN_ID && process.env.ADMIN_PASSWORD_HASH && secret())
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function createSessionToken(sub: string): { token: string; maxAge: number } {
  const key = secret()
  if (!key) throw new Error('SESSION_SECRET이 설정되지 않았습니다.')
  const maxAge = SESSION_HOURS * 3600
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + maxAge })).toString('base64url')
  return { token: `${payload}.${sign(payload, key)}`, maxAge }
}

export function readSessionToken(token: string | undefined): Session | null {
  const key = secret()
  if (!token || !key) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig || !safeEqual(sig, sign(payload, key))) return null
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session
    if (s.sub !== process.env.ADMIN_ID || s.exp < Date.now() / 1000) return null
    return s
  } catch {
    return null
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies()
  return readSessionToken(jar.get(SESSION_COOKIE)?.value)
}

// ADMIN_PASSWORD_HASH 형식: scrypt:<salt base64>:<hash base64> (scripts/hash-password.mjs가 만든다)
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split(':')
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

export function checkCredentials(id: string, password: string): boolean {
  const adminId = process.env.ADMIN_ID
  const hash = process.env.ADMIN_PASSWORD_HASH
  if (!adminId || !hash) return false
  const idOk = safeEqual(id, adminId)
  const pwOk = verifyPassword(password, hash)
  return idOk && pwOk
}

export function adminName(): string {
  return process.env.ADMIN_NAME || process.env.ADMIN_ID || '관리자'
}

// 저장·로그인처럼 상태를 바꾸는 요청은 같은 사이트에서 온 것만 받는다
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host'))
  } catch {
    return false
  }
}

// 비밀번호 대입 막기: 같은 IP에서 10분에 5번까지 (서버 인스턴스마다 따로 센다)
const attempts = new Map<string, { n: number; until: number }>()
export function tooManyAttempts(ip: string): boolean {
  const a = attempts.get(ip)
  return Boolean(a && a.until > Date.now() && a.n >= 5)
}
export function recordFailure(ip: string): void {
  const now = Date.now()
  const a = attempts.get(ip)
  if (!a || a.until < now) attempts.set(ip, { n: 1, until: now + 10 * 60 * 1000 })
  else a.n += 1
}
export function clearFailures(ip: string): void {
  attempts.delete(ip)
}
