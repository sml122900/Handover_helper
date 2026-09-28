-- Phase 3-A②: 파이프라인 세부 단계 표시용 (상태머신 video_status enum은 그대로)
-- 값 예: audio, stt:2/3, keyframes, structuring, enriching (완료·실패 시 null)
-- 쓰기는 파이프라인(service_role)만 — 0008과 같은 방식으로 사용자 쓰기 권한 없음 (select만)

alter table public.videos add column if not exists stage text;

-- 0008에서 videos 테이블 insert/update를 이미 회수했지만, 이후 테이블 단위 grant가 추가돼도
-- stage가 열리지 않도록 컬럼 단위로 명시 회수
revoke insert (stage), update (stage) on public.videos from anon, authenticated;
