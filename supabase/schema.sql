-- Supabase SQL Editor에서 한 번 실행한다.
-- 대시보드 문서 전체를 'main' 행 하나에 저장한다. 서버(service role 키)만 읽고 쓴다.
create table if not exists public.dashboard_state (
  id text primary key,
  doc jsonb not null,
  ver integer not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- 브라우저용 공개 키(anon/publishable)로는 접근할 수 없게 막는다(정책 없음 = 모두 거부)
alter table public.dashboard_state enable row level security;
