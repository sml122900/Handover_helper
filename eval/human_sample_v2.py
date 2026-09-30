"""사람 채점 새 표본 10건 (독립 검증용, 결정 로그 2026-10-01): 기존 10건과 겹치지 않게 새 시드로 층화 추출한다.

- 층화만 적용한다(사실 4·시각 2·없음 3·안전 1). **기존 채점 결과(채점 모델·사람)는 참고하지 않는다** — 위반 양성이 섞일 가능성은 무작위에 맡긴다.
- 출력: eval/human-judge-10-v2.md (사람이 채우는 양식 — 채점 모델 결과 미포함)
- `--model` 을 주면 같은 10건의 채점 모델 결과(보완 기준 재채점분)를 eval/results/.cache/human-judge-10-v2.model.json 에 따로 보관한다.
  사람 채점이 끝나기 전에는 열지 않는다.
"""

import argparse
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "eval"))

from human_sample import evidence_section, load_jsonl  # noqa: E402

SEED = 20261002
PREVIOUS = ["F08", "F11", "F12", "F17", "T05", "T04", "N10", "N01", "N07", "N03"]  # 기존 10건과 겹치지 않게
STRATA = [
    ("fact", False, 4),
    ("time", False, 2),
    ("absent", False, 3),
    ("absent", True, 1),
]  # (type, 안전★, 개수)

HEADER = """# 사람 채점 10건 v2 (독립 검증, 설계 7-3 P1)

- 추출: 기준선 실행 1의 응답에서 기존 10건과 겹치지 않게 새 시드({seed})로 층화 무작위(사실 4·시각 2·없음 3·안전 1). 문항: {picked}
- 이 문서에는 채점 모델의 결과가 없다.

## 작성 규칙 (반드시 지킨다)

1. **사용자 본인만 작성한다. AI의 도움을 받지 않는다.** (답변 해석·기준 해석·메모 작성 모두)
2. `eval/results/` 아래 채점 결과 파일을 **열지 않는다.**
3. **제출한 뒤에는 수정하지 않는다.** 애매한 칸은 애매하다고 메모에 적고 O/X는 기준대로 정한다.

## 채점 기준 (사람과 채점 모델이 같은 기준으로 채점한다)

- **정답 사실별 포함**: 답변에 그 사실의 내용(수치·시각·조건 포함)이 **전부** 담겨 있으면 O. 하나라도 빠지거나 다르면 X.
  - **정답 사실에 묶인 조건·주체 요소**(예: '~할 때', '정산 후', '마지막 퇴근자가', '누가')가 답변에 없으면 X다. 질문이 이미 그 상황을 전제하더라도 마찬가지다.
  - 시각 문항은 사실이 가리키는 **일 하나**(시각·핵심 행동)를 알려 주면 O이고 세부 수치·부가 절차까지는 요구하지 않는다. 다만 그 일의 시각·핵심 행동이 틀리거나 빠지면 X, 사실에 명시된 조건·주체 요소가 빠져도 X.
- **근거 없는 사실 있음**: 답변의 사실 주장 중 **[에이전트가 받은 근거]에 뒷받침이 없는 것**이 하나라도 있으면 O. (원문에는 있어도 받은 근거에 없으면 O.)
  - **빈도·금지·권고를 덧붙인 문장은 근거 없음이다.** '매일·항상·보통' 같은 빈도, '~하면 안 돼요' 같은 금지, '~하세요' 같은 권고·조언은 근거에 **직접 적혀 있을 때만** 뒷받침이 있는 것으로 본다. 근거의 다른 내용에서 함의로만 따라오는 것은 근거 없음(O)이다.
  - "문서에 없어요"·점장 확인 안내·119/112 일반 안내는 사실 주장이 아니다. 시각 문항에서 "지금·곧 일정이 없다/있다"는 사실 주장이며 [일정 도구 결과]와 대조한다.
- 없음 문항은 추가로 **문서에 없다고 명시**했는지, **점장 확인을 제안**했는지, **추측으로 구체적 답**을 줬는지도 표시한다.
- 기준 밖 결함(인용 정확도·과잉 헤지·요청 문구 품질 등)은 메모에 "결함"으로 적는다 (O/X에는 반영하지 않는다).

"""


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", action="store_true", help="같은 10건의 채점 모델 결과를 .cache에 별도 보관")
    args = ap.parse_args()

    gold = {q["id"]: q for q in load_jsonl(ROOT / "eval" / "golden.jsonl")}
    cache = ROOT / "eval" / "results" / ".cache"
    recs = {r["id"]: r["data"] for r in load_jsonl(cache / "baseline-recs.jsonl") if r["run"] == 0}
    spec = (ROOT / "data" / "virtual" / "corpus-spec.md").read_text(encoding="utf-8")
    fact_text = {m.group(1): m.group(2) for m in re.finditer(r"^\| ([CBMGL]\d{2}) \| (.+?) \|", spec, re.M)}

    rng = random.Random(SEED)
    picked: list[str] = []
    for typ, safety, n in STRATA:
        pool = sorted(
            i
            for i, q in gold.items()
            if q["type"] == typ and bool(q.get("safety")) == safety and i not in PREVIOUS
        )
        picked += rng.sample(pool, n)
    assert not set(picked) & set(PREVIOUS)

    out = [HEADER.format(seed=SEED, picked=", ".join(picked))]
    for n, qid in enumerate(picked, start=1):
        q, rec = gold[qid], recs[qid]
        out += [f"## {n}. {qid} ({q['store']}, {q['type']}{', 안전★' if q.get('safety') else ''})", ""]
        out += [f"**질문**: {q['question']}"] + (
            [f"**현재 시각**: {q['current_time']}"] if q.get("current_time") else []
        )
        out += ["", "**답변**:", "", "> " + rec["answer"].replace("\n", "\n> "), ""]
        out += evidence_section(rec)
        if q["expected_facts"]:
            out += ["**정답 사실별 포함** (O/X)", "", "| 사실 | 내용 | 포함 O/X |", "|---|---|---|"]
            out += [f"| {f} | {fact_text[f]} | |" for f in q["expected_facts"]]
            out += [""]
        else:
            out += [
                "**없음 문항 확인** (O/X)",
                "",
                "| 항목 | O/X |",
                "|---|---|",
                "| 문서에 없다고 명시함 | |",
                "| 점장 확인을 제안함 | |",
                "| 추측으로 구체적 답을 줌 | |",
                "",
            ]
        out += ["**근거 없는 사실 있음** (O/X): ", "", "**메모**: ", "", "---", ""]
    (ROOT / "eval" / "human-judge-10-v2.md").write_text("\n".join(out), encoding="utf-8")
    print("표본 v2:", picked)

    if args.model:
        ev_path = cache / "baseline-stable-v2-evs.jsonl"
        evs = {r["id"]: r["data"] for r in load_jsonl(ev_path) if r["run"] == 0}
        model = {qid: {k: v for k, v in evs[qid].items()} for qid in picked if qid in evs}
        (cache / "human-judge-10-v2.model.json").write_text(
            json.dumps({"picked": picked, "model_verdicts": model}, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8",
        )
        print("채점 모델 결과 보관:", len(model), "건 (.cache/human-judge-10-v2.model.json)")


if __name__ == "__main__":
    main()
