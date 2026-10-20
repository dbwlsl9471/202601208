import { promises as fs } from 'node:fs'
import path from 'node:path'

// 대시보드 문서(PensionData 형식 JSON 하나)를 저장한다.
//   supabase: SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 있으면 dashboard_state 표의 'main' 행 (supabase/schema.sql)
//   file:     개발 중(npm run dev)에는 .data/dashboard.json
//   none:     배포본에 저장소 설정이 없으면 저장하지 않고 public/dashboard/dashboard-data.json만 보여 준다
// ver는 저장할 때마다 1씩 오른다. 저장은 읽은 ver가 그대로일 때만 성공한다(동시 저장 충돌 방지).

export type StorageKind = 'supabase' | 'file' | 'none'
export type Stored = { doc: unknown; ver: number; updatedAt: string | null; updatedBy: string | null }
export class ConflictError extends Error {}

const ROW_ID = 'main'
const FILE = path.join(process.cwd(), '.data', 'dashboard.json')

export function storageKind(): StorageKind {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return 'supabase'
  if (process.env.NODE_ENV !== 'production' || process.env.STORAGE === 'file') return 'file'
  return 'none'
}

function sb(pathAndQuery: string, init: RequestInit = {}) {
  const base = process.env.SUPABASE_URL!.replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    ...init,
    cache: 'no-store',
    headers: {
      apikey: key,
      // 예전 service_role 키(JWT)는 Authorization에도 넣는다. 새 sb_secret_ 키는 apikey만 받는다
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

async function sbJson(res: Response) {
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// 문서 없이 버전만 (새 저장이 있는지 확인용)
export async function readVersion(): Promise<{ ver: number; updatedAt: string | null }> {
  const kind = storageKind()
  if (kind === 'supabase') {
    const rows = await sbJson(await sb(`dashboard_state?id=eq.${ROW_ID}&select=ver,updated_at`))
    return rows[0] ? { ver: rows[0].ver, updatedAt: rows[0].updated_at } : { ver: 0, updatedAt: null }
  }
  if (kind === 'file') {
    const s = await readFile()
    return { ver: s ? s.ver : 0, updatedAt: s ? s.updatedAt : null }
  }
  return { ver: 0, updatedAt: null }
}

export async function readState(): Promise<Stored | null> {
  const kind = storageKind()
  if (kind === 'supabase') {
    const rows = await sbJson(await sb(`dashboard_state?id=eq.${ROW_ID}&select=doc,ver,updated_at,updated_by`))
    const r = rows[0]
    return r ? { doc: r.doc, ver: r.ver, updatedAt: r.updated_at, updatedBy: r.updated_by } : null
  }
  if (kind === 'file') return readFile()
  return null
}

export async function writeState(doc: unknown, baseVer: number, by: string): Promise<number> {
  const kind = storageKind()
  const ver = baseVer + 1
  const updatedAt = new Date().toISOString()
  if (kind === 'supabase') {
    if (baseVer === 0) {
      const res = await sb('dashboard_state', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ id: ROW_ID, doc, ver, updated_at: updatedAt, updated_by: by }),
      })
      if (res.status === 409) throw new ConflictError()
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return ver
    }
    const rows = await sbJson(
      await sb(`dashboard_state?id=eq.${ROW_ID}&ver=eq.${baseVer}&select=ver`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ doc, ver, updated_at: updatedAt, updated_by: by }),
      }),
    )
    if (!rows.length) throw new ConflictError()
    return ver
  }
  if (kind === 'file') {
    const cur = await readFile()
    if ((cur ? cur.ver : 0) !== baseVer) throw new ConflictError()
    await fs.mkdir(path.dirname(FILE), { recursive: true })
    const tmp = FILE + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ doc, ver, updatedAt, updatedBy: by }))
    await fs.rename(tmp, FILE)
    return ver
  }
  throw new Error('저장소가 설정되지 않았습니다.')
}

async function readFile(): Promise<Stored | null> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as Stored
  } catch {
    return null
  }
}
