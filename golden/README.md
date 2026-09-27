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
- `sample-demo` — 가상 카페 마감조 샘플. 누락 항목 4개를 의도적으로 포함 (정답 문서의 ⚠️). 데모 fixture로도 재사용

⚠️ 공개 샘플의 점수는 품질 지표로 인용하지 않는다. README·문서의 누락률 등 지표는 **비공개 골든셋(실제 매장 데이터)** 기준이다.

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
