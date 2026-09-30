"""조건 간 누락 유형 전후 비교 (API 0회): 검색은 적중했는데 답변에서 빠진 정답 사실을 miss_analysis.py의 규칙으로 유형별로 센다.

사용: uv run --directory agent python ../eval/miss_compare.py "기준선(v1)=baseline:0,baseline:1,baseline:2" "개선(v2)=expD-v2-1:0,expD-v2-2:0,expD-v2-3:0"
주의: 사람이 보정한 MANUAL 표는 기준선 실행 1·2에만 있고, 여기서는 모든 실행에 규칙만 적용해 조건 간 공정하게 비교한다.
"""

import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "eval"))

import miss_analysis as M  # noqa: E402
import numpy as np  # noqa: E402


def load(label: str) -> dict:
    files = sorted((ROOT / "eval" / "results").glob(f"*-{label}.json"))
    return json.loads(files[-1].read_text(encoding="utf-8"))


def count(spec: str, gold: dict) -> dict:
    types, lens, faith, per_run = Counter(), [], Counter(), []
    for item in spec.split(","):
        label, idx = item.rsplit(":", 1)
        rows = load(label)["runs"][int(idx)]
        n = 0
        for r in rows:
            q, ev, rec = gold[r["id"]], r["eval"], r["record"]
            if q["type"] in ("fact", "time") and rec["answer"]:
                lens.append(len(rec["answer"]))
            if q["type"] in ("fact", "time"):
                hit = ev.get("retrieval_final") if q["type"] == "fact" else ev.get("tool_evidence_hit")
                for fid, covered in ev["fact_covered"].items():
                    if covered or not hit.get(fid):
                        continue
                    fc = next(x for x in ev["accuracy_detail"]["facts"] if x["fact_id"] == fid)
                    t = M.classify(-1, r["id"], fid, fc, rec)[0]  # run=-1 → MANUAL 미적용(규칙만)
                    types[t] += 1
                    n += 1
            if ev.get("unfaithful"):
                faith["violations"] += len(ev["unsupported_claims"])
        per_run.append(n)
    return {
        "types": types,
        "answer_len": float(np.mean(lens)),
        "faith_claims": faith["violations"],
        "per_run": per_run,
    }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    gold = {
        q["id"]: q
        for q in (
            json.loads(x) for x in (ROOT / "eval" / "golden.jsonl").read_text(encoding="utf-8").splitlines()
        )
    }
    conds = {}
    for spec in sys.argv[1:]:
        name, body = spec.split("=", 1)
        conds[name] = count(body, gold)
    names = list(conds)
    L = [
        "## 누락 유형 전후 (검색 적중했는데 답변에서 빠진 정답 사실, 3회 합산, 규칙 분류)",
        "",
        "| 유형 | " + " | ".join(names) + " |",
        "|---|" + "---|" * len(names),
    ]
    for k, label in M.TYPES.items():
        L.append(f"| {label} | " + " | ".join(str(conds[n]["types"].get(k, 0)) for n in names) + " |")
    L.append(
        "| **합계** | "
        + " | ".join(f"{sum(conds[n]['types'].values())} (실행별 {conds[n]['per_run']})" for n in names)
        + " |"
    )
    L.append(
        "| 사실·시각 답변 평균 길이(자) | "
        + " | ".join(f"{conds[n]['answer_len']:.0f}" for n in names)
        + " |"
    )
    L.append(
        "| 근거 충실도 위반 문장 수(3회 합산) | "
        + " | ".join(str(conds[n]["faith_claims"]) for n in names)
        + " |"
    )
    text = "\n".join(L) + "\n"
    out = ROOT / "eval" / "results" / f"{date.today().isoformat()}-exp-D-miss-types.md"
    out.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
