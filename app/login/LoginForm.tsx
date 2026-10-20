'use client'

import { useState } from 'react'

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.get('id'), password: form.get('password') }),
      })
      if (res.ok) {
        location.href = '/#data'
        return
      }
      const j = await res.json().catch(() => ({}))
      setError(j.message || '로그인하지 못했습니다.')
    } catch {
      setError('서버에 연결하지 못했습니다.')
    }
    setBusy(false)
  }

  const input =
    'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
  return (
    <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
        아이디
        <input name="id" autoComplete="username" required className={input} />
      </label>
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
        비밀번호
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="cursor-pointer rounded-lg border-0 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        {busy ? '확인 중…' : '로그인'}
      </button>
    </form>
  )
}
