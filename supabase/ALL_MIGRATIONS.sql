-- Handover 전체 마이그레이션 (0001~0005 순서대로 합본)
-- Supabase Dashboard > SQL Editor에 통째로 붙여넣고 Run 1회

-- ========== 0001_init.sql ==========
-- Handover 도메인 모델 (CLAUDE.md): Project, Video, Transcript, Document, Keyframe
-- + ai_usage_logs (AI 호출 토큰 사용량 기록 규칙)
-- 적용: Supabase Dashboard > SQL Editor 또는 `supabase db push`

-- ========== 테이블 ==========

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.video_status as enum (
  'uploaded', 'transcribing', 'structuring', 'done', 'failed'
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null,
  duration_seconds integer check (duration_seconds >= 0),
  status public.video_status not null default 'uploaded',
  error_message text,
  created_at timestamptz not null default now()
  -- 영상 30일 자동 삭제(Phase 2)는 created_at 기준
);

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos (id) on delete cascade,
  segments jsonb not null, -- [{start, end, text}] (초 단위, null 허용)
  language text not null default 'ko',
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  content jsonb not null, -- 고정 8섹션 스키마 (lib/ai/schema.ts DocumentSchema)
  prompt_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.keyframes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  timestamp_seconds double precision not null check (timestamp_seconds >= 0),
  image_path text not null,
  created_at timestamptz not null default now()
);

-- AI 호출 토큰 사용량 기록 (비용 추적)
create table public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  kind text not null, -- 'structure' | 'evaluate' | 'enrich' ...
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  created_at timestamptz not null default now()
);

-- ========== 인덱스 ==========

create index videos_project_id_idx on public.videos (project_id);
create index documents_project_id_idx on public.documents (project_id);
create index keyframes_video_id_idx on public.keyframes (video_id);
create index ai_usage_logs_user_id_idx on public.ai_usage_logs (user_id);

-- ========== updated_at 트리거 ==========

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- ========== RLS (소유자만 접근) ==========

alter table public.projects enable row level security;
alter table public.videos enable row level security;
alter table public.transcripts enable row level security;
alter table public.documents enable row level security;
alter table public.keyframes enable row level security;
alter table public.ai_usage_logs enable row level security;

create policy "projects: owner all" on public.projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "videos: via project owner" on public.videos
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

create policy "transcripts: via video->project owner" on public.transcripts
  for all using (
    exists (
      select 1 from public.videos v
      join public.projects p on p.id = v.project_id
      where v.id = video_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.videos v
      join public.projects p on p.id = v.project_id
      where v.id = video_id and p.owner_id = auth.uid()
    )
  );

create policy "documents: via project owner" on public.documents
  for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
  );

create policy "keyframes: via video->project owner" on public.keyframes
  for all using (
    exists (
      select 1 from public.videos v
      join public.projects p on p.id = v.project_id
      where v.id = video_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.videos v
      join public.projects p on p.id = v.project_id
      where v.id = video_id and p.owner_id = auth.uid()
    )
  );

-- 사용량 로그: 본인 것 조회만 (기록은 service_role이 수행)
create policy "ai_usage_logs: owner read" on public.ai_usage_logs
  for select using (user_id = auth.uid());


-- ========== 0002_storage.sql ==========
-- 영상 업로드용 private 버킷
-- 업로드는 서버가 발급한 signed upload URL, 다운로드는 service_role(파이프라인)만.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  false,
  2147483648, -- 2GB
  array['video/mp4', 'video/webm', 'audio/mp4', 'audio/x-m4a', 'text/plain', 'application/octet-stream']
)
on conflict (id) do nothing;

-- signed upload URL 사용 시에도 storage RLS가 적용되므로,
-- 본인 폴더({user_id}/...)에만 업로드 허용 정책을 추가한다.
create policy "videos bucket: 본인 폴더 업로드"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "videos bucket: 본인 폴더 조회"
on storage.objects for select to authenticated
using (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ========== 0003_keyframes_storage.sql ==========
-- 키프레임 이미지용 private 버킷 (업로드/삭제는 service_role 파이프라인만)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('keyframes', 'keyframes', false, 10485760, array['image/jpeg']) -- 10MB
on conflict (id) do nothing;

-- 본인 폴더({user_id}/...) 이미지 조회 허용 (에디터에서 signed URL 발급용)
create policy "keyframes bucket: 본인 폴더 조회"
on storage.objects for select to authenticated
using (
  bucket_id = 'keyframes'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ========== 0004_editor.sql ==========
-- 세션 1-5: 에디터 + 보강 질문
-- content(jsonb)는 AI 산출 원본 스냅샷으로 보존, 편집본은 content_html에 저장

alter table public.documents
  add column content_html text,
  add column enrich_questions jsonb; -- [{section, question, answered}]


-- ========== 0005_share.sql ==========
-- 세션 1-6: 공유 링크 (추측 불가능 토큰 + 만료일)

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  token text not null unique, -- 32바이트 랜덤 base64url (서버 생성)
  expires_at timestamptz, -- null = 무기한
  created_at timestamptz not null default now()
);

create index share_links_document_id_idx on public.share_links (document_id);

alter table public.share_links enable row level security;

-- 문서 소유자만 생성·조회·삭제. 공개 열람은 service_role(서버)이 토큰으로 조회.
create policy "share_links: via document->project owner" on public.share_links
  for all using (
    exists (
      select 1 from public.documents d
      join public.projects p on p.id = d.project_id
      where d.id = document_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.documents d
      join public.projects p on p.id = d.project_id
      where d.id = document_id and p.owner_id = auth.uid()
    )
  );


-- ========== 0006_payments.sql ==========

-- Phase 2-1 결제: payments 테이블 + projects.plan 컬럼

ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'paid'));

CREATE TABLE IF NOT EXISTS payments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       TEXT        NOT NULL UNIQUE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id     UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount         INTEGER     NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'failed')),
  payment_key    TEXT,
  toss_response  JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payments_user_id_idx    ON payments(user_id);
CREATE INDEX IF NOT EXISTS payments_project_id_idx ON payments(project_id);
CREATE INDEX IF NOT EXISTS payments_order_id_idx   ON payments(order_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select_own" ON payments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ========== 0007_rate_limits.sql ==========

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

-- ========== 0008_rls_hardening.sql ==========

-- Phase 3 보안 감사: 행 단위 RLS는 "본인 것"만 보장하지 컬럼은 막지 않는다.
-- anon key + 사용자 JWT로 PostgREST를 직접 호출하면 앱 UI를 거치지 않고 쓰기가 가능하므로
-- 서버(service_role)만 써야 하는 컬럼·테이블의 쓰기 권한을 회수한다.

-- projects.plan: 사용자가 직접 'paid'로 바꾸면 결제 우회 → 제목만 쓰기 허용
revoke insert, update on public.projects from anon, authenticated;
grant insert (owner_id, title) on public.projects to authenticated;
grant update (title) on public.projects to authenticated;

-- videos: storage_path를 남의 파일로 바꾸면 파이프라인(service_role)이 타인 영상을 처리 → 교차 유출
-- status·duration_seconds 조작 → 비용 가드 우회. 생성·재시도는 서버 액션이 service_role로 수행
revoke insert, update on public.videos from anon, authenticated;

-- transcripts·keyframes: 파이프라인 전용. keyframes.image_path 조작 → 타인 이미지 서명 URL 발급 위험
revoke insert, update on public.transcripts from anon, authenticated;
revoke insert, update on public.keyframes from anon, authenticated;

-- documents: 생성은 파이프라인 전용, 사용자는 편집 컬럼만
revoke insert, update on public.documents from anon, authenticated;
grant update (content, content_html, enrich_questions) on public.documents to authenticated;

-- ========== 0009_video_stage.sql ==========

-- Phase 3-A②: 파이프라인 세부 단계 표시용 (상태머신 video_status enum은 그대로)
-- 값 예: audio, stt:2/3, keyframes, structuring, enriching (완료·실패 시 null)
-- 쓰기는 파이프라인(service_role)만 — 0008과 같은 방식으로 사용자 쓰기 권한 없음 (select만)

alter table public.videos add column if not exists stage text;

-- 0008에서 videos 테이블 insert/update를 이미 회수했지만, 이후 테이블 단위 grant가 추가돼도
-- stage가 열리지 않도록 컬럼 단위로 명시 회수
revoke insert (stage), update (stage) on public.videos from anon, authenticated;
