-- 멈춤 감지용: status·stage가 마지막으로 바뀐 시각 (재시도 시 자동 갱신)
-- 쓰기는 트리거·service_role만 — 0009와 같은 방식으로 사용자 쓰기 권한 없음
alter table public.videos add column if not exists status_changed_at timestamptz not null default now();

create or replace function public.set_video_status_changed_at()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status or new.stage is distinct from old.stage then
    new.status_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists videos_status_changed_at on public.videos;
create trigger videos_status_changed_at before update on public.videos
  for each row execute function public.set_video_status_changed_at();

revoke insert (status_changed_at), update (status_changed_at) on public.videos from anon, authenticated;
