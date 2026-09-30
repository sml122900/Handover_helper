-- 에이전트 D3: 쓰기 도구 3종의 기록 (체크리스트 완료·폐기 대장·점장 알림 로그)
-- 0012와 같은 방식: RLS 켜고 정책 없음 + anon/authenticated 권한 전부 회수 → service_role(에이전트 서버)만 읽고 쓴다
-- 사용자→매장 매핑과 인증이 붙기 전까지 브라우저(anon key)에서 직접 접근할 이유가 없다 (결정 로그 2026-10-01)

-- 체크리스트 완료: 멱등 키 = (store_id, step_id, 근무일, 슬롯). 근무일=KST 날짜(야간 매장 자정 이후는 근무 시작일),
-- 슬롯=같은 step이 한 일정에 둘 이상일 때 가장 가까운 예정 시각(HH:MM), 아니면 ''  (설계 6-3)
create table if not exists public.handover_checklist_logs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  step_id text not null,
  slot text not null default '',
  work_date date not null,
  note text,
  logged_at timestamptz not null default now(),
  unique (store_id, step_id, work_date, slot)
);

-- 폐기 대장: 같은 품목을 여러 번 버릴 수 있으므로 중복 차단 없음 (확인 문구에 오늘 같은 품목 건수 표시)
create table if not exists public.handover_waste_logs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  item text not null,
  qty integer not null check (qty > 0),
  reason text not null default '사유 미기재', -- 질문에 사유가 없으면 추정하지 않고 '사유 미기재'로 저장
  work_date date not null,
  logged_at timestamptz not null default now()
);

-- 점장 알림 로그 (모의 발송: 실제 전송 없음, 기록만)
create table if not exists public.handover_notifications (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  message text not null,
  urgency text not null check (urgency in ('normal', 'urgent')),
  mock boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists handover_checklist_logs_store_date_idx on public.handover_checklist_logs (store_id, work_date);
create index if not exists handover_waste_logs_store_date_idx on public.handover_waste_logs (store_id, work_date);

alter table public.handover_checklist_logs enable row level security;
alter table public.handover_waste_logs enable row level security;
alter table public.handover_notifications enable row level security;
revoke all on public.handover_checklist_logs from anon, authenticated;
revoke all on public.handover_waste_logs from anon, authenticated;
revoke all on public.handover_notifications from anon, authenticated;
