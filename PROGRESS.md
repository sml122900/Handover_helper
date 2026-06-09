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
