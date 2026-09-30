-- 에이전트 D1: 검색용 청크 + 임베딩 (pgvector)
-- 쓰기·읽기는 service_role 전용 — RLS 켜고 정책 없음 + anon/authenticated 권한 전부 회수 (0008 방식)
-- embedding 차원 1024 = voyage-4 기본 / bge-m3. 다른 차원 모델로 바꾸면 컬럼·함수를 함께 바꾸고 재색인
create extension if not exists vector with schema extensions;

create table if not exists public.handover_chunks (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  source_type text not null check (source_type in ('document', 'transcript')),
  section text,
  item_id text,
  video_ts_start real,
  video_ts_end real,
  confidence text not null default 'high' check (confidence in ('high', 'needs_review')),
  inferred boolean not null default false,
  source_file text not null,
  char_start integer not null,
  char_end integer not null, -- 원문 위치(UTF-16 코드 단위) — 정답 판정용
  content text not null,
  chunking_strategy text not null,
  embedding_model text not null,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now()
);

create index if not exists handover_chunks_store_strategy_idx
  on public.handover_chunks (store_id, chunking_strategy);

alter table public.handover_chunks enable row level security;
revoke all on public.handover_chunks from anon, authenticated;

-- 코사인 거리 검색 (매장·전략 필터는 null이면 미적용). 수백 청크 규모라 ANN 인덱스 없이 정확 검색
create or replace function public.match_handover_chunks(
  query_embedding extensions.vector(1024),
  match_count int,
  filter_store text default null,
  filter_strategy text default null
)
returns table (id uuid, store_id text, source_type text, source_file text, char_start int, char_end int,
               chunking_strategy text, distance float)
language sql stable
set search_path = public, extensions
as $$
  select c.id, c.store_id, c.source_type, c.source_file, c.char_start, c.char_end, c.chunking_strategy,
         (c.embedding <=> query_embedding)::float as distance
  from public.handover_chunks c
  where (filter_store is null or c.store_id = filter_store)
    and (filter_strategy is null or c.chunking_strategy = filter_strategy)
  order by c.embedding <=> query_embedding
  limit match_count
$$;
revoke all on function public.match_handover_chunks(extensions.vector, int, text, text) from public, anon, authenticated;
