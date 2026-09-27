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
