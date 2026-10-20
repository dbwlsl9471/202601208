import { adminName, authConfigured, getSession } from '@/lib/auth'
import { storageKind } from '@/lib/storage'

export async function GET() {
  const admin = Boolean(await getSession())
  const storage = storageKind()
  return Response.json(
    { admin, name: admin ? adminName() : null, canSave: admin && storage !== 'none', storage, loginEnabled: authConfigured() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
