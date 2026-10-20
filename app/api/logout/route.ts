import { cookies } from 'next/headers'
import { SESSION_COOKIE, sameOrigin } from '@/lib/auth'

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ message: '허용되지 않은 요청입니다.' }, { status: 403 })
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  return Response.json({ ok: true })
}
