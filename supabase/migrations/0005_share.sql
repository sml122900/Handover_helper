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
