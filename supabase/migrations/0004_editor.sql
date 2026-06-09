-- 세션 1-5: 에디터 + 보강 질문
-- content(jsonb)는 AI 산출 원본 스냅샷으로 보존, 편집본은 content_html에 저장

alter table public.documents
  add column content_html text,
  add column enrich_questions jsonb; -- [{section, question, answered}]
