"""채점기 흔들림 측정: 기준선 실행 1의 답변을 그대로 한 번 더 채점(응답 재생성 없음)해 지표별·문항별로 판정이 바뀐 수를 센다.

실행: uv run --directory agent python ../eval/judge_repeat.py [--label baseline] [--run 0]
결과: eval/results/YYYY-MM-DD-judge-variance.{json,md}, 2차 채점은 eval/results/.cache/{label}-judge2-evs.jsonl 에 문항별로 즉시 캐시
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "eval"))

from run import judge_eval, load_fact_texts, load_golden  # noqa: E402

from judge.groq import GroqJudge  # noqa: E402
from llm.client import CostTracker  # noqa: E402
from settings import get_settings  # noqa: E402

CACHE = ROOT / "eval" / "results" / ".cache"


def load(path: Path, run: int) -> dict:
    if not path.exists():
        return {}
    rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]
    return {r["id"]: r["data"] for r in rows if r["run"] == run}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="baseline")
    ap.add_argument("--run", type=int, default=0, help="기준선 실행 번호(0부터)")
    args = ap.parse_args()

    s = get_settings()
    assert s.groq_api_key, "GROQ_API_KEY 필요"
    tracker = CostTracker(None, "groq")
    judge = GroqJudge(s.groq_api_key, s.judge_model, tracker)
    fact_texts = load_fact_texts()
    golden = {q["id"]: q for q in load_golden()}
    recs = load(CACHE / f"{args.label}-recs.jsonl", args.run)
    first = load(CACHE / f"{args.label}-evs.jsonl", args.run)
    second_path = CACHE / f"{args.label}-judge2-evs.jsonl"
    second = load(second_path, args.run)

    for qid, q in golden.items():
        if q["type"] == "tool" or qid in second:
            continue
        second[qid] = judge_eval(q, recs[qid], judge, fact_texts)
        with second_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"run": args.run, "id": qid, "data": second[qid]}, ensure_ascii=False) + "\n")
        print(f"[재채점] {qid}", flush=True)

    metrics = {
        "답변 정확도(주, 문항 완전)": lambda e: e.get("accuracy_full"),
        "답변 정확도(보조, 문항 완전)": lambda e: e.get("accuracy_full_relevant"),
        "정답 사실별 포함(사실 단위)": None,
        "근거 충실도 위반": lambda e: e.get("unfaithful"),
        "거절 정확도": lambda e: e.get("refusal_correct"),
        "출처 일치(문항 내 지지 수)": lambda e: (e.get("citation_supported"), e.get("citation_pairs")),
    }
    result: dict = {"label": args.label, "run": args.run + 1, "judge_model": s.judge_model, "metrics": {}}
    for name, get in metrics.items():
        changed, total = [], 0
        for qid in second:
            a, b = first[qid], second[qid]
            if name.startswith("정답 사실별"):
                for f in a.get("fact_covered", {}):
                    total += 1
                    if a["fact_covered"][f] != b["fact_covered"].get(f):
                        changed.append(f"{qid}:{f}")
                continue
            va, vb = get(a), get(b)
            if va is None and vb is None:
                continue
            total += 1
            if va != vb:
                changed.append(qid)
        result["metrics"][name] = {"changed": len(changed), "total": total, "ids": changed}
    any_change = sorted({i.split(":")[0] for m in result["metrics"].values() for i in m["ids"]})
    result["questions_with_any_change"] = {"count": len(any_change), "total": len(second), "ids": any_change}
    result["cost_usd"] = round(tracker.run_cost, 4)

    lines = [
        f"# 채점기 흔들림 ({date.today().isoformat()})",
        "",
        f"- 기준선 실행 {result['run']}의 답변(응답 재생성 없음)을 같은 채점기({s.judge_model}, temperature 0)로 한 번 더 채점해 첫 채점과 비교",
        "- 결과 해석: 3회 실행 간 변동에서 이 값만큼은 채점기 변동으로 본다(에이전트 변동과 구분하는 근거)",
        "",
        "| 지표 | 바뀐 수 / 대상 | 바뀐 항목 |",
        "|---|---|---|",
    ]
    for name, m in result["metrics"].items():
        lines.append(f"| {name} | {m['changed']} / {m['total']} | {', '.join(m['ids']) or '-'} |")
    a = result["questions_with_any_change"]
    lines += [
        "",
        f"- 지표 중 하나라도 판정이 바뀐 문항: {a['count']} / {a['total']} ({', '.join(a['ids']) or '-'})",
        f"- 재채점 비용: ${result['cost_usd']} (Groq)",
    ]
    out = ROOT / "eval" / "results" / f"{date.today().isoformat()}-judge-variance"
    out.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    out.with_suffix(".md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
