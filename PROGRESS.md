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

## 아키텍처 결정 기록 (2026-06-12)

### 녹화·업로드 전략 — Phase 2 후반 구현 예정

| 경로 | 현재 (Phase 1) | Phase 2 후반 목표 |
|---|---|---|
| 브라우저 화면 녹화 | MediaRecorder → 종료 후 통째 업로드 | MediaRecorder `timeslice` 조각 분할 + 실시간 스트리밍 업로드 → 대용량 영상 & 업로드 중단 복구 |
| 외부 파일 업로드 | 원본 파일 통째 Supabase Storage | 클라이언트에서 ffmpeg.wasm으로 오디오·키프레임 추출 후 전송 → 서버 처리 부하·비용 절감 |

**현재 방식의 한계**: 대용량 영상(1GB+)은 단일 XHR PUT이 실패할 수 있음. 서버에서 ffmpeg 처리 시 Vercel 함수 메모리·타임아웃 위험.  
**Phase 2 후반 전환 신호**: 실 사용자 유입 후 업로드 실패율·처리 비용 모니터링 결과로 판단.

## 다음 빌드 세션
- Phase 2-1 결제(토스), 2-2 마스킹+30일 삭제 cron, 2-3 랜딩 페이지 (지시 범위 밖이라 미진행)
- 후속 TODO: **실영상 STT 시 Vercel 타임아웃 → Inngest 전환**, Whisper 25MB 초과 시 ffmpeg 오디오 추출, 서버 사이드 PDF(한글 폰트+키프레임), 에디터 키프레임 교체 UI
- 후속 TODO (세션 1-9 점검): 실물 촬영 키프레임 — scene 임계값 0.4~0.5 실험 + 최소 간격 필터, `.mov` 지원, 모바일 웹 카메라 촬영 버튼(`capture="environment"`)·업로드 동선

---

## 세션 2-A: UI 다듬기 + Phase 2 착수 ✅ (2026-06-12~13)

> 사용자 지시: ① 배포 전 UI 다듬기 7건 ② structure-v2 환각 1건 수정 ③ 30일 cron ④ 랜딩 페이지 ⑤ 토스페이먼츠 건당 결제

### 완료한 것

**UI 다듬기**
- 공유 페이지(/share) CSS variable 팔레트 적용, 인쇄 버튼 다크/라이트 대응
- ScreenRecorder.tsx 전체 zinc 하드코딩 → CSS var
- 빈 상태 개선: 프로젝트 0개, 영상 0개, 문서 없음 — 안내 문구 + 다음 행동 버튼
- 영상 처리 중 `animate-pulse` 배지, 실패 시 `재시도` 버튼 + retryVideo 서버 액션
- 에러 메시지 전수 한국어 교체 (process-video.ts 3건, upload-actions.ts)
- 모바일 375px: ScreenRecorder flex-wrap + gap-y-3, 그 외 레이아웃 수정

**Phase 2-0: structure-v2 환각 수정**
- `overview.importance` — nullable 필드 규칙 추가: 트랜스크립트에서 명시적으로 언급된 경우에만, 없으면 반드시 null. 백틱 파싱 에러 수정

**Phase 2-2: 30일 영상 자동 삭제 cron**
- `/api/cron/cleanup-videos` — keyframe 이미지 → 영상 파일 → video DB 행(CASCADE) 삭제
- `vercel.json` — `0 0 * * *` Vercel cron 등록, CRON_SECRET Bearer 인증

**Phase 2-3: 랜딩 페이지 개선**
- `app/page.tsx` — Hero, 이런 분들께(3카드), 사용 방법(3단계), 주요 기능(6항목), 하단 CTA

**Phase 2-1: 토스페이먼츠 건당 결제**
- `supabase/migrations/0006_payments.sql` — payments 테이블 + projects.plan(free|paid)
- `lib/payments/confirm-logic.ts` — validateConfirmRequest 순수 함수 (금액·상태 검증)
- `lib/payments/toss.ts` — confirmTossPayment (토스 서버 승인 API 호출)
- `lib/payments/confirm-logic.test.ts` — vitest 7개 (금액 변조·이중 승인·잘못된 상태)
- `/projects/[id]/upgrade` — 토스 위젯 결제 페이지 (PaymentWidget.tsx + page.tsx)
- `/projects/[id]/upgrade/success` — 서버 승인: 금액 서버 검증 → confirmTossPayment → plan=paid 전환, 멱등성 처리
- `/projects/[id]/upgrade/fail` — 결제 실패/취소 안내 (취소는 에러 표시 안 함)
- `/payments` — 결제 내역 페이지
- 비용 가드 분기: paid 프로젝트 = 프로젝트 단위 2시간, free = 계정 전체 20분
- 한도 초과 시 upgradeUrl 반환 → VideoUploader 업그레이드 링크
- 프로젝트 상세 페이지 PRO 배지 / 업그레이드 링크
- .env.example NEXT_PUBLIC_TOSS_CLIENT_KEY + TOSS_SECRET_KEY 추가
- ALL_MIGRATIONS.sql에 0006 합본

### 실행 방법
```
# DB 마이그레이션 (0006_payments.sql 또는 ALL_MIGRATIONS.sql 재실행)
# Supabase Dashboard > SQL Editor > supabase/migrations/0006_payments.sql 실행

# 토스 결제 테스트
# .env에 NEXT_PUBLIC_TOSS_CLIENT_KEY, TOSS_SECRET_KEY(테스트 키) 설정 후
npm run dev
# 프로젝트 > 업그레이드 > 토스 테스트 카드로 결제 → 성공 리다이렉트 확인
```

### 사용자가 할 일 (TODO)
- [ ] **0006_payments.sql 실행**: Supabase Dashboard > SQL Editor > `supabase/migrations/0006_payments.sql` 실행
- [ ] **토스 E2E**: 테스트 카드 결제 → `/projects/[id]?upgraded=1` 리다이렉트 → PRO 배지 확인 → 업로드 2시간 한도 동작 확인
- [ ] 남은 Phase 0 본체: 골든셋 10개(매장·현장 포함) + structure-v2 반복 채점

### 스스로 내린 판단과 이유
1. **successUrl/failUrl — 환경변수 없이 headers()에서 baseUrl 추출** — NEXT_PUBLIC_APP_URL 추가 없이 dev/prod 양쪽 동작. x-forwarded-proto + host.
2. **결제 기존 pending 재사용** — 업그레이드 페이지를 새로고침해도 동일 orderId 유지. 토스는 같은 orderId 중복 결제를 거부하므로 pending 재사용이 안전.
3. **PaymentWidget SDK 수정** — 설치된 @tosspayments/tosspayments-sdk는 loadTossPayments + widgets() 패턴. loadPaymentWidget 미존재 → 빌드 에러 → loadTossPayments + tossPayments.widgets() + setAmount() 패턴으로 수정.
4. **vitest 43개 통과, build 통과 후 커밋**

---

## 세션 3-A ①: 기준선 정리 · 실데이터 분리 · 마스킹 코드 계층 · 보안 감사 (2026-09-27)

### 기준선 (클론 직후, 코드 변경 전)
- `npm install`/`npm ci` **실패** — lockfile 불일치: `@tiptap/extension-image@3.26.1` peer `@tiptap/core@3.26.1` vs 설치된 core 3.26.0 → image를 3.26.0으로 정렬 후 설치 성공
- vitest: **43/43 통과** (6 files)
- typecheck: **에러 0**
- next build (16.2.7 Turbopack): **성공**, 경고 1 — `middleware` 파일 규칙 deprecated (→ `proxy`)

### 완료한 것
**0. 기준선·정리**
- ESLint 도입: `eslint.config.mjs` (eslint-config-next core-web-vitals + typescript, flat), `npm run lint` — 에러 1건(ThemeToggle setState-in-effect → `useSyncExternalStore`) 수정, **에러 0**
- CLAUDE.md 사실 정정: Next.js 16, STT(Groq 기본·OpenAI 폴백), 결제 완료(65dcef4), 마스킹 정책 문구 2곳(스키마 설명·보안 절 — "비밀번호류 마스킹"이 실제 정책과 반대였음), 현재 단계·남은 것
- `Transcript.source`에 `groq` 추가 — Groq 응답은 `groq`, `processAudio` 청크 병합도 실제 provider 기록 (vitest 1개)
- `@tosspayments/tosspayments-sdk` 제거, `tsconfig.tsbuildinfo` 추적 해제 + `*.tsbuildinfo` gitignore
- npm audit high/critical 5건 → 0: next 16.3.6, tiptap 전체 3.31.3, nanoid 5.1.16 (남은 것: moderate 3·low 1). `npm ci` 클린 설치 확인

**1. 실데이터 분리**
- `golden/sample-01*`(8) + `samples/sample-01*`(4) → `private-data/golden/` (gitignore, `private-data/README.md`)
- 채점 스크립트 5종 경로를 `GOLDEN_DIR`(기본 `./golden`)로 — `lib/golden-paths.ts`. 비공개 경로면 output/results도 `private-data/` 하위로 자동 저장 (심판 근거 인용 격리). 트랜스크립트는 `{GOLDEN_DIR}/{name}.txt` → `samples/{name}.txt` 순. `README.md`는 샘플 목록에서 제외. 채점 로직 변경 0
- 공개 가상 샘플: `golden/sample-demo.txt`(카페 평일 마감조 바 담당, 34세그먼트 ~19분) + `golden/sample-demo.md` — 의도적 누락 3개(발주 방법·시재 불일치 처리·보안 설정) + 위치 불명확 1개. **이 트랜스크립트는 3-B 데모 fixture로 재사용**
- `golden/README.md` 파일 규칙 + 비공개 채점 방법, `.env.example`에 `GOLDEN_DIR`
- 실데이터 고유 문자열 grep (현재 트리 + 전 이력, 값 미기록): `docs/daily/2026-06-12.md`(비밀번호 값 2개·매장 물품), `docs/par-materials.md`(매장 물품) 일반화. `tests/mask.test.ts`에 실데이터 일련번호가 들어갔던 것도 가상 값으로 교체
- gitleaks 8.30.1(포터블, scratchpad) 전 이력 29커밋: **유출 0건**. `git log --all -- .env` 없음
- `docs/publish-checklist.md` — 실제 URL로 완성된 filter-repo 절차, `--path` 13개 + `--replace-text`(값은 `private-data/history-redactions.txt`), 검증용 `private-data/history-strings.txt`
- CLAUDE.md Phase 3 규칙: 지표는 비공개 골든셋 기준 명시, sample-demo 점수 인용 금지

**2. 마스킹 코드 계층** — `lib/privacy/mask.ts`
- 주민·외국인등록번호(하이픈/공백/없음, 생년월일 유효성 + 7번째 자리 1~8) → `[주민번호]`
- 카드번호: 15·16자리, 연속/4-4-4-4/4-6-5(구분자 일관), 첫 자리 3·4·5·6·9 또는 2221~2720, Luhn → `[카드번호]`
- 적용: STT 병합 직후(저장 전) 1차, 구조화 결과 2차 (`maskDeep` — 문자열 값만). 파이프라인·convert·compare 모두. 프롬프트 마스킹 지시 유지
- vitest 43개: 양성 15 / 음성 27(전화·PIN·사업자·계좌 12~14자리·EAN-13 3개·일련번호·금액·타임스탬프·Luhn 실패 등) / maskDeep 1

**3. 보안 감사** — 상세 `docs/security-checklist.md`
- **실 DB에서 재현된 취약점 (수정 코드 완료, 0008 적용 필요)**: 사용자가 anon key로 `projects.plan='paid'` 변경(결제 우회), paid 프로젝트 직접 생성, `videos.storage_path` 조작(타인 영상 처리), keyframes 직접 insert
- `0008_rls_hardening.sql` 컬럼 단위 권한 + 서버 액션 쓰기 service_role 이전 + 파이프라인 경로 소유권 검사
- `/api/keyframes` 인증 추가(세션 또는 공유 토큰+프로젝트 소속), 공유 뷰 `?share=` 부착, docx 내보내기 키프레임 소속 검증
- 업로드 서버 재검증(매직 넘버·용량), **비용 가드를 ffmpeg 실측 길이로 STT 전 판정** (`probeDurationSeconds`, 합성 mp4 7s·webm 5.01s 확인)
- env zod 검증 (`lib/env.ts`, `instrumentation.ts` → `lib/env-check.ts`): prod 누락 시 `exit(1)`, build 단계 제외 — `next start`로 실패·성공 양쪽 확인
- 레이트리밋 `0007_rate_limits.sql` + `lib/rate-limit.ts`, 파이프라인 실패 사유 사용자용 문구화, `app/error.tsx`·`app/not-found.tsx`
- RLS 통합 테스트 `npm run test:rls` — 실 DB 1회: **10 통과 / 4 실패(0008 미적용 — 위 취약점 재현)**, 임시 유저·프로젝트 정리 확인(0건)
- 클라이언트 번들 시크릿 값 검색 0건, 버킷 private 실 DB 확인

**마무리**: lint 에러 0 · typecheck 0 · vitest **113 통과 / 14 skip(RLS 통합)** · next build 성공

### 레이트리밋 기본값 (env로 조정)
| action | env | 기본 | 대상 |
|---|---|---|---|
| pipeline | `RATE_LIMIT_PIPELINE_PER_HOUR` | 20회/시간 | 업로드 완료, 재시도 (STT+구조화+보강 질문) |
| ai_edit | `RATE_LIMIT_AI_EDIT_PER_HOUR` | 60회/시간 | 보강 질문 답변 다듬기 |

### ESLint 경고 (목록만, 미수정)
- `app/documents/[id]/keyframe-actions.ts:7` 미사용 `HandoverDocument`
- `app/projects/[id]/upgrade/success/page.tsx:1` 미사용 `notFound`
- `lib/audio/processor.ts:3` 미사용 `stat`
- `postcss.config.mjs:1` 익명 default export
- `scripts/build-checklist.ts:14` 미사용 `CHECKLIST_MODEL` (수정 금지 파일)

### 새 화면 문구 — 사용자 검토 필요
- `app/error.tsx`: "일시적인 오류가 발생했습니다" / "다시 시도해도 같은 문제가 반복되면 잠시 후 다시 접속해 주세요." / "오류 코드:" / 버튼 "다시 시도"·"홈으로"
- `app/not-found.tsx`: "페이지를 찾을 수 없습니다" / "주소가 잘못되었거나, 삭제되었거나, 접근 권한이 없는 페이지입니다."
- 파이프라인 일반 실패: "문서 변환 중 오류가 발생했습니다. '다시 시도'를 눌러 주세요. 반복되면 파일을 다시 업로드하세요."
- 실측 길이 초과: "실제 영상 길이 기준으로 {기존 한도 문구} 프로젝트 화면의 '업그레이드'에서 결제하면 영상 2시간까지 변환할 수 있습니다."
- 영상 판독 불가: "영상 파일을 읽을 수 없습니다. 손상되지 않은 파일인지 확인하고 다시 업로드하세요."
- 업로드 재검증: "지원하지 않는 형식입니다…" / "빈 파일입니다…" / "파일이 너무 큽니다 (최대 2GB|2MB). 나눠서 업로드하세요." / "파일 내용이 확장자와 맞지 않습니다…" / "업로드된 파일을 찾을 수 없습니다…" / "이미 처리 중인 영상입니다."
- 레이트리밋: "짧은 시간에 변환 요청이 너무 많습니다. 1시간 뒤에 다시 시도하세요." / "짧은 시간에 AI 요청이 너무 많습니다. 잠시 후 다시 시도하세요."
- 키프레임: "이미지를 불러오지 못했습니다. 잠시 후 다시 시도하세요." / "이미지 변경을 저장하지 못했습니다. 잠시 후 다시 시도하세요."

### 사용자가 할 일
- [ ] **⚠️ 최우선: `0007_rate_limits.sql` → `0008_rls_hardening.sql` SQL Editor 실행** (결제 우회 취약점이 현재 DB에 열려 있음) → `npm run test:rls` 14/14 확인
- [ ] **sample-demo 채점 재현 (API 3회)**: `npm run convert -- golden/sample-demo.txt` → `npm run checklist -- sample-demo` → 체크리스트 검토 → `npm run evaluate -- sample-demo`. 이번 세션 convert 1차는 SDK `Connection error`(재시도 포함 2회, 서버 미도달 — 직후 models.list는 정상), 재실행은 사용자 거부로 중단
- [ ] `.env`에 `CRON_SECRET`(16자+) 추가 — 없으면 production 부팅 실패 (의도). Vercel 환경변수에도 동일
- [ ] `.env`의 `GROQ_API_KEY =`처럼 `=` 앞 공백이 있는 줄 정리 (파서별로 키 이름이 달라질 수 있음). 미사용 키(AUTH_*, TOSS_CLIENT_KEY) 정리 여부 판단
- [ ] `private-data/`를 별도 private 리포로 이동 → `docs/publish-checklist.md` 절차로 이력 제거·공개 전환 (Python 미설치 → `winget install Python.Python.3.12`)

### 스스로 내린 판단과 이유
1. **sample-02·03 유지 (이전 보고 정정)** — 둘 다 전 이력에서 **0바이트 빈 파일**. 지난 보고에서 sample-03을 실매장 데이터라 한 것은 `head` 출력 순서를 잘못 읽은 오류(실제로는 samples/sample-01b.txt 내용). 옮길 데이터가 없어 유지하고 publish-checklist에 명시. 대신 이력 조사에서 **sample-01b**(실데이터)와 **docs 2개 문서**의 과거 버전을 추가로 찾아 대상에 포함
2. **비공개 산출물 자동 격리** — `GOLDEN_DIR`만 받되, 기본값이 아니면 output/results를 그 상위로. env 추가 없이 "실데이터 인용이 공개 경로에 남지 않음"을 구조적으로 보장. 현재 results/output은 로컬·이력 모두 없음 → 이동할 파일 0
3. **private-data 평탄화** — golden/·samples/ 이중 구조 대신 `private-data/golden/` 한 곳(`{name}.txt` 규칙). samples/sample-01.txt는 golden 사본과 바이트 동일 확인 후 1개만 유지
4. **주민번호 구분자 없는 13자리 + EAN-13 충돌** — 테스트 중 발견: 국내 바코드 `880…`이 "88년 X월 X일"로 해석돼 마스킹됨. EAN 체크섬 통과 **그리고** 주민번호 체크섬 실패면 바코드로 보존. 한계: 2020-10 이후 발급 주민번호(체크섬 없음)가 구분자 없이 발화되고 우연히 EAN 체크섬까지 맞으면(~10%) 보존됨 — 오탐(인수인계 정보 손실)보다 낫다고 판단. 13자리 연속 계좌번호가 날짜·7번째 자리 조건을 우연히 만족하면 마스킹될 수 있음(테스트 값은 불충족)
5. **RLS: 트리거 대신 컬럼 grant/revoke** — 선언적이고 PostgREST가 즉시 거부. videos insert를 사용자 세션 → service_role로 옮김 (소유권은 RLS select로 먼저 확인)
6. **레이트리밋 fail-open** — 0007 미적용·DB 장애 시 서비스 전체 차단보다 허용 + 에러 로그. 비용 상한은 플랜 분 한도가 별도로 막음
7. **env 검증에 CRON_SECRET·TOSS 키 포함** — production에서 없으면 cron·결제가 조용히 깨지므로 부팅 실패가 맞다고 판단. STT는 Groq/OpenAI 중 하나 또는 `HANDOVER_STT=mock`
8. **process.exit(1)** — `throw`만으로는 `next start`가 "Failed to prepare server" 후에도 떠 있음(실측). Node 전용 모듈로 분리해 Edge 번들 경고 제거
9. **lockfile 정렬** — 클론 직후 `npm ci`부터 실패(tiptap peer 불일치). 보안 패치와 함께 tiptap 전체를 3.31.3으로 통일
10. **API 호출: 과금 0회** (convert 1회 시도 = 연결 실패). 한도 5회 중 미사용

### 남은 것
- 사용자 조치 후: test:rls 14/14, sample-demo 채점 재현 기록
- 서버 액션 입력 zod 전면 적용, rate_limits 행 정리, middleware→proxy 전환
- Phase 3 나머지: Inngest, 샘플 체험 동선, 모바일·PWA·Lighthouse, CI, 약관·계정 삭제, README

---

## 세션 3-A②: sample-demo 채점 재현 ❌ convert 실패 (2026-09-28)

> 지시: convert → checklist → evaluate 실행·보고, 에러는 진단만(코드 수정 금지). API 한도 3회.

### 실행 결과
| 단계 | 결과 | 산출물 |
|---|---|---|
| `npm run convert -- golden/sample-demo.txt` | ❌ exit 1 — `구조화 실패 (재시도 포함 2회): Connection error.` | 없음 |
| `npm run checklist -- sample-demo` | ✅ 52초, **70개 항목 (critical 43)**, 토큰 in=4302 out=3173 | `golden/sample-demo-checklist.json` |
| `npm run evaluate -- sample-demo` | ❌ exit 1 — `AI 문서 없음: output\sample-demo.json (먼저 convert 실행)` (API 호출 전 중단) | 없음 |

→ **누락률·누락 항목 수: 산출 불가** (evaluate 미실행)

### convert 실패 진단 (코드 변경 없음)
- `models.list`·존재하지 않는 모델로 큰 본문 `messages` 요청(404, 과금 없음): 0.4~0.5초 정상 → 인증·네트워크·본문 크기 문제 아님
- convert와 **동일 요청**을 SDK 재시도 끄고 1회 재현(scratch 스크립트, 커밋 안 함): **정확히 60.2초에** `APIConnectionError` ← `fetch failed` ← `UND_ERR_SOCKET: other side closed`
- checklist는 52초에 응답 완료 → 통과. **원인: 비스트리밍 요청은 생성이 끝날 때까지 응답 바이트가 0 → 연결 경로 어딘가에서 60초 유휴 연결을 끊음.** 구조화(출력 수천 토큰)는 60초를 넘겨 매번 실패, 체크리스트·짧은 샘플은 60초 안에 끝나 성공
- 끊는 주체(로컬 보안 SW·네트워크 장비·실행 환경 프록시 등)는 특정 못 함 — raw TLS 유휴 측정은 서버 자체 헤더 타임아웃(15초·50초)에 가려져 판별 불가
- 부수 발견: 연결 오류 시 **SDK 기본 재시도 2회 × structure.ts 재시도 1회 = convert 1회당 최대 6개 요청**(각 ~60초). 서버에서 생성이 진행됐다면 과금됐을 수 있음
- 수정 방향(다음 세션 지시 대기): `lib/ai/structure.ts`(및 60초 넘는 다른 호출)를 스트리밍(`messages.stream` → 최종 메시지 파싱)으로 전환하면 이벤트가 계속 흘러 유휴 끊김 회피. 연결 오류 재시도 횟수 정리 검토. 같은 코드가 운영 파이프라인(`processVideo`)에도 쓰이므로 배포 환경에서도 동일 위험

### 의도적 누락 항목 판정 (evaluate 미실행 → 체크리스트 기준 사전 분석만)
체크리스트에 4개 모두 `미해결·인계 항목` critical로 들어감:
| 항목 | 트랜스크립트 근거 | 예상 |
|---|---|---|
| 재고 부족 시 발주 방법 누락 | "그거는 나중에 따로 말씀드릴게요" 명시 | 미해결 항목으로 잡힐 가능성 높음 |
| 보안 설정 방법 (점장님께 요청) | "말로 하기 애매해서 점장님한테…" 명시 | 잡힐 가능성 높음 |
| 세척 약품 위치 불명확 | "창고 쪽에 있어요" (모호) | 장비 항목에 "창고 쪽"으로 기록되면 판정 애매 |
| **시재 불일치 시 처리 방법 없음** | **트랜스크립트에 언급 자체 없음** | 환각 금지 원칙상 AI 문서에 안 나오는 게 정상 → **critical 누락으로 잡힐 구조** |
- **골든셋 설계 문제(내 판단 오류, 세션 3-A①)**: "보강 질문이 짚을 포인트"로 넣은 누락을 정답 문서 `미해결` 섹션에 사실처럼 적어, 체크리스트가 "AI 문서가 이걸 포함해야 함"으로 분해함. 트랜스크립트에 없는 공백까지 AI 문서에 요구하는 셈 → 누락률 과대 + 환각 유도. 보강 질문(enrich) 평가 대상과 구조화 문서 평가 대상이 섞임. 정답 문서·체크리스트 조정 여부는 사용자 결정 필요 (골든셋 내용 수정은 Phase 3 규칙상 금지 항목)

### API 사용
- 명령 단위 3회: convert 1 (내부 최대 6요청) · checklist 1 · 진단 재현 1 (재시도 0, 단일 요청)
- 과금 없는 진단: models.list 1, 가짜 모델 404 1, raw TLS 2

### 사용자가 할 일
- [ ] Anthropic Console 사용량에서 2026-09-27~28 실패 요청 과금 여부 확인
- [ ] `golden/sample-demo-checklist.json` 70개 항목 검토 (채점 분모) — 특히 위 `미해결` 4개 유지 여부
- [ ] 다음 세션 지시: 구조화 호출 스트리밍 전환 → convert·evaluate 재실행

### 남은 것
- convert 성공 후 evaluate → 누락률·의도적 누락 실제 판정 기록

---

## 세션 3-A③: 스트리밍 전환 + sample-demo 골든셋 수정 + 채점 재현 ✅ (2026-09-28)

> 지시: structure.ts 스트리밍 전환·재시도 정리, sample-demo 정답 수정, sample-01 동일 패턴 확인(수정 금지), checklist→convert→evaluate. API 한도 3회.

### 완료한 것
**1. 스트리밍 전환** (커밋 `ccecccb`)
- `lib/ai/structure.ts`: `messages.parse()` → `messages.stream().finalMessage()` (SDK 0.103은 스트림 최종 메시지에 `parsed_output` 제공). zod 검증·`max_tokens` 잘림 검사·루프 재시도 1회 그대로
- SDK 재시도 2 → **1** (`new Anthropic({ maxRetries: 1 })`): 최대 요청 6 → 4
- convert·compare·운영 파이프라인(`processVideo`) 모두 `structureTranscript` 경유 확인 → 별도 수정 불필요
- **지시 범위 밖 추가 (판단 1)**: `lib/ai/evaluate.ts`(심판)·`lib/ai/checklist.ts`도 같은 전환 + 요청 단위 `maxRetries: 1`
- 무과금 스모크 테스트: 존재하지 않는 모델로 convert → 스트림 경로에서 404 정상 전파, 루프 재시도 1회 확인
- typecheck 0 · lint 에러 0 · vitest 113 통과

**2. `golden/sample-demo.md` 수정** (가상 데모 데이터만, 실데이터 무수정)
- 삭제: `미해결`의 "시재 불일치 처리 방법 없음" (트랜스크립트 언급 0)
- 유지: "발주 방법 — 나중에 따로 말씀드릴게요", "보안 설정 — 점장님께 첫날 요청" (트랜스크립트에 실제 언급)
- 세척 약품: 위치 칸을 `창고 쪽`으로만, `미해결`의 "정확한 위치 불명확" 삭제 (추가 정보·메타 판단 없이 원문 표현만)
- **판단 2**: 같은 파일의 `블라인드 필터`·`밀폐 용기` "⚠️ 위치 언급 없음"도 같은 패턴(부재를 사실처럼 기재) → `-`로 변경
- 머리말·`golden/README.md` 설명을 새 원칙으로 갱신

**3. 채점 재현**
| 단계 | 결과 | 산출물 |
|---|---|---|
| `npm run checklist -- sample-demo --force` | ✅ 51초, **69개 (critical 35)**, in=4247 out=3068 | `golden/sample-demo-checklist.json` |
| `npm run convert -- golden/sample-demo.txt` | ✅ **92초** (60초 초과 → 스트리밍 효과 확인), in=7489 out=5639, 시도 1회 | `output/sample-demo.json`, `.md` |
| `npm run evaluate -- sample-demo` | ✅ **163초**, in=15507 out=10749 | `results/sample-demo-eval.md`, `.json` |

- **누락률 0.0% (0/69), critical 누락 0, 환각 0, inferred 0** — ⚠️ 공개 가상 샘플 점수, 품질 지표 인용 금지 (Phase 3 규칙)
- 남긴 항목 판정:
  - 발주 방법 → ✅ AI 문서 `미해결`(needs_review)에 포함, 체크리스트 #67 present
  - 보안 설정 → ✅ `미해결`(high)에 도어락 안내와 합쳐 포함, #57 present
  - 세척 약품 "창고 쪽" → ✅ 장비 항목 present (#68). 단 AI 문서는 위치 `창고`·confidence `high` — "쪽"의 모호함이 사라지고 needs_review 표시도 없음 (관찰, 채점상 누락 아님)
  - 시재 불일치 → AI 문서에 언급 없음 (환각 없음 ✓), 정답에서도 제거돼 벌점 없음
- 관찰: 발주 항목을 AI 문서("점장님께 별도 확인 필요")와 체크리스트("점장님께 별도로 확인해야 한다") 둘 다 "점장님께 확인"으로 서술. 트랜스크립트는 "원래 점장님이 하시는데… 나중에 따로 말씀드릴게요"(말하는 사람이 추후 설명) — 확인 주체를 약간 재해석. 심판은 근거 있음으로 판정

### sample-01(실데이터) 동일 패턴 확인 — 보고만, 수정 안 함
- `private-data/golden/`의 `sample-01.md`·`-answer`·`-main`·`-merged` 4개는 바이트 동일, 체크리스트 3개도 동일
- 정답 문서 ⚠️ 표시 10곳 중 **트랜스크립트(3개 전부)에 언급이 전혀 없는 공백을 사실처럼 기재**: 문제 발생 시 연락처/담당자, 현금 거스름돈 처리, 매장 오픈 절차, 재고 관리·부족 처리 (관련 키워드 검색 0건)
- 이 중 체크리스트로 분해된 것 (43개 중):
  - #40 **critical** "문제 발생 시 연락할 담당자 및 연락처가 인수인계 문서에 없다"
  - #41 **critical** "현금 결제 시 거스름돈 처리 방법이 인수인계 문서에 없다"
  - #42 (일반) "근무 중 착용하는 안경의 보관 위치가 불명확하다" — 착용은 언급, 위치는 미언급(모호함 메타 판단)
- **영향**: 기록된 지표 "sample-01 합산 누락 7.0% (3/43), critical 2건"의 critical 2건이 바로 #40·#41 (2026-06-12 일지: "잔존: 거스름돈 처리, 담당자 연락처 (트랜스크립트에 내용 자체 없음)"). 이 패턴을 제외하면 대략 1/41 ≈ 2.4%, critical 0 (재채점 안 함 — 추정치)
- README 지표로 쓰기 전에 사용자 판단 필요: 정답 수정 후 재채점할지, 현행 7.0%를 "보강 질문 대상 공백 포함 기준"으로 명시할지

### API 사용 — 3/3회
- checklist 1 · convert 1 (시도 1) · evaluate 1. 무과금: 가짜 모델 404 스모크 테스트 1

### 스스로 내린 판단과 이유
1. **evaluate·checklist도 스트리밍 전환** — 지시는 structure.ts만. 하지만 심판은 69개 사실 + AI 문서 주장 전부를 판정해야 해 60초를 확실히 넘음 (실측 163초). 전환 안 했으면 evaluate 호출이 같은 이유로 실패해 한도 1회를 날렸을 것. 채점 로직·`scripts/evaluate.ts`·`scripts/build-checklist.ts`는 무수정 (전송 방식만). checklist(이전 52초, 이번 51초)도 60초 경계라 함께 전환
2. **SDK 재시도 1회 (0 아님)** — 스트리밍은 응답 헤더가 즉시 오므로 SDK 재시도는 헤더 전 실패(429·529·연결 실패)에만 걸림 = 생성 전이라 과금 없음. 생성 중 끊김은 SDK가 재시도하지 않고 structure.ts 루프(1회)만 재시도. 0으로 두면 일시적 529에서 백오프 없이 바로 루프 재시도 → 실패 확률만 오름
3. **블라인드 필터·밀폐 용기 "위치 언급 없음" 정리** — 지시 4개 항목 밖이지만 같은 파일, 같은 결함("없음"을 정답 사실로 기재). 이번 체크리스트에 해당 사실은 생성되지 않았음
4. **output/sample-demo.json·.md도 커밋** — 채점 입력(AI 문서)이라 결과 재현에 필요. 가상 데이터라 공개 무방. results/·output/은 gitignore 대상이라 해당 파일만 `-f`로 추가

### 사용자가 할 일
- [ ] sample-01 정답 문서 #40·#41(·#42) 처리 결정 → 수정 시 `GOLDEN_DIR=./private-data/golden npm run checklist -- sample-01-merged --force` 후 재채점 (API 3회 내외)
- [ ] `golden/sample-demo-checklist.json` 69개 검토 (특히 #67 "점장님께 별도로 확인" 표현)
- [ ] (이전 세션 이월) 0007·0008 마이그레이션 실행 + `npm run test:rls`, Console에서 9/27~28 실패 요청 과금 확인

### 남은 것
- `lib/ai/enrich.ts` 보강 질문 호출은 비스트리밍 유지 (max_tokens 2000·500, 60초 내 예상) — 운영에서 끊기면 같은 전환 필요
- Phase 3 나머지 (Inngest, 샘플 체험 동선, 모바일·PWA, CI, 약관·계정 삭제, README)

---

## 세션 3-A④: 채점 방법론 버그 수정 — sample-01 정답 정정 + 재채점 ✅ (2026-09-28)

> 지시: sample-01 정답 문서의 "트랜스크립트에 없는 공백" 정정, checklist #67 원인 확인·정정, sample-01 재채점, 방법론 문서화. API 한도 3회.

### 완료한 것
**1. sample-01 정답 문서 정정** (`private-data/golden/sample-01.md` — 비공개, 커밋 대상 아님)
- 트랜스크립트 3개(본 영상 + 보완 2클립, `sample-01-merged.txt`로 합본) 전문 검토: 연락처·담당자·전화, 거스름돈·잔돈, 오픈, 재고·발주·부족 키워드 발화 **0건**
- 제거: `연락·보고`의 "문제 발생 시 연락처 언급 없음", `주의사항`의 "거스름돈 처리 방법 언급 없음", `미해결` 5개 전부 (연락처/담당자, 거스름돈, 근무용 안경 위치, 오픈 절차, 재고 처리)
- 근무용 안경(#42): 트랜스크립트는 "안경을 쓰고 작업" 착용 지시만, 위치는 모호한 언급조차 없음 → sample-demo "창고 쪽" 방식(원문 표현 반영) 적용 대상 아님. 장비 표 위치를 `-`로
- "언급 없음"으로 표기하지 않고 **제거**한 이유: 표기해도 체크리스트 생성기가 "○○가 문서에 없다"를 사실로 분해 → 같은 결함 재발
- 머리말을 기준 문구로 교체. 동일 사본 3개(`-answer`·`-main`·`-merged`) 동기화. 정정 전 원본은 `private-data/golden/_archive/`에 백업
- 남긴 것: 절차 섹션의 채점자 메모 "⚠️ 일련번호 읽는 법 설명이 복잡…" (사실 주장 아님, 체크리스트로 분해된 적 없음)

**2. checklist #67 — 대상 정정 + 원인 확인**
- #67은 **sample-demo** 체크리스트 항목 (sample-01은 43개라 #67 없음 — 지시문의 파일명은 지난 보고의 sample-demo 건으로 해석)
- 원인 = **생성 프롬프트 쪽**: 정답 문서 문장은 `⚠️ 재고 부족 시 발주 방법 — "나중에 따로 말씀드릴게요"로 설명 누락`으로 "점장님 확인" 언급 없음. 프롬프트에 이미 "문서에 있는 것만, 추론·보완 금지" 규칙 존재. 직전 생성(46430d6)은 같은 문장을 "설명이 누락되어 있다"로 정확히 분해 → temperature 0에서도 윤색이 섞이는 생성 흔들림. 인접 항목 "보안 설정 (점장님께 첫날 요청)"의 표현이 번진 것으로 추정
- 조치: #67만 수동 정정 → "재고 부족 시 발주 방법은 설명이 누락되어 있으며, 인계자가 나중에 따로 알려주겠다고 했다" (critical 유지). 정답 문서 무수정
- ⚠️ 커밋된 `results/sample-demo-eval.*`(3-A③)은 정정 전 #67 기준 채점 — 재채점 안 함 (한도)

**3. 재채점** (`GOLDEN_DIR=./private-data/golden`, 산출물은 `private-data/output`·`results` — 비공개)
| 단계 | 결과 |
|---|---|
| `checklist -- sample-01-merged --force` | ✅ 33초, 43개 (critical 22), 부재형 사실 0개 |
| `convert -- private-data/golden/sample-01-merged.txt` | ✅ 68초, in=7423 out=4370 — **지시 외 필요 호출**: 이전 AI 문서가 어디에도 보존돼 있지 않아(output/은 커밋된 적 없음, 디스크 검색 0건) evaluate 전에 변환 필요. 여유 1회 사용 |
| `evaluate -- sample-01-merged` | ✅ 88초, in=12947 out=6055 |

**기존 vs 신규 (비공개 실데이터 sample-01-merged, 체크리스트 43개)**
| | 정정 전 (2026-06-12) | 정정 후 (2026-09-28) |
|---|---|---|
| 누락률 | 7.0% (3/43) | **0.0% (0/43)** |
| critical 누락 | 2 (거스름돈, 연락처 — 둘 다 부재형 항목) | **0** |
| 환각 | 0 | **1** |
| 체크리스트 | critical 21, 부재형 3개 포함 | critical 22, 부재형 0개 |

- 환각 1건: AI 문서 `미해결`의 "배너(할인 행사) 안내 내용이 영상에서 명확히 설명되지 않았음, 별도 확인 필요". 심판 근거 문장은 "불확실성 명시 = [확인 필요] 표시이므로 환각 아님, supported=true로 판정"인데 **판정값은 unsupported** → 판정·근거 불일치. `ClaimJudgmentSchema`가 `supported`를 `evidence`보다 먼저 생성하는 구조(확인). 집계 규칙대로 1건으로 기록, 수정 안 함
- 비교 한계: 정답 정정 + 체크리스트 재생성(부재 3개 제거 외 19개 문장 재서술·분해 변화) + AI 문서 재생성이 동시에 바뀜 → 정답 정정의 순효과는 분리 불가. 표본 1개·1회
- 기타: 이 트랜스크립트는 `참석자 1 00:01` 형식이라 파서가 타임스탬프를 인식 못 하고 세그먼트 1개로 처리 (6월과 동일 조건, 기존 동작)

### ~~📌 공식 수치~~ → 세션 3-A⑤에서 최종본으로 대체 (아래 수치는 이력)
- **비공개 실데이터 매장 샘플 1건 (sample-01, 본 영상 + 보완 2클립), 체크리스트 43개: 누락률 0.0%, critical 누락 0, 환각 1 (심판 판정-근거 불일치 1건)** — 2026-09-28, 정답 문서 작성 기준 정정 후
- 인용 시 함께 밝힐 것: 표본 1개, 비공개 골든셋 기준, 정답 정정 이력(`docs/eval-methodology-notes.md` #2). 이전 7.0%는 정답 결함 포함 수치로 폐기
- sample-demo(공개 가상) 점수는 인용 금지 (Phase 3 규칙)

**4. 문서화**
- `docs/eval-methodology-notes.md` 신규: 결함 #1(네거티브 테스트로 심판 결함 발견, 세션 1-8)과 #2(정답 문서 결함 → 기준 수립 → 재채점)를 같은 형식으로 나란히 기록
- `golden/README.md`에 "정답 문서 작성 기준" 5개 항목
- CLAUDE.md 현재 단계의 sample-01 수치 갱신

### 개선 후보 (코드 수정 안 함)
1. **sample-demo 세척 약품 confidence**: 트랜스크립트 "그 뭐냐 창고 쪽에 있어요" → AI 문서는 위치 `창고`, confidence `high`. "쪽"의 모호함이 사라지고 needs_review 표시 없음. structure 프롬프트에 "모호한 위치 표현은 원문 그대로 + needs_review" 규칙 검토
2. **심판 판정-근거 불일치**: 스키마를 `evidence` → `supported` 순서로 바꾸거나 불일치 검사 추가 (채점 로직 변경 — 사용자 결정 필요, 변경 시 재현성 재검증)
3. **체크리스트 생성 윤색**: 사람 검토로 대응 중. 반복되면 생성 후 "정답 문서 문자열에 없는 명사구" 자동 경고 검토
4. **정답 문서 해석성 표현 (sample-01)**: "포장 시 영수증을 파우치에 동봉" — 트랜스크립트는 "영수증 반드시 뽑아서 드리고"로 동봉 여부는 해석. 이번 기준(공백)과 다른 유형이라 무수정, 사용자 검토 필요
5. **`참석자 N mm:ss` 트랜스크립트 형식 파싱**: 현재 파서 미지원 → sourceTimestamp 전부 null

### 커밋
- 코드 변경 없음. sample-01 정답·체크리스트·결과는 `private-data/`(gitignore)라 **공개 리포에 커밋하지 않음** — 지시의 "정답 문서·checklist 수정 / results 재채점 결과" 커밋 중 공개 가능한 것은 sample-demo #67 1건뿐
- 커밋 2개: ① sample-demo checklist #67 정정 ② 문서화(방법론 노트·golden README·CLAUDE.md·PROGRESS)

### API 사용 — 3/3회
- checklist 1 · convert 1 (지시 외, 위 사유) · evaluate 1

### 사용자가 할 일
- [ ] `private-data/`를 private 리포로 옮겨 이번 정정본·백업·결과 버전 관리 (현재 로컬에만 존재)
- [ ] 새 `sample-01-merged-checklist.json` 43개 검토 (#4·#36 출근 보고 채널 중복 서술 등)
- [ ] 개선 후보 2(심판 스키마 순서) 진행 여부 결정
- [ ] (선택) sample-demo 재채점 — #67 정정 반영 (API 1회, convert 결과 재사용 가능)

---

## 세션 3-A⑤: 심판 스키마 순서 수정 + 체크리스트 중복 병합 + 재채점 ✅ (2026-09-28)

> 지시: 심판 스키마에서 근거를 판정보다 먼저 생성하도록 필드 순서만 변경, sample-01 체크리스트 #4·#36 병합, 캐시된 변환 결과로 재채점. API 한도 2회.

### 완료한 것
**1. 스키마 순서** (공개 커밋 `659bd1f`)
- `lib/ai/eval-schema.ts`: `FactJudgmentSchema` `index→present→evidence` → `index→evidence→present`, `ClaimJudgmentSchema` `index→supported→evidence` → `index→evidence→supported`. judge 프롬프트·`eval-core` 집계 무변경
- 생성되는 JSON Schema에서 properties·required 순서가 `index, evidence, present/supported`로 바뀐 것 확인. typecheck·lint 0, vitest 113 통과

**2. 체크리스트 병합** (비공개 — 아래 "비공개 리포" 참고)
- #4 "출근 시 카카오톡 ○○ 채널에 '출근했습니다'를 전송해야 한다" vs #36 "출근 보고는 카카오톡 ○○ 채널에 한다" — 둘 다 critical·연락·보고. #4가 #36을 포함(시점·메시지 문구 추가)하고 트랜스크립트 발화와 직접 대응 → **#4 유지, #36 삭제**. 43→42개, critical 22→21
- 파일명 정정: 실제 파일은 `private-data/golden/sample-01-merged-checklist.json` (지시문의 `golden/sample-01-checklist.json` 아님). 같은 정답 문서를 쓰는 사본 `sample-01-checklist.json`·`-main-checklist.json`은 3-A④ 이전 버전(부재형 항목 포함)으로 남아 있었어서 현행본으로 동기화

**3. 재채점** — 변환 결과(`private-data/output/sample-01-merged.json`, 3-A④) 재사용, 새 체크리스트
- `GOLDEN_DIR=./private-data/golden npm run evaluate -- sample-01-merged` ✅ 85초, in=12915 out=5452

| | 3-A④ (순서 변경 전, 43개) | 3-A⑤ (순서 변경 후, 42개) |
|---|---|---|
| 누락률 | 0.0% (0/43) | **2.4% (1/42)** |
| critical 누락 | 0 | **0** |
| 환각 | 1 (판정·근거 모순) | **0** |
| inferred | 0 | 0 |

**4. 환각 1건 재현 여부 → 재현 안 됨**
- 이전 환각 항목(AI 문서 `미해결`: 할인 행사 배너 안내 내용이 영상에서 명확히 설명되지 않았다는 확인 요청)은 이번에 근거 있음으로 판정 → 스키마 순서 수정으로 해소된 것으로 보고 `docs/eval-methodology-notes.md` **결함 #3**으로 기록
- **새로 드러난 누락 1건** (비critical, 절차): "일련번호에서 숫자 부분은 모델 번호, 뒤의 문자는 색상 코드이다"
  - AI 문서: "…반대쪽에 일련번호(예: 숫자 4자리)와 색상 코드(예: 영문+숫자)가 표기되어 있다" — 숫자 부분을 "일련번호"라 부름, "모델 번호" 없음
  - 트랜스크립트: "일련 번호", "색상 번호"만 등장, **"모델" 0건** → 정답 문서의 해석 용어가 사실로 분해된 것
  - 순서 변경 전 심판은 "존재"로 판정, 근거 먼저 쓰게 하자 인용할 문장이 없어 "없음" → 순서 결함이 누락 과소 산정에도 작용했을 가능성 (1회라 흔들림과 분리 불가 — 한계로 기록)
  - 정답 문서 무수정 (지시 범위 밖, 사용자 결정)

### ~~📌 공식 수치 — 최종본~~ → 세션 3-A⑥에서 재현 2회 결과로 갱신 (아래는 1회차 이력)
- **비공개 실데이터 매장 샘플 1건(sample-01: 본 영상 + 보완 2클립), 체크리스트 42개 기준: 누락률 2.4% (1/42), critical 누락 0건, 환각 0건** — 2026-09-28, 세션 3-A⑤
- 조건: 변환 모델 claude-sonnet-4-6 · structure-v2 / 심판 judge-v1(근거→판정 순서) · temperature 0 / 채점 1회
- 인용 시 함께 밝힐 것: 표본 1개, 비공개 골든셋 기준, 채점 방법론 결함 2건을 찾아 고친 뒤의 수치(`docs/eval-methodology-notes.md` #2·#3). 이전 수치 7.0%·0.0%는 결함 포함으로 폐기
- 누락 1건은 정답 문서의 해석 용어("모델 번호") 때문 — 정답을 원문 표현으로 정정하면 0/42가 될 수 있으나 **정정 전까지는 2.4%가 공식**
- sample-demo(공개 가상) 점수는 인용 금지

### 비공개 리포 (판단)
- 지시의 "checklist 병합 / 재채점 결과" 커밋 대상 파일이 전부 `private-data/`(공개 리포 gitignore)라, **`private-data/` 안에 로컬 전용 git 저장소를 새로 만들어** 그곳에 커밋. 원격 없음·push 없음. 공개 리포는 이 폴더를 계속 무시
  - `9b87b09` baseline (3-A④ 종료 시점: 정정 정답·체크리스트·결과·_archive)
  - `be8fa3b` 체크리스트 #4·#36 병합 + 사본 동기화
  - (이번 결과) 재채점 결과 커밋 — 아래
- 이유: 이전 세션 TODO "private-data를 별도 private 리포로"의 로컬 단계이자, 변경 이력을 공개 없이 남기는 유일한 방법. GitHub private 원격 연결은 사용자 몫

### API 사용 — 1/2회
- evaluate 1. 여유 1회 미사용 (재현성 확인에 쓸 수 있었으나 지시상 버퍼로 남김)

### 사용자가 할 일
- [ ] `private-data/`에 GitHub **private** 원격 추가 후 push (`cd private-data && git remote add origin <private repo> && git push -u origin master`)
- [ ] 정답 문서의 해석 용어 처리 결정: "숫자 부분 = 모델 번호"·"00 + 모델번호 + 색상번호"(트랜스크립트엔 "일련 번호"), "포장 시 영수증 동봉" — 결함 #2 기준(원문 표현만)을 해석 용어까지 확장할지
- [ ] (선택) 재현성 확인: 같은 조건으로 evaluate 1회 더 (API 1회) → 누락 1·환각 0 재현 시 결함 #3 결론 확정

### 남은 것
- 개선 후보(3-A④ 목록) 중 1·3·5 유지. 2(심판 스키마 순서)는 이번에 해결

---

## 세션 3-A⑥: 채점 확정 · 이력 점검 (2026-09-29) — 3-A② 착수 전 선처리

**한 줄 요약: sample-01 동결, 동결 조건 2회차 재채점은 누락 0/42·critical 0·환각 0으로 1회차(1/42)와 경계 항목 1개만 다름 → 공식 수치 범위 표기. 지운 일련번호는 공개 이력에 커밋된 적 없음(기존 퍼지 계획으로 충분).**

- 동결: sample-01 정답 문서·체크리스트(42개) 수정 금지 — 이유·원칙은 `docs/eval-methodology-notes.md` #4
- 재채점 2회차 (API 1회, 99초, in=12915 out=6483): 항목 단위 비교 — 체크리스트 수·환각·inferred **동일**, 누락만 다름 ("일련번호 숫자 부분은 모델 번호, 뒤의 문자는 색상 코드" — 1회차 누락, 2회차 존재)
- 이력 점검: `git log --all -S`로 확인 — PROGRESS.md에서 지운 일련번호는 **커밋 이력에 없음**(커밋 전 삭제). 같은 값의 다른 이력 출현(골든셋·샘플 파일, tsbuildinfo, tests/mask.test.ts)은 `docs/publish-checklist.md`의 `--path`·`--replace-text`에 이미 포함 → 퍼지 절차 변경 없음
- private-data 로컬 커밋 추가 (push는 사용자)

### 📌 공식 수치 — 최종본 (README에 이 숫자를 인용)
- **비공개 실데이터 매장 샘플 1건(sample-01: 본 영상 + 보완 2클립), 체크리스트 42개, 채점 2회: 누락률 0.0~2.4% (0~1/42), critical 누락 0건, 환각 0건**
- 2회 중 차이는 경계 항목 1개(정답 문서의 해석 용어 "모델 번호")뿐. 정답·체크리스트 동결 상태
- 조건: 변환 claude-sonnet-4-6·structure-v2(변환 결과 1회 고정) / 심판 judge-v1·근거→판정 순서·temperature 0
- 인용 시 함께 밝힐 것: 표본 1개, 비공개 골든셋 기준, 채점 방법론 결함 3건 수정 후 수치(`docs/eval-methodology-notes.md`). 이전 7.0%·0.0%(단일)·2.4%(단일)는 대체됨. sample-demo·TTS 테스트 결과는 인용 금지

---

## 세션 3-A②: Inngest 전환 · 실패/진행 UX · 관측 ✅ (2026-09-29)

> 지시: Inngest 전환(단계별 step), 실패·진행 UX, Sentry·Analytics, e2e 배포 URL 모드. API 한도 16회(0번 재채점 1 포함).
> 0번(채점 확정·이력 점검)은 위 "세션 3-A⑥"에 선처리·기록.

### 완료한 것
**1. Inngest 작업 큐** (`5fbd876`)
- `lib/pipeline/run.ts` 공용 오케스트레이터 + `steps.ts` 단계 구현 — inline(after 훅)·Inngest가 **같은 단계 함수·같은 상태머신** 사용
- 단계: `prepare` → `extract-audio`(실측 길이 비용 가드 → mp3 → 10분 청크 → Storage 임시 저장) → `stt-N`(청크마다 step) → `save-transcript`(병합·마스킹·upsert·임시 청크 삭제) → `keyframes` → `structure`(스트리밍) → `match-keyframes` → `enrich` → `finish`
- Inngest 설정: `retries: 3`, `concurrency { limit: 1, key: event.data.userId }`, `idempotency: event.data.runKey`(최초 `videoId:initial`, 재시도 `videoId:retry-<시각>`), `checkpointing: false`(요청 1회 = 단계 1개), `maxDuration = 300`
- 사용자용 실패(플랜 한도·손상 파일 등)는 발생 지점에서 사유 기록 후 `NonRetriableError`(재시도 없음). 그 외는 단계 재시도 3회 후 `onFailure` → failed + 일반 안내 + Sentry. 실패 사유는 기존 `videos.error_message`에 저장(별도 failure_reason 컬럼 대신 — 이미 화면 표시 중인 사용자용 필드)
- 임시 오디오 청크: 성공·onFailure·NonRetriable·inline 실패 모든 경로에서 삭제 + cron이 하루 지난 `.audio/` 청크와 30일 삭제 대상 영상의 청크 정리
- 재시도: 트랜스크립트가 있으면 STT 건너뛰고 구조화부터(재과금 없음). 중복 클릭은 `status='failed'` 조건부 update로 1건만 통과
- `HANDOVER_QUEUE=inline` 유지(기본 inngest). 운영 env 검증: Inngest 키 필수, **운영에서 `INNGEST_DEV` 설정 금지**(서명 검증 꺼짐 방지)
- `supabase/migrations/0009_video_stage.sql` — `videos.stage`(세부 단계), 쓰기 service_role 전용, ALL_MIGRATIONS 합본 반영
- `POST /api/pipeline/start` — completeUpload와 같은 `startPipeline`만 호출

**2. 실패·진행 UX** (`bf5e0a5`)
- 프로젝트 상세: 업로드 → 음성 인식(청크 진행률 "음성 인식 2/3") → 구조화 → 보강 질문, 남은 예상 시간, 실패 지점 빨간 표시 + 기존 사유·"재시도" 버튼
- stage 컬럼이 없어도 화면이 깨지지 않게 조회 폴백(status만으로 단계 표시)
- 폴링: 3초 → 1.5배 백오프 최대 15초, 상태·stage·사유 변화 시 리셋, 탭 숨김 시 중지·복귀 시 즉시 조회

**3. 관측** (`cb9fe55`)
- `@sentry/nextjs` 11: DSN 있을 때만 초기화(서버 `instrumentation.ts`, 브라우저 `instrumentation-client.ts` 동적 import), `onRequestError`, error.tsx capture, 파이프라인 최종 실패 전송(+flush)
- `@vercel/analytics`: layout에 `<Analytics />`

**4. e2e·검증 도구** (`8fa11c8`)
- `E2E_BASE_URL`(로컬 dev·배포 공용): 테스트 유저 로그인 → 업로드 → `/api/pipeline/start` → 상태·단계 폴링 → done·트랜스크립트·문서 스키마·보강 질문·사용량 로그·**임시 청크 잔여 0** 검증. `E2E_FILE`·`E2E_PAID` 옵션
- `scripts/make-tts-video.ps1`: 가상 sample-demo 대본 한국어 TTS(1회분 444.7초) 반복 → 1280×720 정지 화면 mp4. 산출물 `output/tts/`(gitignore)

**테스트**: vitest **133 통과**(오케스트레이션 순서·STT 건너뛰기·실패 전파, runKey, 재시도 중복 클릭 경합, 진행 표시·백오프, env) / 통합(실 DB): startPipeline 타 사용자 거부·소유자 1건 전송 통과, RLS 16/17 (실패 1 = stage 케이스, 0009 미적용). **0007·0008은 적용 확인됨**(3-A① 결제 우회 등 4건 이제 통과)

### 로컬 Inngest 검증 (inngest-cli dev + next dev)
| 시나리오 | 결과 |
|---|---|
| B. 2분 영상 + `HANDOVER_STT=mock` | STT 단계 4회(1+재시도 3) 실패 → onFailure → failed + 일반 안내, 임시 청크 0개, 실측 길이 120초 기록 ✓ |
| B'. 30분 영상 + 무료 플랜 | extract-audio 1회만 → 비용 가드 NonRetriable → 5초 만에 failed + "실제 영상 길이 기준 20분 초과 … 업그레이드" ✓ |
| C1. 30분 영상 + 유료 + 실 Groq | **Groq 401 Invalid API Key** → STT 실패 → failed (키 무효, 과금 없음 — 아래 사용자 할 일) |
| C 재시도 #1 (TTS 원문 트랜스크립트 주입 + 모델 404 강제) | prepare → **STT 단계 없음** → keyframes → structure 404×4 → failed ✓ |
| C 재시도 #2 (정상 모델) | prepare → keyframes → structure → match → enrich → **done 122초** ✓ |
| A. sample-demo.txt, 앱 경유(`/api/pipeline/start`) | done 112초, 문서 스키마 ✓, 보강 질문 7개, 사용량 로그 2종, 임시 청크 0개 ✓ |

- C 재시도용 트랜스크립트: Groq 키가 무효라 STT 대신 **TTS가 읽은 원문 그대로**(1회분 34세그먼트 × 약 4.05회 = 139세그먼트·11,482자, 타임스탬프는 1회분 444.7초에 맞춰 환산)를 주입해 "STT 완료 후 구조화 실패" 상황을 재현. 재시도 트리거는 retryVideo와 같은 `claimAndEnqueueRetry` + 이벤트 전송(진단 스크립트, 커밋 안 함)

### 단계별 실측 시간 — 300초(maxDuration) 대비
> ⚠ **TTS 합성 영상 결과는 처리 시간·청크 분할·타임아웃 검증 전용. STT 정확도·문서 품질 지표로 PROGRESS.md·README에 인용 금지.**

| 단계 | 실측 (로컬) | 300초 대비 사용 | 여유율 |
|---|---|---|---|
| prepare | 0.1~0.2초 | 0.1% | 99.9% |
| **extract-audio** (30분 영상 → mp3 → 청크 3개 업로드) | **7.4초** | 2.5% | **97.5%** |
| **stt-N (가장 긴 청크)** | **미실측** — Groq 키 무효(401) | — | — |
| keyframes (30분 1280×720) | 5.0~6.9초 | 2.3% | 97.7% |
| **structure** (30분 분량 11,482자 트랜스크립트) | **94.5초** (sample-demo txt: 92.6초) | **31.5%** | **68.5%** |
| enrich | 14.6~17.5초 | 5.8% | 94.2% |
| match-keyframes / finish / save-transcript | 0.03~0.3초 | ~0% | ~100% |

- 가장 긴 단계는 구조화(94.5초) — **Vercel Hobby에서 Fluid Compute가 꺼져 있으면(60초 한도) 실패**. Fluid Compute(300초)면 여유 68.5%
- 한계: 로컬 PC 측정(Vercel 함수 CPU·네트워크와 다름). 합성 영상이 15MB(정지 화면)라 실제 폰 영상(수백 MB~1GB+)의 다운로드·디코딩·메모리 부담은 반영 안 됨 — extract-audio·keyframes는 실제 파일에서 훨씬 길어질 수 있음. STT 미실측

### API 사용 — 과금 5회 / 한도 16
- 과금: 0번 재채점 1 · A 구조화+보강 2 · C 재시도 #2 구조화+보강 2
- 과금 없음(요청 거부): Groq 401 × 4, 존재하지 않는 모델 404 × 8(단계 4회 × structure.ts 2회)

### 스스로 내린 판단과 이유
1. **Groq 키 무효 → STT 실측 대신 TTS 원문 주입으로 나머지 경로 검증** — 키가 트림해도 401(형식은 정상 `gsk_`)이라 코드·파싱 문제가 아님. 새 키 없이 STT를 잴 방법이 없어, 재시도·구조화·키프레임·타임아웃 검증을 우선하고 STT 실측은 사용자 할 일로
2. **`checkpointing: false`** — Inngest v4 기본은 여러 단계를 한 HTTP 요청에 이어 실행(최대 10초 + 진행 중 단계). 끄면 요청 1회 = 단계 1개라 "단계 시간 ≤ maxDuration" 검증이 정확해짐. 대가: 짧은 단계도 요청이 따로 발생
3. **오디오는 항상 10분 청크로 분할** — 기존은 25MB 이하면 통째로 STT 1회. 청크마다 step이어야 단계 시간이 영상 길이와 무관하게 상한을 가짐. Groq 과금은 초 단위라 비용 차이 미미, 청크 경계에서 단어가 잘릴 수 있는 점은 한계
4. **운영 `INNGEST_DEV` 금지 검사 추가**(지시 외) — 문서화 중 발견: dev 모드는 서명 검증을 꺼서, 운영에 잘못 설정되면 누구나 `/api/inngest`로 단계 실행 가능
5. **`failure_reason` 대신 기존 `error_message`** — 이미 사용자용 문구로 화면에 표시되는 필드. 새 컬럼은 마이그레이션·조회 폴백만 늘림
6. **`next dev`가 CLAUDE.md에 "Next.js agent rules" 블록을 자동 추가하고 `next-env.d.ts`를 dev 경로로 변경** → 둘 다 원복(커밋 안 함). CLAUDE.md는 사용자 지시 파일이라 유지 여부는 사용자 결정
7. **Sentry 소스맵 업로드(`withSentryConfig`) 생략** — auth token 필요·빌드 시간 증가. 스택은 압축 코드 기준으로 보임

### 새 화면 문구 — 사용자 검토 필요
- 단계: "업로드" · "음성 인식" · "구조화" · "보강 질문" / 세부: "변환 대기 중" · "오디오 추출 중" · "음성 인식 N/M" · "화면 캡처 추출 중" / 예상: "1분 안팎 남음" · "약 N분 남음" / 스크린리더: "완료" · "진행 중" · "실패" · "대기"
- "변환 작업을 시작하지 못했습니다. '다시 시도'를 눌러 주세요." / "재시도할 수 있는 영상이 아닙니다." / "이미 재시도 중입니다." / "videoId(UUID)가 필요합니다."
- env 안내(운영 로그): "Inngest 키 필요: …" · "운영에서 INNGEST_DEV를 설정하면 안 됩니다 …"

### 사용자가 할 일
- [ ] **순서 주의: Supabase SQL Editor에서 `0009_video_stage.sql` 실행 → 그 다음 push·배포** (코드는 컬럼이 없어도 status만으로 동작하지만, 세부 단계 표시·RLS 테스트는 0009 필요) → `npm run test:integration` 17/17 확인
- [ ] **Groq API 키 재발급** (현재 키 401) → `.env`·Vercel 환경변수 갱신 → STT 실측: `npx inngest-cli@latest dev -u http://localhost:3010/api/inngest` + `INNGEST_DEV=1 npm run dev` 후 `E2E_BASE_URL=http://localhost:3010 E2E_FILE=output/tts/tts-30min.mp4 E2E_PAID=1 npm run e2e` (영상은 `powershell -File scripts/make-tts-video.ps1`로 생성)
- [ ] **Vercel Inngest Integration 설치** → `INNGEST_EVENT_KEY`·`INNGEST_SIGNING_KEY` 자동 주입 → 배포 후 Inngest 대시보드에서 앱 sync(`https://<도메인>/api/inngest`)
- [ ] **Vercel Hobby: Fluid Compute 활성 여부 확인** (Project Settings > Functions). 꺼져 있으면 60초 한도라 구조화(실측 94.5초) 단계 실패
- [ ] **실결제 오픈 전 Vercel Pro 전환** — Hobby는 비상업용 약관
- [ ] Sentry 프로젝트(Next.js) 생성 → `SENTRY_DSN`·`NEXT_PUBLIC_SENTRY_DSN` 설정 (소스맵까지 원하면 `withSentryConfig` + `SENTRY_AUTH_TOKEN` 요청)
- [ ] Vercel 대시보드 Analytics 탭에서 Web Analytics 활성화
- [ ] `next dev` 실행 시 CLAUDE.md에 자동 추가되는 Next.js agent-rules 블록을 커밋할지 결정 (안 하면 dev 실행 때마다 변경으로 남음)
- [ ] 배포 후 확인: `E2E_BASE_URL=https://<도메인> npm run e2e`
- [ ] (이월) private-data 로컬 커밋 push (`cd private-data && git push`)

### 남은 것
- 대용량 실영상 리스크: 영상 전체를 메모리로 받는 구조 → 1GB급 폰 영상은 Vercel 메모리·`/tmp`(512MB) 한도 위험 (스트리밍 다운로드·클라이언트 오디오 추출 검토)
- **폰 영상 업로드 한도 (확인됨, 미착수)**: 폰 영상(수백 MB~1GB)은 Supabase 용량 한도·서버 메모리 한도에 걸림. 실측: 100MB 영상 업로드 시 HTTP 400. 해결 방향(기존 결정): 브라우저 ffmpeg.wasm으로 오디오 추출 + 프레임 캡처 후 그 결과만 전송(원본 영상 미전송). 착수 시점: 에이전트 확장(10/8) 이후. 코드 수정 없음(기록만)
- STT 단계 실측·예상 시간 계수 보정, `enrich` 스트리밍 전환 여부(현재 15~18초라 불필요), `middleware`→`proxy` 전환
- Phase 3 나머지: 샘플 체험 동선, 모바일·PWA·Lighthouse, CI, 약관·계정 삭제, README

## Groq 401 진단 (2026-09-29, 진단 전용·코드 수정 없음)
- 키 출처: 프로세스/사용자/시스템 환경변수 GROQ_API_KEY·HANDOVER_STT 모두 미설정. `.env`(26행)만 존재 (`.env.local`·`.env.development` 없음). Next(@next/env)는 `KEY = value` 공백 형식도 파싱 → 로드 정상. inngest-cli는 .env를 안 읽음(STT는 next dev 프로세스에서 실행)
- 후보 간 불일치 없음(후보 1개): `gsk_Qw…` 길이 57 (공백·따옴표·BOM·비ASCII 없음). HANDOVER_STT=groq
- getSttProvider → GroqStt 선택. 요청 호스트는 코드 하드코딩 `https://api.groq.com/openai/v1/audio/transcriptions` (다른 호스트 아님)
- GET api.groq.com/openai/v1/models: **HTTP 401** (Groq 호출 2/3회 사용. 1회는 스크립트 정규식 오류로 빈 키 전송돼 무효 → 유효 진단은 2회차)
- 결론: `.env`의 GROQ_API_KEY 자체를 Groq 서버가 거부(폐기·오타·불완전 복사). 코드·로딩·호스트 문제 아님. 길이 57은 Groq 통상 키(56자)보다 1자 많아 복사 오류 가능성
- 사용자 할 일: console.groq.com/keys에서 새 키 발급 → `.env` 26행 `GROQ_API_KEY=gsk_…` 교체(공백 없이) → Vercel 환경변수 갱신 → dev 재시작
## mov 업로드 400 수정 (2026-09-29)
- 원인: videos 버킷 allowed_mime_types에 `video/quicktime` 없음 (0002). 사용자가 대시보드에서 수동 추가함
- 조치: `0010_videos_mime_quicktime.sql` (update + array_append, 이미 있으면 무변경 → 재실행 안전) + ALL_MIGRATIONS.sql 반영. **사용자 할 일: 0010 실행(수동 추가분과 충돌 없음)**
- 테스트: mov `ftyp qt  ` 브랜드 서버 매직바이트 통과 추가 (vitest 13 pass)
- 허용 형식 대조 (버킷 / 클라이언트 / 서버):
  - 확장자 mp4·mov·webm·m4a·txt: 클라이언트 accept, upload-actions 문구, `ALLOWED_EXTS`·안내 문구 모두 일치
  - **불일치 1** `scripts/e2e-pipeline.ts:28` .mov를 `video/mp4`로 전송(우회) — 실제 브라우저는 `video/quicktime` 전송, e2e는 이 경로 미검증
  - **불일치 2 (가능성)** m4a: 브라우저별 `file.type`이 `audio/x-m4a`·`audio/mp4` 외에 `audio/m4a`일 수 있음 → 버킷 목록에 없으면 400. 미확인, 실제 m4a 업로드로 확인 필요
  - **불일치 3** 카메라 촬영 input `accept="video/*"`는 확장자 제한 없음 → 기기가 다른 컨테이너(예: 3gp) 촬영 시 서버 확장자 검사에서 거부(문구는 한국어 안내)
  - 버킷 MIME에 `application/octet-stream` 포함이라 file.type이 빈 값이어도 통과
- 폰 영상 서버 메모리 한도 → 위 "남은 것"에 기록됨 (ffmpeg.wasm 방향, 10/8 이후)

### 갱신: 500MB 한도 반영 (2026-09-29, 위 mov 절 대체)
- 사용자가 대시보드에서 videos 버킷 2GB → **500MB**, 전역 한도 500MB로 변경 (비용 상한 + 서버 메모리 보호)
- `0010_videos_mime_quicktime.sql` 확장: MIME(`video/quicktime`) 추가 + `file_size_limit=524288000` update (재실행 안전). ALL_MIGRATIONS.sql 동기화. **사용자 할 일: 0010 실행**
- 코드 일치화: `lib/upload-validate.ts` `MAX_UPLOAD_BYTES`(500MB) 단일 출처 + `oversizeMessage()` (서버 검사·클라이언트 공용). `VideoUploader`는 업로드 **전** 파일 크기 검사 → 초과 시 "파일이 너무 큽니다 (N MB, 최대 500MB). 영상을 짧게 나눠 촬영·업로드하거나 해상도를 낮춰 다시 저장하세요." 표시. `ScreenRecorder`도 녹화 blob 업로드 전 검사
- 테스트: mov `ftyp qt  ` 통과, 500MB 경계(정확히 500MB 통과·+1 거부), oversizeMessage (vitest 전체 136 pass, tsc 0 오류)
- 새 문구 — 사용자 검토 필요: 업로더 안내 "파일당 최대 500MB" 추가(기존 문구에 덧붙임), 용량 초과 안내 2종(영상/txt)
- 남은 불일치(미수정): e2e-pipeline .mov를 video/mp4로 전송, m4a `audio/m4a` MIME 가능성, 카메라 input `video/*` 확장자 무제한
- 화면 녹화(webm)는 500MB 초과 시 업로드 전 거부됨 — 장시간 녹화 시 결과 손실 가능(녹화 중 용량 경고는 미구현)

### 남은 것 추가
- **폰 영상(수백 MB~1GB) 대응**: 500MB 한도로 대용량 폰 영상은 거부됨. 해결 방향(기존 결정): 브라우저 ffmpeg.wasm 오디오 추출 + 프레임 캡처 후 그 결과만 전송(원본 미전송). 에이전트 확장(10/8) 이후 착수

### 갱신: 0010 확장·e2e MIME·카메라 accept 결정 (2026-09-29, API 실호출 0회)
- 0010에 `audio/m4a` 추가 (video/quicktime과 같은 방식: 이미 있으면 건너뜀) + 500MB 한도 유지. ALL_MIGRATIONS.sql 동기화
- `scripts/e2e-pipeline.ts`: `.mov` → `video/quicktime` (실제 브라우저와 동일, m4a는 이미 `audio/mp4`)
- 500MB 초과 테스트: mp4·mov·webm·m4a 모두 서버 검사(`validateUploadedObject`)·클라이언트 가드(`oversizeMessage`) 양쪽 거부 (클라이언트·서버가 같은 함수 공용)
- **결정: 카메라 촬영 input `accept="video/*"` 유지** — 형식을 좁히면 일부 안드로이드에서 카메라가 열리지 않을 위험. 촬영 결과가 미허용 컨테이너(3gp 등)면 서버 확장자 검사에서 한국어 안내와 함께 거부됨
- **사용자가 할 일: Supabase SQL Editor에서 `0010_videos_mime_quicktime.sql` 실행** (video/quicktime·audio/m4a·500MB 한도, 재실행 안전)
- 새 문구 — 사용자 검토 필요 (위 500MB 절 목록과 동일): 업로더 "파일당 최대 500MB", 용량 초과 안내 2종

### 화면 녹화 결과 유실 방지 (2026-09-30, API 실호출 0회)
- **비트레이트**: `videoBitsPerSecond` 1.5Mbps + `audioBitsPerSecond` 64kbps = 1.564Mbps (`lib/recording-limits.ts`). 근거: 화면 녹화는 움직임이 적어 VP9 1.5Mbps로 1080p 글씨가 읽히는 수준을 목표로 잡음(실기 화질 확인은 사용자 몫)
  - 20분: 1.564Mbps × 1200s ÷ 8 = 234.6MB(224MiB) → 한도 500MiB의 45%
  - 30분: 1.564Mbps × 1800s ÷ 8 = 351.9MB(336MiB) → 한도의 67% (비트레이트는 목표값이라 장면 전환 시 초과 가능 — 여유 33% + 자동 정지로 대비)
- **누적 용량 감시**: timeslice 1초 청크 크기를 합산 → 80%(400MiB) 경고 문구, 95%(475MiB) 자동 정지. 자동 정지는 정상 종료와 같은 경로(onstop → 업로드)
- **유실 방지**: 업로드 흐름의 어떤 실패(용량 초과·prepareUpload 거부·네트워크 오류·completeUpload 실패)든 녹화본을 state에 보존하고 "녹화본 내려받기"·"버리기" 표시. 보존 중엔 새 녹화 시작 비활성(조용한 덮어쓰기 방지)
- 순수 함수 `estimateBytes`·`evaluateRecording` vitest 10개 추가 (경계 80%·95%, 20/30분 ≤ 한도)
- 한계: 업로드 중 탭을 닫거나 새로고침하면 메모리의 녹화본은 사라짐(beforeunload 경고는 미구현)
- 새 문구 — 사용자 검토 필요: "용량 한도(500MB) 직전이라 녹화를 자동 종료했습니다. 지금까지의 녹화를 업로드합니다." / "녹화 용량이 한도(500MB)의 80%에 도달했습니다. 곧 자동 종료되니 마무리하세요." / "녹화본은 삭제되지 않았습니다. 내려받아 보관한 뒤 파일 선택으로 업로드하거나 나눠서 다시 녹화하세요." / 버튼 "녹화본 내려받기"·"버리기"

### 날짜 KST 표시 통일 · 녹화 이탈 경고 (2026-09-30, API 실호출 0회)
- 원인: 서버(Vercel, UTC)에서 `toLocaleString("ko-KR")`를 timeZone 없이 사용 → 9시간 이르게 표시
- 표시 지점(전수 grep, 6곳): 프로젝트 목록 생성일, 프로젝트 상세(영상·문서 생성 시각 2곳), 결제 내역, 공유 링크 만료일(ShareControls, 클라이언트). docx·PDF·공유 뷰·이메일에는 날짜 표시 코드 없음
- 조치: `lib/format-date.ts` (`formatDate`·`formatDateTime`, Asia/Seoul) 로 6곳 통일. 저장은 UTC 유지
- **표기 변경(사용자 검토 필요)**: 시각은 "2026. 9. 30. 15:05" (24시간제, 초 없음). 기존 `toLocaleString("ko-KR")`은 Node ICU에 따라 "AM/PM" 표기가 나오는 등 환경별로 달라서 `formatToParts`로 직접 조립
- 테스트: `vitest.config.ts`에서 `TZ=UTC` 고정 + `tests/format-date.test.ts` (UTC 15:30→KST 다음날 00:30, 날짜 경계 등)
- cron(30일 삭제) 확인: 기준 시각이 `Date.now() - 30일`(epoch ms)→`toISOString()`(UTC)이고 스토리지 파일도 epoch ms 비교 → 시간대 영향 없음. 수정 불필요. (vercel.json 스케줄은 UTC 기준 — "매일 자정"은 KST 09:00 실행. 무영향이나 참고)
- 녹화 이탈 경고: `ScreenRecorder`에 업로드 중·녹화본 보존 중 `beforeunload` 경고 추가. 문구는 브라우저 기본(커스텀 불가). 녹화 중(recording)은 미포함 — 요청 범위 밖
