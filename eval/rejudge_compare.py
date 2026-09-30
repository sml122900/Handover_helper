"""보완된 채점 기준(결정 로그 2026-10-01)으로 재채점한 결과를 기존과 비교한다: 근거 충실도 위반 수 변화와 실험 판정 변화.

재채점 = 응답 재생성 없음, 정확도·근거 충실도만 새 기준으로 2회+다수결 재채점(출처·거절은 기존 결과 재사용).
실험 판정이 바뀌면 표시만 하고 결정은 대기한다.

실행: uv run --directory agent python ../eval/rejudge_compare.py
결과: eval/results/YYYY-MM-DD-rejudge-criteria-v2.{json,md}
"""

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "eval"))

import compare as C  # noqa: E402
import run as R  # noqa: E402


# 실험 정의: (이름, 종류, 기존 기준 조건, 기존 후보 조건들, 새 기준 조건, 새 후보 조건들)
def spec(labels: list[str], idx: int = 0) -> str:
    return ",".join(f"{label}:{idx}" for label in labels)


BASE_OLD_STABLE = "baseline-stable:0,baseline-stable:1,baseline-stable:2"
BASE_OLD_SINGLE = "baseline:0,baseline:1,baseline:2"
BASE_NEW = "baseline-stable-v2:0,baseline-stable-v2:1,baseline-stable-v2:2"
EXPERIMENTS = [
    (
        "D' 답변 프롬프트 v2 (기준선 대비)",
        "D",
        BASE_OLD_SINGLE,
        spec([f"expD-v2-{i}" for i in (1, 2, 3)]),
        BASE_NEW,
        spec([f"expD-v2-{i}-stable-v2" for i in (1, 2, 3)]),
    ),
    (
        "C 답변만 Sonnet·보조 노드 Haiku",
        "C",
        BASE_OLD_SINGLE,
        spec([f"expC-auxhaiku-{i}" for i in (1, 2, 3)]),
        BASE_NEW,
        spec([f"expC-auxhaiku-{i}-stable-v2" for i in (1, 2, 3)]),
    ),
    (
        "C 전 노드 Haiku",
        "C",
        BASE_OLD_SINGLE,
        spec([f"expC-haiku-{i}" for i in (1, 2, 3)]),
        BASE_NEW,
        spec([f"expC-haiku-{i}-stable-v2" for i in (1, 2, 3)]),
    ),
    (
        "G 충분성 판단 통합",
        "G",
        BASE_OLD_STABLE,
        spec([f"expG-int-{i}-stable" for i in (1, 2, 3)]),
        BASE_NEW,
        spec([f"expG-int-{i}-stable-v2" for i in (1, 2, 3)]),
    ),
]


def judge_pair(ref: list[dict], cand: list[dict], kind: str) -> dict:
    acc = [c["acc_full"] - r["acc_full"] for r, c in zip(ref, cand, strict=True)]
    fai = [c["unfaithful"] - r["unfaithful"] for r, c in zip(ref, cand, strict=True)]
    main_v = C.verdict(acc, True)
    side_ok = all(d < 2 for d in fai)
    if kind == "G":
        refusal_ok = all(c["refusal"] >= 10 for c in cand)
        no_worse = main_v != "악화" and side_ok
        gain = np.mean([c["cost"] for c in cand]) < np.mean([r["cost"] for r in ref]) or np.mean(
            [c["p50"] for c in cand]
        ) < np.mean([r["p50"] for r in ref])
        proposal = "채택 제안 조건 충족" if refusal_ok and no_worse and gain else "기본값 유지(미충족)"
    else:
        proposal = "채택 기준 충족" if main_v == "개선" and side_ok else "기본값 유지(미충족)"
    return {"acc_diffs": acc, "fai_diffs": fai, "main": main_v, "side_ok": side_ok, "proposal": proposal}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    gold = {q["id"]: q for q in R.load_golden()}
    L = [
        f"# 채점 기준 보완 재채점 ({date.today().isoformat()})",
        "",
        "- 보완 기준(결정 로그 2026-10-01): ① 빈도·금지·권고를 덧붙인 문장은 근거 없음 ② 정답 사실에 묶인 조건·주체 요소가 빠지면 포함 X",
        "- 재채점 방법: 응답 재생성 없음. 정확도·근거 충실도만 새 기준으로 2회+다수결 재채점, 출처 일치·거절은 기존 결과 재사용(프롬프트 미변경)",
        "- 기존 채점: 기준선 안정화 채점 / D'·C는 단일 채점 / G는 안정화 채점. 새 채점은 모두 안정화 + 보완 기준. (D'·C의 기존 단일 채점과 새 채점의 차이에는 안정화 효과도 섞여 있다)",
        "- **실험 판정이 바뀌어도 표시만 하고 결정은 대기한다.**",
        "",
    ]
    result: dict = {"experiments": []}
    cond_rows: list[str] = []
    verdict_rows: list[str] = []
    seen: dict[str, tuple[list[int], list[int], list[int], list[int]]] = {}

    def runs(spec_str: str) -> list[dict]:
        ms, _ = C.spec_runs(spec_str, gold)
        return ms

    for name, kind, ref_old, cand_old, ref_new, cand_new in EXPERIMENTS:
        ro, co, rn, cn = runs(ref_old), runs(cand_old), runs(ref_new), runs(cand_new)
        old, new = judge_pair(ro, co, kind), judge_pair(rn, cn, kind)
        changed = (old["main"], old["side_ok"], old["proposal"]) != (
            new["main"],
            new["side_ok"],
            new["proposal"],
        )
        for label, rs_old, rs_new in ((f"{name} — 기준", ro, rn), (f"{name} — 후보", co, cn)):
            key = label
            seen[key] = (
                [m["unfaithful"] for m in rs_old],
                [m["unfaithful"] for m in rs_new],
                [m["acc_full"] for m in rs_old],
                [m["acc_full"] for m in rs_new],
            )
            uo, un, ao, an = seen[key]
            cond_rows.append(
                f"| {label} | {uo} (합 {sum(uo)}) | {un} (합 {sum(un)}) | {sum(un) - sum(uo):+d} | {ao} → {an} |"
            )
        verdict_rows.append(
            f"| {name} | 주 {old['main']} {old['acc_diffs']} / 충실도 {old['fai_diffs']} → {old['proposal']} | "
            f"주 {new['main']} {new['acc_diffs']} / 충실도 {new['fai_diffs']} → {new['proposal']} | {'**바뀜**' if changed else '같음'} |"
        )
        result["experiments"].append({"name": name, "old": old, "new": new, "verdict_changed": changed})
    L += [
        "## 조건별 근거 충실도 위반 수 (실행 1·2·3, /35) 와 답변 정확도(주) 문항 완전 (/25)",
        "",
        "| 조건 | 기존 위반 | 새 기준 위반 | 합계 변화 | 답변 정확도(주) 기존 → 새 |",
        "|---|---|---|---|---|",
        *cond_rows,
        "",
        "## 실험 판정 변화 (표시만, 결정은 대기)",
        "",
        "| 실험 | 기존 판정 | 새 기준 판정 | 변화 |",
        "|---|---|---|---|",
        *verdict_rows,
    ]
    out = ROOT / "eval" / "results" / f"{date.today().isoformat()}-rejudge-criteria-v2"
    out.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    out.with_suffix(".md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
