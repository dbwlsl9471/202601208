import { adminName, getSession } from '@/lib/auth'
import { DASHBOARD_MARKUP } from '@/lib/dashboard-markup'
import DashboardScripts from './DashboardScripts'

const PEERS_BUTTON_END = '<span id="peers-label">경쟁사 그룹</span></button>'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// 대시보드 화면 틀은 그대로 쓰고(app.js가 채움), 머리글의 경쟁사 버튼 옆에 관리자 로그인·로그아웃 버튼만 붙인다
export default async function Home() {
  const session = await getSession()
  const adminButton = session
    ? `<button class="pill-btn" id="logout-btn" type="button" title="${esc(adminName())}(관리자)로 로그인됨"><span class="dot ours"></span>로그아웃</button>`
    : '<a class="pill-btn" href="/login" style="text-decoration:none;color:inherit">관리자 로그인</a>'
  const markup = DASHBOARD_MARKUP.replace(PEERS_BUTTON_END, PEERS_BUTTON_END + adminButton)
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: markup }} />
      <DashboardScripts />
    </>
  )
}
