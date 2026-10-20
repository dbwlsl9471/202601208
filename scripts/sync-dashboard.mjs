// claude.ai 대시보드 소스(프로젝트 폴더의 dashboard/, data/)에서 화면·계산 코드와 초기 데이터를 가져온다.
//   npm run sync -- <프로젝트 폴더 경로>   (예: npm run sync -- /mnt/project-files)
// store.js(저장소 연결부)는 Next.js용이 따로 있어 가져오지 않는다.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const src = process.argv[2]
if (!src) {
  console.error('사용법: npm run sync -- <프로젝트 폴더 경로>')
  process.exit(1)
}
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'public', 'dashboard')
mkdirSync(path.join(out, 'vendor'), { recursive: true })

const copies = [
  ['dashboard/app.js', 'app.js'],
  ['data/lib/pension-data.js', 'pension-data.js'],
  ['data/dashboard-data.json', 'dashboard-data.json'],
  ['dashboard/vendor/chart-4.4.1.umd.js', 'vendor/chart.umd.js'],
  ['dashboard/vendor/xlsx-0.18.5.full.min.js', 'vendor/xlsx.full.min.js'],
]
for (const [from, to] of copies) copyFileSync(path.join(src, from), path.join(out, to))

// index.html → 스타일(app/dashboard.css)과 화면 틀(lib/dashboard-markup.ts)
const html = readFileSync(path.join(src, 'dashboard/index.html'), 'utf8')
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1]
writeFileSync(path.join(root, 'app', 'dashboard.css'), '/* 대시보드 화면 스타일 (claude.ai 게시본 index.html과 같음) */' + css)
const body = html.slice(html.indexOf('</style>') + '</style>'.length, html.indexOf('<script')).trim()
writeFileSync(
  path.join(root, 'lib', 'dashboard-markup.ts'),
  '// 대시보드 화면 틀 (claude.ai 게시본 index.html의 body). public/dashboard/app.js가 이 요소들을 채운다.\n' +
    '// scripts/sync-dashboard.mjs가 다시 만든다.\n' +
    'export const DASHBOARD_MARKUP = ' + JSON.stringify(body + '\n') + '\n',
)
console.log('가져왔습니다:', copies.map((c) => c[1]).join(', '), '+ dashboard.css, dashboard-markup.ts')
