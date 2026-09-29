# data/virtual — 가상 코퍼스 (가상 데이터)

**이 폴더의 모든 매장·인물·수치는 가상이다.** 실제 상호·주소·전화번호·비밀번호와 무관하며, 에이전트 평가용 테스트 데이터다. (실데이터는 `private-data/`, 이 폴더에서 사용하지 않음)

- `corpus-spec.md` — 사양(사실표·의도적 공백·일정표). 트랜스크립트·골든셋 정답의 유일한 기준
- `s1~s5.txt` — 트랜스크립트 (`[mm:ss]`, 표시 문구 없음 — 변환·위치 매핑에 영향 주지 않도록)
- `s1~s5.md` / `.json` — `npm run convert` 결과 (md 머리말·json `"virtual": true`로 가상 표시)
- `schedules.json` — 일정표·`step_id` (도구 `get_current_tasks`용)
- 위치 매핑: `eval/fact-spans.json` · 점검: `npx tsx scripts/check-corpus.ts`
