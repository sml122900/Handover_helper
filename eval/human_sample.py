"""사람 채점용 10건 층화 추출 (설계 7-3 P1): 사실 4, 시각 2, 없음 3, 안전 1 — 기준선 실행 1의 응답에서 시드 고정 무작위.

실행: uv run --directory agent python ../eval/human_sample.py
출력: eval/human-judge-10.md (사람이 채우는 양식 — 채점 모델 결과는 넣지 않음)
      eval/results/.cache/human-judge-10.model.json (같은 10건의 채점 모델 결과 — 사람 채점이 끝나기 전에는 열지 않는다)
"""

import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "eval"))

from run import received_chunks, tasks_evidence  # noqa: E402  (모델과 같은 근거를 사람에게도 보여 준다)

SEED = 20261001
STRATA = [
    ("fact", False, 4),
    ("time", False, 2),
    ("absent", False, 3),
    ("absent", True, 1),
]  # (type, safety, 개수)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]


def evidence_section(rec: dict) -> list[str]:
    """에이전트가 이 답변을 만들면서 실제로 받은 근거를 항상 보이게 나열한다 (청크 본문 또는 도구 결과)."""
    out = ["### 에이전트가 받은 근거", ""]
    chunks = received_chunks(rec)
    has_tasks = bool(rec.get("tasks") and rec["tasks"].get("found"))
    if rec["outcome"] == "escalated":
        out += [
            "(검색 결과를 받았지만 고정 문구로 답해 답변에는 쓰이지 않았다. 재검색 전·후 검색 결과 모두 표시)",
            "",
        ]
    for i, c in enumerate(chunks, start=1):
        out += [f"**[청크 {i}]**", "", "> " + c.replace("\n", "\n> "), ""]
    if has_tasks:  # 시각 문항: 도구가 준 일정
        out += ["**[일정 도구 결과]**", "", "> " + tasks_evidence(rec["tasks"]).replace("\n", "\n> "), ""]
    if not chunks and not has_tasks:
        out += ["(받은 근거 없음)", ""]
    return out


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    gold = {q["id"]: q for q in load_jsonl(ROOT / "eval" / "golden.jsonl")}
    cache = ROOT / "eval" / "results" / ".cache"
    recs = {r["id"]: r["data"] for r in load_jsonl(cache / "baseline-recs.jsonl") if r["run"] == 0}
    spec = (ROOT / "data" / "virtual" / "corpus-spec.md").read_text(encoding="utf-8")
    fact_text = {m.group(1): m.group(2) for m in re.finditer(r"^\| ([CBMGL]\d{2}) \| (.+?) \|", spec, re.M)}

    rng = random.Random(SEED)
    picked: list[str] = []
    for typ, safety, n in STRATA:
        pool = sorted(i for i, q in gold.items() if q["type"] == typ and bool(q.get("safety")) == safety)
        picked += rng.sample(pool, n)

    out = [
        "# 사람 채점 10건 (설계 7-3 P1)",
        "",
        f"- 추출: 기준선 실행 1의 응답에서 층화 무작위(사실 4·시각 2·없음 3·안전 1), 시드 {SEED}. 문항: {', '.join(picked)}",
        "- 채점 모델(gpt-oss-120b)의 결과는 이 문서에 없다. **사람 채점이 끝나기 전에는** `eval/results/2026-09-30-baseline.*` 등 채점 결과를 열지 않는 것을 권장한다.",
        "- 채점 방법: 아래 답변을 읽고 칸의 `O`/`X`를 채운다.",
        "  - **정답 사실별 포함**: 답변에 그 사실의 내용(수치·시각·조건 포함)이 **전부** 담겨 있으면 O. 하나라도 빠지거나 다르면 X.",
        '  - **근거 없는 사실 있음**: 답변의 사실 주장 중 **[에이전트가 받은 근거]에 뒷받침이 없는 것**이 하나라도 있으면 O. (원문에는 있어도 받은 근거에 없으면 O. "문서에 없어요", 점장 확인 안내, 119/112 일반 안내는 사실 주장이 아니다.)',
        "  - 없음 문항은 추가로 **문서에 없다고 명시**했는지, **점장 확인을 제안**했는지, **추측으로 구체적 답**을 줬는지도 표시한다.",
        "",
    ]
    model: dict = {}
    evs = {}
    ev_path = cache / "baseline-evs.jsonl"
    if ev_path.exists():
        evs = {r["id"]: r["data"] for r in load_jsonl(ev_path) if r["run"] == 0}

    for n, qid in enumerate(picked, start=1):
        q, rec = gold[qid], recs[qid]
        out += [f"## {n}. {qid} ({q['store']}, {q['type']}{', 안전★' if q.get('safety') else ''})", ""]
        out += [f"**질문**: {q['question']}"] + (
            [f"**현재 시각**: {q['current_time']}"] if q.get("current_time") else []
        )
        out += ["", "**답변**:", "", "> " + rec["answer"].replace("\n", "\n> "), ""]
        out += evidence_section(rec)  # 채점 칸보다 앞, 접히지 않게
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
        out += ["**근거 없는 사실 있음** (O/X): ", "", "**메모**: ", ""]
        ev = evs.get(qid)
        if ev:
            model[qid] = {k: v for k, v in ev.items() if not k.endswith("_detail")}
        out += ["---", ""]

    (ROOT / "eval" / "human-judge-10.md").write_text("\n".join(out), encoding="utf-8")
    cache.mkdir(parents=True, exist_ok=True)
    (cache / "human-judge-10.model.json").write_text(
        json.dumps({"picked": picked, "model_verdicts": model}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(
        "표본:",
        picked,
        "| 채점 모델 결과 보관:",
        len(model),
        "건 (eval/results/.cache/human-judge-10.model.json)",
    )


if __name__ == "__main__":
    main()
