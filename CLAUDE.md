# CLAUDE.md — 프로젝트 컨텍스트

> 이 파일은 Claude Code가 항상 읽는 프로젝트 개요다. 

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---
# Role & Tone: Caveman Mode (Extreme Conciseness)
- Speak like a caveman: Remove all fluff, pleasantries, introductory, and concluding remarks.
- Do not say "Sure, I can help with that" or "Here is the solution."
- Eliminate articles (a, an, the) and filler words where possible, but maintain precise technical/coding terms.
- Focus ONLY on the core answer, solution, or code snippet.

# Core Rules:
1. Maximize brevity. If a 100-word explanation can be done in 10 words, use 10 words.
2. Provide code immediately without explaining why you wrote it, unless explicitly asked.
3. Use inline comments inside the code for minimal context rather than writing separate text blocks.
4. When explaining a bug or logic, use ultra-short bullet points (e.g., "Problem: state mutates. Fix: use setState.").

# Goal: 
- Reduce output token usage by 70%+. 
- Deliver immediate value without making me read a textbook.

---

프로젝트: Handover (인수인계 영상 → 문서 변환 SaaS)
한 줄 정의
인수인계 영상(화면 녹화·실물 촬영·음성)을 업로드하면 STT → AI 구조화를 거쳐
"후임자가 읽고 바로 일할 수 있는" 인수인계 문서를 생성하는 웹 서비스.
사무직뿐 아니라 매장·현장직·알바 인수인계가 핵심 —
화면 밖 실물 업무(포스기, 재고, 장비)를 영상으로 문서화하는 것이 차별점.
핵심 원칙 (모든 작업에서 지킬 것)

환각 금지가 제품의 생명: AI 변환 결과에 영상에 없는 내용을 절대 지어내지 않는다.
불확실한 정보는 [확인 필요] 마커로 표시하는 로직을 항상 유지한다.
AI 보완 허용 원칙 — 설명이 서툴러 생략된 단계를 AI가 추론으로 채울 수 있다.
단 반드시 inferred: true로 표시하고 에디터에서 [AI 보완] 라벨 + 작성자 확인을 요구한다.
라벨 없는 추론 삽입은 환각으로 간주한다.
솔로 운영 가능한 단순함: 의존성 최소화, 관리형 서비스 우선, 직접 운영하는 서버 금지.
MVP 범위 엄수: 팀 워크스페이스, 실시간 녹음, 다국어, 모바일 앱은 만들지 않는다.
요청받지 않은 기능을 추가하지 말 것.
비용 가드: STT/LLM 호출 전 영상 길이를 검사하고 플랜별 분 제한을 강제한다.

기술 스택 (변경 시 반드시 사용자에게 확인)

프론트/백엔드: Next.js 14+ (App Router), TypeScript strict
DB/Auth/Storage: Supabase (Postgres, Auth, Storage)
녹화: 브라우저 MediaRecorder API (화면+마이크), 설치형 앱 없음
STT: OpenAI Whisper API (한국어) — 추후 국내 STT로 교체 가능하도록 인터페이스 분리
구조화 AI: Anthropic Claude API (claude-sonnet-4-6), JSON 스키마 출력 — `HANDOVER_MODEL` env로 override 가능
키프레임 추출: ffmpeg (장면 전환 감지), 서버리스 함수에서 실행
에디터: Tiptap
배포: Vercel + Supabase. 영상 처리 등 장시간 작업은 큐 기반 비동기 (Supabase Edge Functions 또는 Inngest)
결제: 토스페이먼츠 (건당 결제 우선)

도메인 모델 (핵심 엔티티)

Project: 인수인계 1건. 여러 영상이 하나의 프로젝트에 속함
Video: 업로드된 영상. status: uploaded → transcribing → structuring → done/failed
Transcript: STT 결과 (타임스탬프 포함 세그먼트 배열)
Document: 구조화된 문서. 아래 8개 섹션의 고정 스키마
Keyframe: 영상에서 추출된 화면 캡처 (타임스탬프, 이미지 URL)

문서 스키마 (고정 — 임의 변경 금지. 직종 보편형 v2, 2026-06-11 개편)

업무 개요 (요약, 주기, 중요도)
절차 (단계별, 키프레임 이미지 연결 가능)
장비·위치·물품 (포스기·재고·도구 등 실물. 비밀번호류는 자동 마스킹)
일정·루틴
연락·보고 (이름, 역할, 연락 수단, 요청/보고 관계)
예외 상황·꿀팁
주의사항
미해결·인계 항목

각 항목은 sourceTimestamp (원본 영상 구간)와 confidence (high/needs_review) 필드를 가진다.
절차 항목은 추가로 inferred (AI 추론 보완 여부) 필드를 가진다
(전 항목에 두면 structured output grammar 한도 초과 — AI 보완 원칙 자체가 "생략된 단계" 보완이므로 절차 전용).
AI 파이프라인 규칙

트랜스크립트 → 문서 변환 프롬프트는 /lib/ai/prompts/ 에 버전 관리 (structure-v1.ts 형식)
LLM 출력은 반드시 zod 스키마로 검증. 파싱 실패 시 1회 재시도 후 failed 처리
변환 후 "보강 질문 생성" 단계: 비어있거나 confidence가 낮은 섹션에 대해 3~5개 질문 생성
모든 AI 호출은 토큰 사용량을 DB에 기록 (비용 추적)

코드 규칙

커밋은 작은 단위로, 한국어 커밋 메시지 OK
환경 변수는 .env.example에 항상 동기화
API 라우트는 zod로 입력 검증
테스트: AI 파이프라인 핵심 로직(스키마 검증, 마스킹, 비용 가드)은 vitest 단위 테스트 필수.
UI 테스트는 MVP에서 생략
에러는 사용자에게 한국어로, 구체적 원인과 다음 행동을 안내

보안·개인정보

영상 원본은 업로드 30일 후 자동 삭제 (Supabase Storage lifecycle 또는 cron)
트랜스크립트에서 비밀번호/주민번호 패턴 자동 마스킹 후 저장
공유 링크는 추측 불가능한 토큰 + 만료일 설정 가능

현재 단계 (2026-06-13)
Phase 0 + Phase 1 + Phase 2 일부(cron·랜딩·UI 다듬기) 완료.
- 스키마 v2 (직종 보편형) + structure-v2가 운영 기본. v1 대비: 누락 3.7%→0%, 환각 0 유지
- 채점: 체크리스트 기반, 재현성 검증 완료. inferred는 환각 아님(별도 집계)
- 마스킹 정책: 개인식별정보만 마스킹, 업무용 접근 정보(포스기PW·도어락)는 그대로
- 보강 질문 (enrich-v2): 업무 유형 추론 기반 누락 감지. 5~7개
- ffmpeg: serverExternalPackages로 번들 제외 완료. 33MB 영상 mp3 추출 확인
- STT: GROQ_API_KEY + HANDOVER_STT=groq → Groq Whisper 자동 선택
- sample-01 합산: 누락 7.0% (3/43), critical 2건, 환각 0 — 목표 <10% 달성
- structure-v2 nullable 필드 규칙 추가 → importance 환각 방지
- 배포 전 UI 다듬기: empty state·에러 한국어화·retry 버튼·로딩 애니·테마·모바일 완료
- Phase 2-2: 영상 30일 자동 삭제 cron (vercel.json + /api/cron/cleanup-videos). CRON_SECRET 설정 필요
- Phase 2-3: 랜딩 페이지 개선 (pain point·how it works·features·CTA)
- 남은 것: ① Groq STT 실 영상 E2E 확인 ② Phase 0 본체 = 골든셋 10개 반복 ③ Phase 2-1 결제(토스페이먼츠) 미착수
- 상세 이력: PROGRESS.md