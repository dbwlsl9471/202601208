import { adminName, getSession, sameOrigin } from '@/lib/auth'
import { ConflictError, readState, readVersion, storageKind, writeState } from '@/lib/storage'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_BYTES = 8 * 1024 * 1024

// 누구나 읽는다. ?meta=1이면 버전만 돌려준다.
// doc이 null이면 아직 저장된 적이 없으니 화면은 public/dashboard/dashboard-data.json을 쓴다.
export async function GET(req: Request) {
  try {
    if (new URL(req.url).searchParams.get('meta')) return Response.json(await readVersion(), { headers: NO_STORE })
    const s = await readState()
    return Response.json({ storage: storageKind(), ver: s ? s.ver : 0, doc: s ? s.doc : null }, { headers: NO_STORE })
  } catch (e) {
    console.error('data GET', e)
    return Response.json({ message: '저장된 데이터를 읽지 못했습니다.' }, { status: 502, headers: NO_STORE })
  }
}

// 관리자만 저장한다. body = { doc, baseVer }
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return Response.json({ code: 'not_granted', message: '허용되지 않은 요청입니다.' }, { status: 403 })
  if (!(await getSession())) return Response.json({ code: 'not_granted', message: '관리자 로그인이 필요합니다.' }, { status: 401 })
  if (storageKind() === 'none') {
    return Response.json({ code: 'not_configured', message: '저장소(Supabase)가 설정되지 않아 저장할 수 없습니다.' }, { status: 503 })
  }
  const text = await req.text()
  if (text.length > MAX_BYTES) return Response.json({ code: 'too_large', message: '데이터가 너무 큽니다.' }, { status: 413 })
  let body: { doc?: Record<string, unknown>; baseVer?: number }
  try {
    body = JSON.parse(text)
  } catch {
    return Response.json({ code: 'bad_request', message: '잘못된 데이터입니다.' }, { status: 400 })
  }
  const doc = body.doc
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.returns) || typeof doc.quarters !== 'object' || !Number.isInteger(body.baseVer)) {
    return Response.json({ code: 'bad_request', message: '대시보드 데이터 형식이 아닙니다.' }, { status: 400 })
  }
  try {
    const ver = await writeState(doc, body.baseVer as number, adminName())
    return Response.json({ ver }, { headers: NO_STORE })
  } catch (e) {
    if (e instanceof ConflictError) {
      return Response.json({ code: 'conflict', message: '그사이 다른 화면에서 먼저 저장했습니다. 최신 데이터로 바꿨으니 다시 확인하고 저장해 주세요.' }, { status: 409 })
    }
    console.error('data PUT', e)
    return Response.json({ code: 'failed', message: '저장소에 쓰지 못했습니다.' }, { status: 502 })
  }
}
