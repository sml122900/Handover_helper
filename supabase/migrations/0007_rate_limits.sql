-- Phase 3: AI 호출 사용자별 레이트리밋 (Upstash 없이 Postgres 카운터)
-- 고정 윈도우: (user, action, window_start) 행의 count를 원자적으로 증가
-- 접근: service_role(서버)만 — RLS on + 정책 없음, RPC는 service_role에만 실행 권한

create table if not exists public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, action, window_start)
);

alter table public.rate_limits enable row level security;

create or replace function public.increment_rate_limit(
  p_user uuid,
  p_action text,
  p_window_seconds integer
) returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.rate_limits (user_id, action, window_start, count)
  values (
    p_user,
    p_action,
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds),
    1
  )
  on conflict (user_id, action, window_start)
  do update set count = public.rate_limits.count + 1
  returning count;
$$;

revoke execute on function public.increment_rate_limit(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.increment_rate_limit(uuid, text, integer) to service_role;
