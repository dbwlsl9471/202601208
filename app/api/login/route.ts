import { cookies } from 'next/headers'
import {
  SESSION_COOKIE, authConfigured, checkCredentials, clearFailures, createSessionToken, recordFailure, sameOrigin, tooManyAttempts,
} from '@/lib/auth'

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ message: '허용되지 않은 요청입니다.' }, { status: 403 })
  if (!authConfigured()) return Response.json({ message: '관리자 계정이 아직 설정되지 않았습니다.' }, { status: 503 })
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local'
  if (tooManyAttempts(ip)) return Response.json({ message: '로그인 시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요.' }, { status: 429 })
  let id = '', password = ''
  try {
    const b = await req.json()
    id = String(b.id || '')
    password = String(b.password || '')
  } catch {
    /* 빈 값으로 실패 처리 */
  }
  if (!id || !password || !checkCredentials(id, password)) {
    recordFailure(ip)
    await new Promise((r) => setTimeout(r, 400))
    return Response.json({ message: '아이디 또는 비밀번호가 맞지 않습니다.' }, { status: 401 })
  }
  clearFailures(ip)
  const { token, maxAge } = createSessionToken(id)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge })
  return Response.json({ ok: true })
}
