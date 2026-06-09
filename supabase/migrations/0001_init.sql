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
