import type { Metadata, Viewport } from 'next'
import './globals.css'
import './dashboard.css'

export const metadata: Metadata = {
  title: '퇴직연금 수익률 대시보드',
  description: '통합연금포털 분기 공시 퇴직연금 사업자 수익률 비교',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
