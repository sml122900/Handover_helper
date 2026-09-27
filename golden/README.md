# golden/ — 채점용 골든셋 (공개)

## 파일 규칙 (`{name}` 기준)

| 파일 | 내용 |
|---|---|
| `{name}.txt` | 트랜스크립트 (`[mm:ss] 텍스트` 형식). 없으면 `samples/{name}.txt` 조회 |
| `{name}.md` | 사람이 작성한 정답 문서 |
| `{name}-checklist.json` | `npm run checklist`가 만든 원자적 사실 체크리스트 (캐시 — 채점 분모) |

`README.md`는 샘플 목록에서 제외된다.

## 공개 샘플
- `sample-handover` — 가상 사무직(뉴스레터 발송) 샘플
- `sample-demo` — 가상 카페 마감조 샘플. 설명을 미룬 항목 2개(발주 방법, 보안 설정)는 정답 문서 미해결 섹션에 ⚠️로 포함. 트랜스크립트에 언급 없는 공백(예: 시재 불일치 처리)은 정답에 넣지 않음 — 보강 질문 평가 대상. 데모 fixture로도 재사용

⚠️ 공개 샘플의 점수는 품질 지표로 인용하지 않는다. README·문서의 누락률 등 지표는 **비공개 골든셋(실제 매장 데이터)** 기준이다.

## 정답 문서 작성 기준 (세션 3-A④ — `docs/eval-methodology-notes.md` #2)
1. 트랜스크립트에 언급이 없는 공백은 정답에 넣지 않는다 (보강 질문의 몫)
2. 트랜스크립트에서 설명을 **미룬** 항목("나중에 알려드릴게요", "누구에게 물어보세요")은 `미해결`에 남긴다
3. 모호하게 언급된 정보는 원문 표현 그대로만 ("창고 쪽"). "불명확하다" 같은 메타 판단을 덧붙이지 않는다
4. "○○ 언급 없음" 표기도 금지 — 체크리스트 생성기가 부재 자체를 사실로 분해한다
5. 체크리스트 생성 후 사람 검토 필수 — 생성기가 정답에 없는 표현을 덧붙일 수 있음 (sample-demo #67 사례)

## 흐름
```
npm run convert -- golden/sample-demo.txt   # AI 문서 → output/sample-demo.json
npm run checklist -- sample-demo            # 정답 → 체크리스트 (검토 필수)
npm run evaluate -- sample-demo             # 채점 → results/sample-demo-eval.md
```

## 비공개 골든셋 (실데이터) 채점
실데이터는 리포에 없다 (`private-data/`, gitignore). 경로만 바꿔 같은 스크립트로 채점:
```
GOLDEN_DIR=./private-data/golden npm run convert -- private-data/golden/sample-01-merged.txt
GOLDEN_DIR=./private-data/golden npm run evaluate -- sample-01-merged
GOLDEN_DIR=./private-data/golden npm run compare -- structure-v2
GOLDEN_DIR=./private-data/golden npm run report
```
`GOLDEN_DIR`가 기본값(`./golden`)이 아니면 `output/`·`results/`도 그 상위 폴더(`private-data/output`, `private-data/results`)에 저장된다 — 심판 근거 인용에 실데이터 문장이 들어가므로 공개 경로에 남기지 않기 위함.
