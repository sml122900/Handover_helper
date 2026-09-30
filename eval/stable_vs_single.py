"""채점 안정화 효과: 기준선 3회를 새 방식(2회+다수결)으로 재채점한 결과와 기존 단일 채점 결과를 비교한다 (응답 재생성 없음).

실행: uv run --directory agent python ../eval/stable_vs_single.py [--label baseline]
결과: eval/results/YYYY-MM-DD-judge-stabilization.{json,md}
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "eval" / "results" / ".cache"


def load(path: Path) -> dict:
    if not path.exists():
        return {}
    rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]
    return {(r["run"], r["id"]): r["data"] for r in rows}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="baseline")
    args = ap.parse_args()
    single = load(CACHE / f"{args.label}-evs.jsonl")
    stable = load(CACHE / f"{args.label}-stable-evs.jsonl")
    keys = sorted(k for k in stable if k in single and stable[k])  # 채점 대상 문항(도구 문항은 빈 값)
    metrics = {
        "답변 정확도(주, 문항 완전)": lambda e: e.get("accuracy_full"),
        "답변 정확도(보조, 문항 완전)": lambda e: e.get("accuracy_full_relevant"),
        "정답 사실별 포함(사실 단위)": None,
        "근거 충실도 위반": lambda e: e.get("unfaithful"),
        "거절 정확도": lambda e: e.get("refusal_correct"),
        "출처 일치(지지 수, 쌍 수)": lambda e: (e.get("citation_supported"), e.get("citation_pairs")),
    }
    res: dict = {"label": args.label, "questions_compared": len(keys), "metrics": {}, "by_run": {}}
    per_q_changed: dict[tuple, set] = defaultdict(set)
    for name, get in metrics.items():
        changed, total = [], 0
        for k in keys:
            a, b = single[k], stable[k]
            if get is None:
                for f in a.get("fact_covered", {}):
                    total += 1
                    if a["fact_covered"][f] != b["fact_covered"].get(f):
                        changed.append(f"run{k[0] + 1}:{k[1]}:{f}")
                        per_q_changed[k].add(name)
                continue
            va, vb = get(a), get(b)
            if va is None and vb is None:
                continue
            total += 1
            if va != vb:
                changed.append(f"run{k[0] + 1}:{k[1]}")
                per_q_changed[k].add(name)
        res["metrics"][name] = {"changed": len(changed), "total": total, "ids": changed}
    for run in sorted({k[0] for k in keys}):
        ks = [k for k in keys if k[0] == run]
        res["by_run"][f"run{run + 1}"] = {
            "questions": len(ks),
            "questions_with_any_change": sum(1 for k in ks if per_q_changed[k]),
        }
    res["questions_with_any_change"] = sum(1 for k in keys if per_q_changed[k])

    # 안정화 채점 내부: 항목별로 2회가 엇갈려 3회째가 필요했던 비율
    third, calls = Counter(), Counter()
    cost = 0.0
    for k in keys:
        for item, v in stable[k].get("judge_votes", {}).items():
            calls[item] += 1
            third[item] += bool(v["third"])
        cost += stable[k].get("judge_cost_usd", 0.0)
    res["disagreement"] = {i: {"needed_third": third[i], "items": calls[i]} for i in calls}
    res["stable_judge_cost_usd"] = round(cost, 4)
    res["single_judge_cost_usd"] = round(sum(single[k].get("judge_cost_usd", 0.0) for k in keys), 4)

    L = [
        f"# 채점 안정화 효과 ({date.today().isoformat()})",
        "",
        f"- 기준선 {len({k[0] for k in keys})}회 × 채점 대상 문항의 응답을 그대로 두고 채점만 새 방식(모든 항목 2회 + 엇갈리면 3회째 다수결)으로 다시 했다. 비교 대상: {len(keys)}건",
        "- 이후 모든 실험 비교는 새 방식 기준이다 (결정 로그 2026-10-01).",
        "",
        "## 기존 단일 채점 대비 판정이 바뀐 수",
        "",
        "| 지표 | 바뀐 수 / 대상 | 바뀐 항목 |",
        "|---|---|---|",
    ]
    for name, m in res["metrics"].items():
        L.append(f"| {name} | {m['changed']} / {m['total']} | {', '.join(m['ids']) or '-'} |")
    L += [
        "",
        f"- 지표 중 하나라도 바뀐 문항: {res['questions_with_any_change']} / {len(keys)} ({', '.join(f'{r} {v["questions_with_any_change"]}/{v["questions"]}' for r, v in res['by_run'].items())})",
        "",
        "## 안정화 채점 내부 불일치율 (2회가 엇갈려 3회째가 필요했던 항목)",
        "",
        "| 항목 | 3회째 필요 / 전체 |",
        "|---|---|",
    ]
    L += [
        f"| {i} | {v['needed_third']} / {v['items']} ({v['needed_third'] / v['items']:.0%}) |"
        for i, v in res["disagreement"].items()
    ]
    L += [
        "",
        f"- 채점 비용(Groq): 단일 ${res['single_judge_cost_usd']} → 안정화 ${res['stable_judge_cost_usd']}",
    ]
    out = ROOT / "eval" / "results" / f"{date.today().isoformat()}-judge-stabilization"
    out.with_suffix(".json").write_text(
        json.dumps(res, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    out.with_suffix(".md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
