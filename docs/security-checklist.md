# 보안·데이터 무결성 감사 (세션 3-A, 2026-09-27)

범례: ✅ 문제 없음 · ❌→✅ 발견 후 수정 · ⏳ 수정 코드 완료, 사용자 조치(마이그레이션 실행 등) 필요

## 1. RLS

| 항목 | 결과 | 내용 |
|---|---|---|
| 전 테이블 RLS 활성 | ✅ | projects·videos·transcripts·documents·keyframes·ai_usage_logs·share_links·payments·rate_limits |
| 다른 사용자 행 select/update/delete | ✅ | `npm run test:rls` 실 DB 검증: B→A의 5개 테이블 조회 0행, transcripts·ai_usage_logs·payments 0행, update·delete 무효, Storage 다운로드 불가 (10/10 통과) |
| **본인 행의 서버 전용 컬럼 쓰기** | ❌→⏳ | 행 단위 정책(`for all using owner`)은 컬럼을 막지 않음. 실 DB에서 재현 확인: ① `projects.plan`을 anon key로 `'paid'` 변경 = **결제 우회** ② paid 프로젝트 직접 생성 ③ `videos.storage_path`를 타인 파일로 변경 → 파이프라인(service_role)이 타인 영상 처리 = **교차 유출** ④ `keyframes.image_path` 임의 insert → 타인 이미지 서명 URL. 수정: `0008_rls_hardening.sql` (컬럼 단위 grant/revoke) + 서버 액션의 videos insert·재시도를 service_role로 이전. **0008 적용 전까지 test:rls 4건 실패** |
| 파이프라인 경로 방어 | ❌→✅ | `processVideo`가 `storage_path`가 `{owner_id}/{project_id}/`로 시작하는지 확인 (0008과 이중 방어) |

## 2. Storage

| 항목 | 결과 | 내용 |
|---|---|---|
| 버킷 private | ✅ | 실 DB 확인: videos·keyframes 모두 `public=false`. anon 목록 조회 0건, public URL 400 |
| 서명 URL 외 접근 경로 | ✅ | 업로드 = 서버 발급 signed upload URL(본인 폴더 정책), 다운로드 = service_role만 |
| 키프레임 프록시 `/api/keyframes/[id]` | ❌→✅ | 기존: 인증 없음(UUID만 알면 열람). 수정: 로그인 사용자 RLS 조회 **또는** `?share=토큰`(유효·미만료) + 키프레임이 그 문서 프로젝트 소속일 때만 서명 URL(300초). 실패는 모두 404 |
| 공유 뷰 이미지 | ❌→✅ | 공유 HTML의 `/api/keyframes/{id}` → `?share={token}` 자동 부착 |
| docx 내보내기 이미지 | ❌→✅ | 문서 content의 keyframeId는 사용자 편집 가능 → 같은 프로젝트 키프레임만 다운로드 (`keyframePathInProject`) |

## 3. 공유 토큰

| 항목 | 결과 | 내용 |
|---|---|---|
| 엔트로피 | ✅ | `crypto.randomBytes(32)` base64url (256bit) |
| 만료 서버 검증 | ✅ | 공유 페이지·키프레임 프록시 모두 서버 시각 기준 `expires_at` 비교 |
| 취소(revoke) | ✅ | 기존 `revokeShareLink` (행 삭제 → 즉시 무효) |

## 4. 업로드

| 항목 | 결과 | 내용 |
|---|---|---|
| 확장자 | ✅ | 서버 `prepareUpload`에서 화이트리스트 검사 (기존) |
| 매직 넘버 MIME | ❌→✅ | `completeUpload`에서 저장 객체 선두 16바이트 Range 조회 → ftyp/EBML/UTF-8 확인. 불일치면 객체 삭제 + failed + 안내 (`lib/upload-validate.ts`, vitest) |
| 용량 | ❌→✅ | 버킷 한도(2GB) + 서버에서 스토리지 메타데이터 크기 재확인 (txt 2MB) |
| 플랜 한도 | ❌→✅ | 기존: 클라이언트가 보낸 영상 길이로만 판정 → 조작 시 우회. 수정: 신고값은 UI 안내용, **ffmpeg 실측 길이로 STT 호출 전 재판정** → 초과 시 failed + 업그레이드 안내. 실측값을 `duration_seconds`에 기록 |

## 5. 인증 없는 경로

| 경로 | 결과 | 비고 |
|---|---|---|
| 서버 액션 전체 (`"use server"` 5개 파일) | ✅ | getUser 확인 또는 사용자 세션 클라이언트(RLS) 경유. share-actions·saveDocumentHtml·getVideoStatuses는 RLS로 비로그인 0행 |
| `/api/cron/cleanup-videos` | ✅ | `CRON_SECRET` Bearer |
| `/api/documents/[id]/export-docx` | ✅ | getUser + RLS |
| `/api/keyframes/[id]` | ❌→✅ | 위 2번 |
| `/share/[token]` | ✅ | 의도된 공개 (토큰 검증) |
| 클라이언트 번들 시크릿 | ✅ | `next build` 후 `.next/static` 21개 파일에서 SERVICE_ROLE·ANTHROPIC·TOSS_SECRET·GROQ 키 **값** 검색: 0건 |
| git 이력 시크릿 | ✅ | gitleaks 8.30.1 전 이력 0건, `.env` 커밋 이력 없음 |

## 6. 환경변수

| 항목 | 결과 | 내용 |
|---|---|---|
| zod 검증 | ❌→✅ | `lib/env.ts` + `instrumentation.ts`. production 부팅 시 누락이면 키 이름만 출력 후 `exit(1)`, dev는 경고, `next build`(`NEXT_PHASE=phase-production-build`)는 건너뜀. 로컬 `next start`로 실패/성공 양쪽 확인 |

## 7. 레이트리밋

| 항목 | 결과 | 내용 |
|---|---|---|
| AI 호출 사용자별 제한 | ❌→⏳ | `0007_rate_limits.sql` (Postgres 고정 윈도우 카운터, service_role RPC). 업로드 완료·재시도 = `pipeline` 20회/시간, 보강 답변 = `ai_edit` 60회/시간 (env로 조정). 마이그레이션 미적용·DB 오류 시 **허용(fail-open)** + 에러 로그 |

## 8. 에러 노출

| 항목 | 결과 | 내용 |
|---|---|---|
| 파이프라인 실패 사유 | ❌→✅ | 기존: `e.message` 그대로 DB·화면 (ffmpeg 경로, 외부 API 응답 포함 가능). 수정: `UserFacingError`만 노출, 그 외 일반 안내 + 서버 로그 |
| 서버 액션 DB 에러 문구 | ❌→✅ | keyframe-actions의 `error.message` 노출 제거 |
| 전역 error.tsx · not-found.tsx | ❌→✅ | digest만 표시, 스택 없음 |

## 미해결 / 후속
- 0007·0008 마이그레이션 실행 후 `npm run test:rls` 14/14 확인 (사용자)
- 서버 액션 입력 zod 검증은 부분적 (길이·범위 검사 수준) — CLAUDE.md "API 라우트 zod 검증" 전면 적용은 별도 세션
- `rate_limits` 오래된 행 정리 없음 (행 크기 작음, 필요 시 cleanup cron에 추가)
- `middleware` → `proxy` 파일 규칙 전환 (Next 16 deprecation 경고)
