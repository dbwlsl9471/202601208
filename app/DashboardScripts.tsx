'use client'

import { useEffect } from 'react'

// 차트·엑셀 라이브러리, 계산, 저장소, 화면 스크립트를 이 순서대로 한 번만 불러온다
const SCRIPTS = [
  '/dashboard/vendor/chart.umd.js',
  '/dashboard/vendor/xlsx.full.min.js',
  '/dashboard/pension-data.js',
  '/dashboard/store.js',
  '/dashboard/app.js',
]

export default function DashboardScripts() {
  useEffect(() => {
    const w = window as unknown as { __dashboardLoaded?: boolean }
    if (w.__dashboardLoaded) return
    w.__dashboardLoaded = true
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' })
      location.reload()
    })
    ;(async () => {
      for (const src of SCRIPTS) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script')
          s.src = src
          s.onload = () => resolve()
          s.onerror = () => reject(new Error(src))
          document.body.appendChild(s)
        })
      }
    })().catch((e) => {
      const main = document.getElementById('main')
      if (main) main.innerHTML = `<div class="msg err">화면 파일을 불러오지 못했습니다: ${String(e.message)}</div>`
    })
  }, [])
  return null
}
