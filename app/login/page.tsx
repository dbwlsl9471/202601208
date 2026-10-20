import { redirect } from 'next/navigation'
import { authConfigured, getSession } from '@/lib/auth'
import LoginForm from './LoginForm'

export const metadata = { title: '관리자 로그인 · 퇴직연금 수익률 대시보드' }

export default async function LoginPage() {
  if (await getSession()) redirect('/#data')
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">관리자 로그인</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          분기 데이터 업로드·삭제는 관리자만 할 수 있습니다. 대시보드 보기는 로그인 없이 됩니다.
        </p>
        {authConfigured() ? (
          <LoginForm />
        ) : (
          <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            관리자 계정이 아직 설정되지 않았습니다. 배포 설정에 ADMIN_ID, ADMIN_PASSWORD_HASH, SESSION_SECRET을 넣어 주세요.
          </p>
        )}
        <a href="/" className="mt-5 inline-block text-sm text-slate-500 underline-offset-2 hover:underline dark:text-slate-400">
          대시보드로 돌아가기
        </a>
      </div>
    </main>
  )
}
