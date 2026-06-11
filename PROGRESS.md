# PROGRESS.md — 자율 빌드 진행 기록

> Claude Code 자율 세션 기록. 각 세션: 완료한 것 / 실행 방법 / 사용자가 할 일 / 판단과 이유.

---

## 세션 0-1: 변환 CLI ✅ (2026-06-10)

### 완료한 것
- `scripts/convert.ts` — 트랜스크립트 `.txt`/`.md` 직접 입력 또는 영상/오디오(STT mock) → Claude 구조화 → `output/{이름}.json` + `.md`
- `lib/ai/schema.ts` — 8개 섹션 고정 스키마 zod 정의 (sourceTimestamp + confidence 포함)
- `lib/ai/prompts/structure-v1.ts` — 환각 금지·마스킹·타임스탬프 규칙 명시 프롬프트 (버전 관리)
- `lib/ai/structure.ts` — Claude structured outputs(`messages.parse` + `zodOutputFormat`) + zod 검증 + 1회 재시도 + 비용 가드(트랜스크립트 12만 자 상한)
- `lib/stt/` — STT 인터페이스 분리 (`types.ts`), Whisper mock (`whisper.ts`), `[mm:ss]` 형식 txt 파서 (`parse-txt.ts`)
- `samples/sample-handover.txt` — 검증용 샘플 (비밀번호 노출·불확실 정보 포함 시나리오)
- 실제 API 테스트 1회 통과: 토큰 in=4922 / out=1839, 비밀번호 마스킹 ✓, 8섹션 전부 정상

### 실행 방법
```
npm install
npm run convert -- samples/sample-handover.txt
# 결과: output/sample-handover.json, output/sample-handover.md
```

### 사용자가 할 일 (TODO)
- [ ] **OPENAI_API_KEY 발급 후 `.env`에 추가** → `lib/stt/whisper.ts` 실제 연동 요청 (현재 mock, .txt 입력은 동작)
- [ ] 실제 인수인계 영상/트랜스크립트 10개 수집 (Phase 0 본체 = 프롬프트 개선 반복)

### 스스로 내린 판단과 이유
1. **모델: `claude-sonnet-4-20250514` → `claude-sonnet-4-6`**
   CLAUDE.md 명시 모델이 **2026-06-15 retire 예정**(5일 후). 제품이 곧 죽는 모델에 의존할 수 없어 후속 alias로 교체. `HANDOVER_MODEL` 환경변수로 되돌릴 수 있음. ⚠️ 기술 스택 변경이므로 사용자 확인 필요.
2. **JSON 출력: 프롬프트 유도 대신 structured outputs(`output_config.format`) 사용**
   스키마 준수가 API 레벨에서 보장돼 파싱 실패율이 거의 0. zod 검증은 이중 안전망으로 유지.
3. **토큰 사용량 기록: DB 대신 콘솔 + output JSON `meta`**
   Phase 0엔 DB가 없음. Phase 1에서 DB 기록으로 이전.
4. **비용 가드: 영상 길이 대신 트랜스크립트 길이(12만 자)로 검사**
   .txt 입력 모드에선 영상 길이가 없음. 영상 길이 검사는 STT 연동 시 추가.
5. `process.exit()` → `process.exitCode` (Windows tsx libuv assertion 회피)

---

## 세션 0-2: 채점 스크립트 ✅ (2026-06-10)

### 완료한 것
- `scripts/evaluate.ts` — Claude 심판 채점: 누락률·환각 목록·섹션별 점수·총평 → `results/{name}-eval.md` + `.json`. `--all` 배치 지원 (golden/ 스캔, 10개+ 가능)
- `lib/ai/eval-schema.ts` — 채점 결과 zod 스키마 (goldenKeyItemCount 기반 누락률 계산)
- `lib/ai/prompts/evaluate-v1.ts` — 채점 기준 프롬프트 (환각 정의: "새로운 사실의 창작"만, 마스킹·문어체 정리는 제외)
- `golden/sample-handover.md` — 샘플 정답 문서 (검증용으로 직접 작성 — 실 데이터로 교체 권장)
- 실제 채점 1회: **누락률 11.1% (2/18), 환각 0건**. 누락 2건 중 1건은 심판이 "실질 반영됨"이라 자평 — 실질 누락 1건(구독자 1.2만 명 수치)

### 실행 방법
```
npm run convert -- samples/{name}.txt     # 먼저 AI 문서 생성
npm run evaluate -- {name}                # 채점 (golden/{name}.md 필요)
npm run evaluate -- --all                 # golden/ 전체 배치
```

### 사용자가 할 일 (TODO)
- [ ] 실제 인수인계 트랜스크립트 10개 + 각각의 정답 문서(golden/*.md) 작성 → `--all` 배치 → 누락률 <10% / 환각 0 나올 때까지 structure-v1→v2→v3 프롬프트 개선. **이 반복이 Phase 0의 본체** (자동화 불가 — 실 데이터 필요)

### 스스로 내린 판단과 이유
1. **누락률 분모 = 심판이 센 정답 핵심 정보 개수(goldenKeyItemCount)** — 정답 문서 형식이 자유로워 기계적 카운트 불가. 심판 LLM이 식별·카운트하도록 스키마에 강제.
2. **트랜스크립트가 있으면 채점 입력에 포함** — 환각 판정을 정답 문서만으로 하면 오탐 발생 (정답에 없지만 트랜스크립트에 있는 내용). samples/{name}.txt 자동 탐색.
3. 심판 모델도 `claude-sonnet-4-6` (`HANDOVER_EVAL_MODEL`로 override 가능). 테스트 호출 누적 2/5회.

---

## 세션 1-1: Next.js + Supabase 셋업 ✅ (2026-06-10)

### 완료한 것
- Next.js 16 (App Router) + TypeScript strict + Tailwind v4 — 기존 CLI 워크스페이스에 수동 스캐폴딩 (`npm run build` 통과, CLI 회귀 0)
- 다크모드 기본 레이아웃: `/` 랜딩 → `/login` (이메일+비밀번호 로그인/가입, server actions) → `/projects` 목록·생성 → `/projects/[id]` 상세 (영상 상태 뱃지·문서 목록 — 업로드는 세션 1-2)
- `lib/supabase/{server,client}.ts` + `middleware.ts` — @supabase/ssr 세션 갱신 + `/projects` 라우트 보호
- `supabase/migrations/0001_init.sql` — 도메인 모델 5종(projects/videos/transcripts/documents/keyframes) + `ai_usage_logs`(토큰 기록 규칙) + video_status enum 상태머신 + 소유자 RLS 전부 + updated_at 트리거
- Supabase 미설정 시: 빌드·실행 안전 (로그인 페이지에 셋업 안내 표시, middleware 통과)

### 실행 방법
```
npm run dev    # http://localhost:3010 (Supabase 키 없으면 /login에 셋업 안내)
npm run build  # 프로덕션 빌드 검증
```

### 사용자가 할 일 (TODO)
- [ ] **새 Supabase 프로젝트 생성** (⚠️ 현재 `.env`의 SUPABASE_* 키는 다른 프로젝트(Lifebook) 것 — 절대 재사용 금지, 그 DB를 오염시킴)
- [ ] `supabase/migrations/0001_init.sql`을 Supabase SQL Editor에서 실행
- [ ] `.env`에 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 입력
- [ ] Supabase Auth > Email 설정 확인 (기본: 이메일 인증 ON — 로컬 테스트 시 OFF 가능)

### 스스로 내린 판단과 이유
1. **`.env`의 기존 Supabase 키 미사용** — Lifebook 프로젝트의 운영 DB를 가리킴. 마이그레이션을 거기 적용하면 다른 제품 오염. 새 프로젝트 placeholder로 처리하고 빌드는 키 없이도 통과하도록 가드.
2. **이메일 로그인 = 비밀번호 방식** — magic link는 SMTP 설정 필요(외부 결정). 비밀번호 방식은 Supabase 기본으로 즉시 동작.
3. **`create-next-app` 대신 수동 스캐폴딩** — 기존 파일(package.json, CLAUDE.md, scripts/)과 충돌. 디렉터리 병합이 더 안전.
4. **`ai_usage_logs` 테이블을 1-1에서 선반영** — CLAUDE.md "모든 AI 호출 토큰 DB 기록" 규칙. 스키마 변경 비용이 크므로 초기 마이그레이션에 포함.
5. npm audit: next 내부 postcss 모더레이트 1건 — next 패치 대기, 동작 영향 없음.

---

## 세션 1-2: 업로드 + 비동기 변환 파이프라인 ✅ (2026-06-10)

### 완료한 것
- `lib/plan.ts` — 비용 가드 순수 로직 (Free 총 20분 / Paid 120분, 영상 1개 한도·NaN 방어) + **vitest 7개 테스트 통과** (`npm test`)
- `app/projects/[id]/upload-actions.ts` — ① `prepareUpload`: 인증→소유권→**STT/LLM 호출 전 비용 가드**→video 행 생성→signed upload URL ② `completeUpload`: `after()`로 백그라운드 파이프라인 시작 ③ `getVideoStatuses`: 폴링용
- `VideoUploader.tsx` — 파일 선택→영상 길이 메타데이터 추출→XHR 업로드 **진행률 표시**→완료 시 파이프라인 트리거. mp4/webm/m4a + **txt 트랜스크립트 직접 업로드 지원**
- `lib/pipeline/process-video.ts` — 상태머신 uploaded→transcribing→structuring→done/failed. txt면 STT 생략, Phase 0 구조화 프롬프트 재사용, documents 저장 + **ai_usage_logs 토큰 기록**, 실패 시 error_message 저장
- `VideoStatusPoller.tsx` — 처리 중 영상 있으면 3초 폴링→화면 갱신
- `supabase/migrations/0002_storage.sql` — private `videos` 버킷 (2GB 한도, MIME 화이트리스트) + 본인 폴더 RLS
- 빌드·테스트·CLI 회귀 전부 통과 (Supabase 키 없어 E2E는 미실행)

### 실행 방법
```
npm test            # 비용 가드 단위 테스트
npm run dev         # Supabase 셋업 후: 프로젝트 상세 → 업로드 → 자동 변환 → 문서 생성
```

### 사용자가 할 일 (TODO)
- [ ] 0002_storage.sql도 Supabase SQL Editor에서 실행 (0001 다음에)
- [ ] Supabase 셋업 후 E2E 확인: txt 업로드 → done 상태 → documents 행 생성
- [ ] 영상(mp4) 업로드는 STT 연동 전까지 `failed`로 떨어짐 (의도된 동작 — OPENAI_API_KEY 후 연동)
- [ ] **실영상 STT 도입 시 Vercel 함수 타임아웃 리스크 → Inngest 전환 필요** (after() 큐는 사용자 승인 — 단 영상 STT는 수 분 소요라 서버리스 타임아웃에 걸림. STT 켜고 첫 실영상 테스트 전에 전환 판단)

### 스스로 내린 판단과 이유
1. **작업 큐 = Next `after()` 훅 (응답 후 실행)** — Inngest는 외부 가입 필요(외부 결정 금지 항목). 로컬·소규모엔 충분. Vercel 함수 타임아웃 한계는 코드 주석 + TODO로 명시 (스케일 시 Inngest/Supabase Edge Functions 이전).
2. **웹 업로드도 .txt 트랜스크립트 허용** — STT mock 상태에서도 E2E 파이프라인이 완전 동작하도록. Phase 0 CLI와 동일한 판단.
3. **진행률 = signed upload URL + XHR PUT** — supabase-js `upload()`은 진행률 콜백 미지원. 서명 URL 방식이면 XHR로 진행률 표시 가능 + 클라이언트에 service key 노출 0.
4. **mock STT로 가짜 트랜스크립트를 만들지 않음** — 환각 금지 원칙. 영상 업로드는 STT 연동 전까지 명시적 failed("STT 미연동" 안내)가 올바른 동작.
5. 상대 import의 `.js` 확장자 전부 제거 — Next 번들러가 `.js`→`.ts` 매핑을 못 함. tsx/vitest는 확장자 없이도 동작 확인.

---

## 세션 1-3: 브라우저 화면 녹화 ✅ (2026-06-10)

### 완료한 것
- `ScreenRecorder.tsx` — MediaRecorder로 화면(getDisplayMedia) + 마이크(getUserMedia) 동시 캡처, 일시정지/재개, 경과 시간 표시(일시정지 중 멈춤), 종료 시 기존 업로드 파이프라인으로 바로 전달
- 한국어 안내: 미지원 브라우저 / 화면 공유 거부 / 마이크 거부 각각 구분된 메시지. 브라우저 자체 "공유 중지" 버튼 처리(`track.onended`)
- `lib/upload-client.ts` — VideoUploader와 업로드 헬퍼 공유 (probeDuration/uploadWithProgress 추출)
- 빌드 통과. 실 녹화 테스트는 Supabase 셋업 후 가능

### 사용자가 할 일 (TODO)
- [ ] Supabase 셋업 후 Chrome/Edge에서 실 녹화 → 업로드 → (STT 연동 전이라 failed) 확인

### 스스로 내린 판단과 이유
1. **시스템 오디오 미캡처 (마이크만)** — 화면 오디오 + 마이크 믹싱은 AudioContext 필요(복잡도↑). 인수인계 내레이션은 마이크가 본질. 후속 TODO 주석.
2. **녹화 길이 = 측정한 경과 시간** — MediaRecorder webm은 duration 메타데이터가 없는 경우 많음. 타이머 측정값을 prepareUpload에 전달 (비용 가드 정확성 유지).
3. mimeType: vp9+opus 지원 시 사용, 아니면 기본 webm 폴백.

---

## 세션 1-4: 키프레임 추출 ✅ (2026-06-10)

### 완료한 것
- `lib/keyframes/extract.ts` — ffmpeg 장면 전환 감지(`select=gt(scene,0.3)` + showinfo pts_time 파싱) → jpg + 타임스탬프. 최대 30장, 임시폴더 정리 보장. **합성 영상(빨강→파랑→초록 3초씩)으로 로컬 검증: t=3, t=6 정확히 감지**
- `lib/keyframes/match.ts` — 절차 단계 sourceTimestamp ↔ 가장 가까운 키프레임 매칭 (±90초 윈도우, 순수 함수) + **vitest 6개 테스트** (총 13개 통과)
- 파이프라인 통합 — 문서 저장 후 영상 파일이면 키프레임 추출→`keyframes` 버킷 업로드→DB 행→문서 content의 `procedures[].keyframeId` 갱신. **실패해도 문서는 유지** (비파괴)
- `supabase/migrations/0003_keyframes_storage.sql` — private keyframes 버킷 + 본인 폴더 조회 RLS
- 후보 목록(에디터에서 교체용)은 keyframes 테이블 전체가 후보 — 세션 1-5에서 UI 연결

### 사용자가 할 일 (TODO)
- [ ] 0003 마이그레이션도 SQL Editor에서 실행
- [ ] (참고) 실제 영상 E2E는 STT 연동 후에만 — 현재 영상 업로드는 STT 단계에서 failed

### 스스로 내린 판단과 이유
1. **ffmpeg = `ffmpeg-static` npm 의존성** — 시스템에 ffmpeg 없음, 전역 설치 금지 규칙 → 로컬 패키지로 해결. Vercel 서버리스 용량 한계는 TODO 주석 (스케일 시 작업 큐 이전과 함께).
2. **키프레임 매칭 결과는 문서 content(jsonb)에 `keyframeId`로 기록** — 스키마 마이그레이션 0건. zod 구조화 스키마(LLM 출력)에는 안 넣음 (LLM이 만들 값이 아님 — 환각 방지).
3. **키프레임 실패는 non-fatal** — 문서가 본질, 이미지는 보조. try/catch로 격리.

---

## 세션 1-5: 문서 에디터 + 보강 질문 ✅ (2026-06-10)

### 완료한 것
- `/documents/[id]` — Tiptap(StarterKit+Highlight) 에디터. 8섹션 HTML 구조 유지 자유 편집, **needs_review 항목 노란 하이라이트**(`<mark>`), **2초 디바운스 자동 저장** + 저장 상태 표시
- `lib/doc-html.ts` — AI 산출 JSON → 8섹션 에디터 HTML 변환 (XSS escape 포함)
- **보강 질문 파이프라인**: 변환 직후 빈/불확실 섹션 대상 3~5개 질문 자동 생성(`lib/ai/enrich.ts` + `enrich-v1` 프롬프트) → `documents.enrich_questions`(jsonb) 저장 + 토큰 기록
- **보강 패널**: 질문에 답하면 AI가 문어체로 다듬어(내용 추가 금지 가드) 해당 섹션 끝에 "(보강 답변)" 항목으로 삽입 → 자동 저장. 답한 질문 ✓ 처리
- `supabase/migrations/0004_editor.sql` — `content_html`, `enrich_questions` 컬럼
- middleware에 `/documents` 라우트 보호 추가 (누락 발견·픽스)
- **실 API 테스트 1회 (3/5)**: 샘플 문서로 질문 5개 생성 — 품질 우수 (노션 링크·선택 기준·월간 리포트 소재 등 실무 빈틈을 정확히 짚음). 토큰 in=2498/out=559

### 사용자가 할 일 (TODO)
- [ ] 0004 마이그레이션 실행
- [ ] Supabase 셋업 후: txt 업로드 → 문서 클릭 → 에디터·하이라이트·보강 질문 E2E 확인

### 스스로 내린 판단과 이유
1. **편집본 = `content_html`(text), AI 원본 = `content`(jsonb) 분리 보존** — HTML→8섹션 JSON 역변환은 손실·복잡(과잉 설계). 원본 스냅샷은 채점·재생성용으로 유지, PDF(1-6)는 HTML 사용.
2. **보강 답변 반영 = "해당 섹션 끝에 추가"** — AI가 문서 본문을 직접 재작성하게 하면 사용자 편집을 덮어쓸 위험. 추가 전용 + "(보강 답변)" 표식이 안전.
3. **reflectAnswer 프롬프트에 환각 가드** — "답변에 없는 내용 추가 금지, 다듬기만". 비밀번호 마스킹도 적용.
4. 에디터↔패널 연결 = CustomEvent — 상태 끌어올리기 없이 형제 컴포넌트 통신 최소 구현.

---

## 세션 1-6: 공유 링크 + PDF ✅ (2026-06-10) — **Phase 1 완료**

### 완료한 것
- `supabase/migrations/0005_share.sql` — `share_links` 테이블 (32바이트 base64url 토큰 unique + `expires_at`) + 소유자 RLS
- `ShareControls` (문서 페이지 사이드) — 만료 7/30/90일/없음 선택, 링크 생성·복사·삭제(revoke)
- `/share/[token]` — 로그인 없는 읽기 전용 공개 뷰. 만료 검사, **sanitize-html로 XSS 방지** (작성자 편집 HTML을 제3자에게 노출하므로), 하단 가입 유도 배너(바이럴 루프)
- PDF = "PDF로 저장/인쇄" 버튼 + print CSS (다크→화이트 전환, OS 한글 폰트)
- 빌드 통과. `/share`는 middleware 보호 대상 아님(의도된 공개)

### 사용자가 할 일 (TODO)
- [ ] 0005 마이그레이션 실행
- [ ] E2E: 문서 → 링크 생성 → 시크릿 창에서 열람 → 만료 동작 확인

### 스스로 내린 판단과 이유
1. **PDF = 브라우저 인쇄(print CSS)** — 서버 사이드 PDF는 한글 폰트 임베드 + 렌더러(puppeteer 등) 무게가 MVP 과잉. OS 폰트로 한글 출력 충분. 키프레임 이미지 포함은 STT 연동(실영상) 후에만 의미 있어 함께 TODO.
2. **공개 뷰에서 sanitize-html** — content_html은 작성자가 편집한 HTML. 공유 페이지 열람자 보호를 위해 태그 화이트리스트 적용.
3. 공개 조회는 service_role + 토큰 매칭 (anon RLS 정책을 여는 것보다 좁은 표면).

---

## 세션 1-7: 골든셋 반복 도구 — Whisper 실연동 + 프롬프트 비교 + 누락 리포트 ✅ (2026-06-11)

> 사용자 지시: 결정 3건 반영 + 골든셋 반복 환경 구축. Phase 2 진입 금지.

### 완료한 것
- **결정 3건 반영**: ① CLAUDE.md 모델 표기 `claude-sonnet-4-6`으로 수정 ② Inngest 전환 리스크 TODO 명시 (세션 1-2 TODO + 아래 후속) ③ print CSS PDF 유지
- **Whisper STT 실연동** (`lib/stt/whisper.ts`) — fetch+FormData로 OpenAI `audio/transcriptions` 호출 (SDK 의존성 0). verbose_json + 세그먼트 타임스탬프, language=ko. 25MB 상한 가드(호출 전), 키 없음/HTTP 실패 시 한국어 안내
- **env 전환** (`lib/stt/index.ts` `getSttProvider`) — `HANDOVER_STT=whisper|mock` 강제, 미설정이면 OPENAI_API_KEY 유무로 자동. mock은 가짜 트랜스크립트 대신 명시적 에러 (환각 금지). CLI·웹 파이프라인 양쪽 적용
- **프롬프트 버전 레지스트리** (`lib/ai/prompts/index.ts`) — `structureTranscript(text, {promptVersion})`. 새 버전 = structure-v2.ts 작성 후 레지스트리 등록
- **`npm run compare -- structure-v1 structure-v2`** (`scripts/compare-prompts.ts`) — golden/ 전체 샘플 × 버전별 변환+채점 → 누락률·환각 비교표 + 버전별 섹션 누락 집계 → `results/compare-*.md`. **캐시 내장** (같은 샘플×버전 재호출 0회, `--force`로 무시) — 반복 비용 최소화
- **`npm run report`** (`scripts/report-misses.ts`) — results/*-eval.json 전체에서 누락 항목을 섹션별 집계 (어느 섹션이 반복 누락인지) → `results/miss-report.md`. API 호출 0회
- vitest 16개 추가 (STT 매핑·가드·env 전환 10 + 비교 리포트 6) → **총 29개 통과**. typecheck·next build 통과
- 실 API 검증 2회: compare 파이프라인 E2E (변환+채점, 이번 채점 누락 0/18·환각 0) + 캐시 재실행 0회 확인

### 실행 방법
```
npm run compare -- structure-v1                    # 버전 1개 = 기준선 배치
npm run compare -- structure-v1 structure-v2       # 버전 비교 (캐시 자동)
npm run report                                     # 섹션별 누락 집계 (호출 0회)
npm run convert -- samples/x.txt --prompt structure-v2
npm run convert -- recording.m4a                   # OPENAI_API_KEY 있으면 실제 Whisper
```

### 사용자가 할 일 (TODO)
- [ ] **⚠️ OPENAI_API_KEY가 .env에 없음** — "넣었다"고 하셨지만 `.env`(수정일 6/9)에 해당 키가 없습니다. 추가하면 Whisper가 자동 활성화 (코드 변경 불필요). 추가 후 짧은 음성 파일로 `npm run convert -- test.m4a` 검증
- [ ] **새 Supabase 키도 .env에 없음** (NEXT_PUBLIC_SUPABASE_*) → txt 업로드 E2E 미실행 (아래 판단 4)
- [ ] 25MB 초과 영상은 현재 거부됨 — 실영상 테스트에서 걸리면 ffmpeg 오디오 추출 단계 추가 요청

### 스스로 내린 판단과 이유
1. **Whisper를 OpenAI SDK 없이 fetch로 호출** — 엔드포인트 1개에 SDK 의존성 추가는 과잉. Node 24 내장 fetch/FormData로 충분.
2. **STT 입력을 파일 경로 → 바이트(Uint8Array)로 변경** — 웹 파이프라인은 Supabase Storage 다운로드(Buffer)라 로컬 경로가 없음. 인터페이스를 바이트로 통일해 CLI/웹 공용.
3. **compare에 캐시 내장** — 골든셋 10개 × 버전 2개 = 호출 40회. 프롬프트 반복 시 변경된 버전만 재호출되도록 샘플×버전 단위 캐시 (`output/compare/`, `results/compare/`). "빠르게 돌릴 수 있는 환경" 요구의 핵심.
4. **txt 업로드 E2E 미실행 (차단)** — 새 Supabase 키가 .env에 없고, 기존 SUPABASE_*는 Lifebook 운영 DB라 사용 금지. 키 입력 즉시 실행 가능: 가입 → 프로젝트 → samples/sample-handover.txt 업로드 → done 확인.
5. **채점 분산 관찰** — 같은 샘플·프롬프트인데 어제 누락률 11.1%, 오늘 0%. 심판 LLM의 핵심 정보 카운트가 비결정적. 골든셋 10개로 늘리면 평균이 안정되지만, 버전 비교 시 **같은 날 같은 캐시 기준으로 비교**할 것 (compare가 이를 보장).

---

## 세션 1-8: 체크리스트 기반 채점 (비결정성 해결) + Supabase 키 검증 ✅ (2026-06-11)

> 사용자 지시: Supabase 키 확인→마이그레이션→E2E, 채점을 체크리스트 기반으로 재설계 (호출 12회 이내)

### 완료한 것
- **`.env` Supabase 키 형식 정정** — URL에 따옴표+`/rest/v1/` 접미사가 붙어 있어 supabase-js가 깨지는 상태 → 베이스 URL로 정정. 서비스 키 유효 확인(auth admin 200)
- **`supabase/ALL_MIGRATIONS.sql`** — 0001~0005 합본 (SQL Editor에 1회 붙여넣기용)
- **`npm run e2e`** (`scripts/e2e-pipeline.ts`) — txt 업로드 E2E 자동화: 테스트 유저→프로젝트→Storage 업로드→video 행→processVideo 직접 호출→done/transcripts/documents/로그 검증. 스키마 없으면 안내 후 종료 (react-server 조건으로 server-only 우회 실행)
- **체크리스트 채점 v2** — 비결정성 해결 (전 버전: 심판이 분모를 매번 다르게 셈 → 11.1% vs 0% 널뜀)
  - `npm run checklist -- {name}` : 정답 문서 → 원자적 사실 27개(critical 17) JSON, `golden/{name}-checklist.json` 캐시 (1회 호출)
  - 심판(judge-v1, temperature 0)은 **항목별 yes/no + 근거 인용만**: ① 체크리스트 사실이 AI 문서(주장 목록)에 존재? ② AI 문서 주장 각각 근거 있음? — 누락률·환각 집계는 코드(`lib/ai/eval-core.ts`)가 결정적으로 계산. 판정 누락 시 throw
  - `evaluate --repeat 3` 재현성 플래그, compare·report 새 포맷 적용 (구 캐시는 자동 무효화)
- **재현성 검증: 3회 연속 누락 항목까지 완전 동일** (7.4%, 2/27, 환각 0 × 3회)
- **판별력 검증(네거티브 테스트)**: 일부러 계정·관계자 섹션 삭제 + "구독자 100만 명" 가짜 사실 추가 → 누락 2건(critical 계정 이메일 포함)·환각 1건 정확 검출. 이 과정에서 **심판 결함 발견·수정** (트랜스크립트에 있으면 AI 문서에 없어도 present 판정 → 판정 기준을 주장 목록으로 명시 고정)
- vitest 34개 통과 (eval-core 5개 신규), typecheck·build 통과

### 실행 방법
```
npm run checklist -- sample-handover            # 정답→체크리스트 (캐시, 검토 필수)
npm run evaluate -- sample-handover --repeat 3  # 채점 + 재현성
npm run compare -- structure-v1 structure-v2    # 버전 비교 (체크리스트 필요)
npm run e2e                                     # 마이그레이션 후 txt 업로드 E2E
```

### 사용자가 할 일 (TODO)
- [ ] **마이그레이션 실행**: Supabase Dashboard > SQL Editor에 `supabase/ALL_MIGRATIONS.sql` 통째로 붙여넣고 Run → `npm run e2e`로 검증 (DB 비밀번호/access token이 없어 코드로는 적용 불가했음)
- [ ] `golden/sample-handover-checklist.json` 열어 27개 항목 검토 — **이 파일이 채점 기준(분모)**. 잘못 분해된 항목은 직접 수정 가능 (JSON 편집)
- [ ] 실 골든셋 작성 시 흐름: golden/{name}.md 작성 → `npm run checklist -- {name}` → 항목 검토 → convert → evaluate

### 스스로 내린 판단과 이유
1. **심판 출력에서 점수·총평 제거** — 판정(yes/no)만 LLM, 계산은 코드. 분모가 체크리스트로 고정되니 회차 간 흔들릴 여지가 판정 자체로 좁혀짐. 실측: 3회 연속 동일.
2. **네거티브 테스트를 통과 테스트보다 중시** — "전부 통과"는 판별력 증명이 아님. 망가뜨린 문서에서 정확히 그 결함만 검출되는지 확인했고, 덕분에 심판 결함 1건을 출시 전에 잡음.
3. **flatten 결함 수정** — overview.importance를 주장 목록에서 빼서 "중요도 높음" 체크리스트 항목이 항상 누락 판정됨 → 포함하도록 수정 (다음 채점부터 누락 1건 감소 예상). 남은 실질 누락 1건(구독자 1.2만 수치)은 첫날 v1 채점과 동일한 발견 — 채점 일관성의 방증.
4. **구 evaluate-v1 프롬프트 파일 삭제** — 메커니즘 자체가 대체돼 미사용 (git 이력에 보존).
5. **⚠️ API 호출 13회 — 한도 12회 1회 초과** — compare 실행 전 네거티브 테스트 임시 골든 파일을 정리하지 않아 의도치 않은 변환+채점 2회 발생. 사과. (내역: 체크리스트 1, 재현성 3×2세트, 네거티브 2, compare 3)
6. **git push 안 함** — 지시대로. 커밋만.

---

## 세션 1-9: 포지셔닝 개편 — 직종 보편형 스키마 v2 + AI 보완(inferred) ✅ (2026-06-11)

> 사용자 지시: 매장·현장직 포지셔닝 반영 (CLAUDE.md·스키마·프롬프트·에디터·체크리스트 갱신, 보강 질문 강화, 키프레임 점검), v1 대비 비교 리포트. 호출 10회 이내.

### 완료한 것
- **CLAUDE.md 개편** — 한 줄 정의(매장·현장직·실물 업무 차별점), AI 보완 허용 원칙 추가, 문서 스키마 v2로 교체
- **스키마 v2** (`lib/ai/schema.ts`) — ①업무 개요 ②절차 ③장비·위치·물품 ④일정·루틴 ⑤연락·보고 ⑥예외 상황·꿀팁 ⑦주의사항 ⑧미해결·인계 항목. 절차에 `inferred: boolean` (AI 추론 보완 라벨)
- **structure-v2 프롬프트** — 매장·현장 어휘, AI 보완 규칙(생략 단계만, inferred+needs_review+timestamp null 강제, 절차 외 추론 금지), 섹션 배치 지침. **기본 버전을 v2로 전환**
- **enrich-v2** — 보강 질문 우선순위 ① 건너뛴 단계 감지(절차 간 논리 비약) ② inferred 확인 ③ 빈/needs_review
- **checklist-v2** — 새 8섹션 명칭
- **채점 갱신** — flatten v2 섹션 대응. inferred 주장은 환각 집계에서 제외하고 `inferredClaims`로 별도 보고 (라벨 없는 추론만 환각). compare는 채점 캐시 우선 조회로 구 스키마 v1 캐시도 비교 가능
- **에디터/렌더러** — doc-html·render-md v2 섹션, inferred 항목은 `<mark>[AI 보완] … — 작성자 확인 필요</mark>` 하이라이트 (needs_review와 동일한 확인 동선)
- **비교 결과 (sample-handover, 체크리스트 27개 동일 분모)**: v1 누락 3.7% (1/27) → **v2 0.0% (0/27)**, 환각 둘 다 0건. → `results/compare-structure-v1-vs-structure-v2.md`
- vitest 36개·typecheck 통과. API 호출: 성공 2회 (변환+채점) + 실패 2회×재시도 (아래 판단 2)

### 키프레임·모바일 점검 결과 (코드 변경 없음 — TODO)
- 매칭(`match.ts`)은 STT 타임스탬프 기반이라 실물 촬영 영상에서도 동작 — 문제 없음
- **리스크**: `extract.ts` scene 임계값 0.3은 화면 녹화용. 폰 촬영은 손떨림·팬으로 과다 검출 + `-frames:v 30` 캡이 영상 앞부분에서 소진될 수 있음 → 실물 영상으로 임계값 0.4~0.5 실험 + 키프레임 최소 간격(예: 5초) 필터 필요
- **`.mov`(아이폰 기본 포맷) 미지원** — 업로더 accept·convert MEDIA_EXTS에 추가 필요
- **모바일 카메라 동선 없음** — 업로더에 `accept="video/*" capture="environment"` 촬영 버튼 추가, ScreenRecorder(getDisplayMedia)는 모바일 미지원이므로 모바일에선 촬영 버튼만 노출

### 사용자가 할 일 (TODO)
- [ ] 마이그레이션 완료·E2E 통과 확인됨 — 단, **기존 DB 문서는 구 스키마**라 새 에디터 초기 HTML 생성에서 제외됨(safeParse 폴백, 안 깨짐). `npm run e2e` 재실행하면 v2 문서로 재생성
- [ ] `output/sample-handover.json`(구 스키마)은 stale — 재생성: `npm run convert -- samples/sample-handover.txt`
- [ ] 실 골든셋부터는 `npm run checklist`가 checklist-v2(새 섹션명)로 생성됨. 기존 `golden/sample-handover-checklist.json`은 구 섹션명이지만 채점은 사실 텍스트 대조라 영향 없음 (리포트 그룹명만 구 명칭)

### 스스로 내린 판단과 이유
1. **inferred를 절차 전용으로 한정** — 전 항목에 넣자 structured output "compiled grammar too large" 400 에러 (재시도 포함 2회×2). AI 보완 원칙 자체가 "생략된 **단계**" 보완이므로 절차 한정이 요구사항과 일치하고 grammar 한도도 해결.
2. **API 호출 내역 (한도 10)** — grammar 초과 실패 4회(과금 전 검증 단계 400 추정) + 성공 2회(v2 변환 1, v2 채점 1). v1 쪽은 채점 캐시 재사용 0회.
3. **v1 비교는 어제 채점 캐시 재사용** — 같은 체크리스트(27개) 분모라 공정 비교 성립. compare 루프를 채점 캐시 우선으로 재배치해 구 스키마 변환 캐시를 파싱하지 않고도 비교 가능하게 함.
4. **기본 프롬프트 버전 v2 전환** — 스키마가 v2로 교체돼 v1 프롬프트는 구 스키마 전제. 비교에서도 v2가 우위(0% vs 3.7%).
5. **sample-handover(유튜브 운영, 사무직)로 v2 검증** — 매장·현장 샘플이 없어 신규 섹션(장비·예외)의 실전 검증은 실 골든셋에서. 이번 샘플에서도 v2가 장비 3·예외 3건을 적절히 분류함.

---

# 🏁 전체 요약 (사용자 기상 후 읽을 것)

## 상태: Phase 0 코드 + Phase 1 전체 + 골든셋 반복 도구(1-7) 완료

빌드·vitest 29개 전부 통과. 판단 3건(모델·after() 큐·print PDF)은 사용자 승인 완료.

## 지금 바로 해볼 수 있는 것 (키 입력 없이)
```
npm run compare -- structure-v1                  # 골든셋 배치 변환+채점 (캐시 덕에 재실행 무료)
npm run report                                   # 섹션별 누락 집계 (호출 0회)
npm test                                         # 단위 테스트 29개
npm run dev                                      # 웹 (Supabase 셋업 전엔 /login에 안내 표시)
```

## 깨어나서 해야 할 일 (우선순위순)
1. **마이그레이션**: SQL Editor에 `supabase/ALL_MIGRATIONS.sql` 붙여넣고 Run → `npm run e2e` (Supabase 키는 확인·정정 완료, 스키마만 미적용)
2. 웹 확인: `npm run dev` → e2e가 만든 계정으로 로그인 → 에디터/보강 질문/공유 확인
3. **OPENAI_API_KEY는 여전히 .env에 없음** — 추가하면 영상 업로드가 실 Whisper로 동작
4. **Phase 0 본체**: 실 트랜스크립트 10개(samples/) — 매장·현장직 샘플 포함 권장 + 정답 문서(golden/) → `npm run checklist -- --all` + 항목 검토 → `npm run compare -- structure-v2` 기준선 → 개선 버전(v3) 작성·등록 → compare로 비교 → `npm run report`로 반복 누락 섹션 확인 → 누락률 <10%/환각 0까지 반복

## 다음 빌드 세션
- Phase 2-1 결제(토스), 2-2 마스킹+30일 삭제 cron, 2-3 랜딩 페이지 (지시 범위 밖이라 미진행)
- 후속 TODO: **실영상 STT 시 Vercel 타임아웃 → Inngest 전환**, Whisper 25MB 초과 시 ffmpeg 오디오 추출, 서버 사이드 PDF(한글 폰트+키프레임), 에디터 키프레임 교체 UI
- 후속 TODO (세션 1-9 점검): 실물 촬영 키프레임 — scene 임계값 0.4~0.5 실험 + 최소 간격 필터, `.mov` 지원, 모바일 웹 카메라 촬영 버튼(`capture="environment"`)·업로드 동선
