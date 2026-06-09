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
npm run dev    # http://localhost:3000 (Supabase 키 없으면 /login에 셋업 안내)
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
