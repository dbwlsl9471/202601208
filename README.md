# 퇴직연금 수익률 대시보드 (Next.js)

통합연금포털(금감원) 분기 공시 퇴직연금 사업자 수익률을 비교하는 웹 서비스입니다.
화면과 계산은 claude.ai 대시보드와 같은 코드를 쓰고, 이 앱은 그 위에 **데이터 저장소**와 **관리자 로그인**을 더합니다.

- 누구나 로그인 없이 대시보드를 봅니다.
- 관리자 한 명만 로그인해서 분기 엑셀을 올리거나 지울 수 있습니다. 저장한 데이터는 모든 사람에게 보입니다.
- 아이디·비밀번호는 코드나 저장소에 들어가지 않습니다. 배포 서비스의 환경 변수에만 넣고, 비밀번호도 해시값만 넣습니다.

## 구성

| 경로 | 내용 |
|---|---|
| `app/page.tsx` | 대시보드 화면. 머리글에 관리자 로그인·로그아웃 버튼을 붙임 |
| `app/login/` | 관리자 로그인 화면(Tailwind) |
| `app/api/data` | `GET` 누구나 읽기, `PUT` 관리자만 저장(버전이 다르면 409로 거절) |
| `app/api/login`, `logout`, `session` | 로그인(서명된 httpOnly 쿠키, 12시간), 로그아웃, 현재 권한 |
| `lib/auth.ts` | 비밀번호 확인(scrypt), 쿠키 서명, 같은 사이트 요청 확인, 로그인 시도 제한(10분에 5번) |
| `lib/storage.ts` | 저장소: Supabase / 개발용 파일(`.data/`) / 없음(보기 전용) |
| `public/dashboard/` | 화면·계산 스크립트(`app.js`, `pension-data.js`), 초기 데이터, Chart.js·SheetJS. `store.js`만 이 앱 전용 |
| `supabase/schema.sql` | 저장 표 만들기 |

## 처음 배포하기 (Supabase + Vercel, 무료 요금제로 충분)

1. **관리자 계정 만들기** (내 컴퓨터에서)
   ```bash
   npm install
   npm run hash-password      # 비밀번호를 입력하면 ADMIN_PASSWORD_HASH=... 한 줄이 나옵니다
   openssl rand -base64 48    # SESSION_SECRET으로 쓸 임의 문자열
   ```
2. **Supabase**: supabase.com에서 새 프로젝트를 만들고, SQL Editor에서 `supabase/schema.sql`을 실행합니다.
   Project Settings → API에서 **Project URL**과 **service_role(또는 secret) 키**를 복사합니다. 이 키는 서버 전용이라 브라우저에 나가지 않습니다.
3. **Vercel**: vercel.com에서 이 GitHub 저장소를 Import하고, Environment Variables에 아래 값을 넣은 뒤 Deploy합니다.

   | 이름 | 값 |
   |---|---|
   | `ADMIN_ID` | 관리자 아이디 |
   | `ADMIN_PASSWORD_HASH` | 1번에서 나온 값 |
   | `ADMIN_NAME` | 저장 기록에 남길 이름(예: 임유진) |
   | `SESSION_SECRET` | 1번의 임의 문자열 |
   | `SUPABASE_URL` | 2번의 Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | 2번의 키 |

4. 배포 주소에서 **관리자 로그인** → 데이터 관리 탭에서 포털 원본을 올립니다. 첫 저장 전까지는 `public/dashboard/dashboard-data.json`(초기 데이터)을 보여 줍니다.

비밀번호를 바꾸려면 1번을 다시 해서 `ADMIN_PASSWORD_HASH`만 바꾸고 다시 배포합니다. `SESSION_SECRET`을 바꾸면 로그인된 화면이 모두 로그아웃됩니다.
Supabase 설정이 없으면 배포본은 초기 데이터만 보여 주는 보기 전용이 됩니다.

## 내 컴퓨터에서 실행

```bash
cp .env.example .env.local   # ADMIN_ID, ADMIN_PASSWORD_HASH, SESSION_SECRET만 채워도 됩니다
npm run dev                  # http://localhost:3000
```
Supabase 값이 없으면 개발 중에는 `.data/dashboard.json`에 저장합니다.

## claude.ai 대시보드 화면이 바뀌었을 때

화면·계산 코드는 claude.ai 대시보드 프로젝트 폴더에서 가져옵니다.
```bash
npm run sync -- <프로젝트 폴더 경로>   # dashboard/app.js, index.html, data/lib/pension-data.js 등을 다시 가져옴
```

## 알아 둘 점

- 당사·경쟁사 선택은 사람별로 각자 브라우저에 저장됩니다(보는 사람은 로그인하지 않으므로).
- 로그인 시도 제한은 서버 인스턴스마다 따로 셉니다. 비밀번호는 12자 이상으로 정해 주세요.
- 회사 밖 서비스(Vercel·Supabase)에 올리는 것이므로 사내 보안 규정을 먼저 확인해 주세요. 데이터 자체는 통합연금포털 공시값입니다.
