"""실험 F 비교 보고 (설계 7-6): RAG vs 매장 원문 전체 컨텍스트(프롬프트 캐싱). 채택 판정이 아니라 비교 보고.

사용:
  uv run --directory agent python ../eval/exp_f.py \\
      --rag "RAG(기준선)=baseline-stable-v2:0,baseline-stable-v2:1,baseline-stable-v2:2" \\
      --full "전체 컨텍스트=expF-full-stable:0,expF-full-stable:1,expF-full-stable:2" \\
      --scale "2=expF-full-x2-subset-stable:0" --scale "5=expF-full-x5-subset-stable:0"
교차점의 1배는 --full 실행 1의 사실 20문항을 쓴다. 결과: eval/results/YYYY-MM-DD-exp-F.md
"""

import argparse
import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "eval"))

import compare as C  # noqa: E402
import run as R  # noqa: E402

PIN, POUT = 3.0, 15.0  # claude-sonnet-4-6 1M 토큰당 입력·출력 (두 조건 모두 전 노드 Sonnet)


def no_cache_cost(rec: dict) -> float:
    """같은 호출을 캐시 없이 보냈을 때의 비용 (캐시 쓰기·읽기 토큰을 일반 입력 단가로)."""
    tin = rec["input_tokens"] + rec.get("cache_write_tokens", 0) + rec.get("cache_read_tokens", 0)
    return (tin * PIN + rec["output_tokens"] * POUT) / 1_000_000


def other_store_citations(rec: dict) -> int:
    """답변이 인용한 근거 중 질문 매장이 아닌 근거 수 (교차점: 덧붙인 다른 매장 원문을 인용했는지)."""
    by_n = {e["n"]: e for e in rec["evidence"]}
    return sum(
        1
        for c in rec["citations"]
        if by_n.get(c["n"], {}).get("store_id", rec["store_id"]) != rec["store_id"]
    )


def run_stats(rows: list[dict]) -> dict:
    s = R.summarize(rows)
    recs = [r["rec"] for r in rows]
    aa, fa = s["answer_accuracy"], s["faithfulness"]
    lat = [r["latency_ms"] for r in recs]
    warm = [r["cost_usd"] for r in recs if r.get("cache_read_tokens") and not r.get("cache_write_tokens")]
    return {
        "n": len(rows),
        "acc_full": aa["questions_full"],
        "acc_n": aa["questions"],
        "f20_full": aa["fact20"]["questions_full"],
        "f20_facts": aa["fact20"]["covered"],
        "f20_facts_n": aa["fact20"]["facts"],
        "unfaithful": fa["answers_with_unsupported"],
        "unfaithful_n": fa["answers"],
        "refusal": s.get("refusal_accuracy", {}).get("correct"),
        "refusal_n": s.get("refusal_accuracy", {}).get("total"),
        "escalated": s["outcomes"].get("escalated", 0),
        "cost": float(np.mean([r["cost_usd"] for r in recs])),
        "cost_nocache": float(np.mean([no_cache_cost(r) for r in recs])),
        "cost_warm": float(np.mean(warm)) if warm else None,
        "cache_write": sum(r.get("cache_write_tokens", 0) for r in recs),
        "cache_read": sum(r.get("cache_read_tokens", 0) for r in recs),
        "p50": int(np.percentile(lat, 50)),
        "p95": int(np.percentile(lat, 95)),
        "other_store_cites": sum(other_store_citations(r) for r in recs),
    }


def load_spec(spec: str, gold: dict) -> tuple[str, list[list[dict]]]:
    name, body = spec.split("=", 1)
    runs = []
    for item in body.split(","):
        label, idx = item.rsplit(":", 1)
        runs.append(C.load_run(label, int(idx), gold)[1])
    return name, runs


def facts_only(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["q"]["type"] == "fact"]


def crossing(xs: list[float], ys: list[float], target: float) -> float | None:
    """최소제곱 직선 y = a + b·x가 target과 만나는 x (기울기가 0 이하이면 없음)."""
    b, a = np.polyfit(xs, ys, 1)
    return (target - a) / b if b > 0 else None


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rag", required=True)
    ap.add_argument("--full", required=True)
    ap.add_argument("--scale", action="append", default=[], help='"배수=라벨:번호" (사실 20문항 실행)')
    args = ap.parse_args()

    gold = {q["id"]: q for q in R.load_golden()}
    rag_name, rag_runs = load_spec(args.rag, gold)
    full_name, full_runs = load_spec(args.full, gold)
    rag = [run_stats(r) for r in rag_runs]
    full = [run_stats(r) for r in full_runs]

    def cells(ms: list[dict], key: str, fmt: str = "{}") -> str:
        vals = [m[key] for m in ms]
        return " / ".join(fmt.format(v) for v in vals) + f" (평균 {fmt.format(float(np.mean(vals)))})"

    L = [
        f"# 실험 F 컨텍스트 방식: RAG vs 매장 원문 전체 ({date.today().isoformat()})",
        "",
        "> 판정은 채택이 아니라 비교 보고다: 현재 규모에서 어느 쪽이 나은가, 몇 배부터 역전되는가.",
        "",
        "## 조건별 3회 값 (실행 1·2·3 / 평균)",
        "",
        f"| 지표 | {rag_name} | {full_name} |",
        "|---|---|---|",
        f"| 답변 정확도(주) 문항 완전 /25 | {cells(rag, 'acc_full')} | {cells(full, 'acc_full')} |",
        f"| └ 사실 20문항 문항 완전 /20 | {cells(rag, 'f20_full')} | {cells(full, 'f20_full')} |",
        f"| └ 사실 20문항 정답 사실 /22 | {cells(rag, 'f20_facts')} | {cells(full, 'f20_facts')} |",
        f"| 근거 충실도 위반 문항 /35 (낮을수록 좋음) | {cells(rag, 'unfaithful')} | {cells(full, 'unfaithful')} |",
        f"| 거절 정확도 /10 | {cells(rag, 'refusal')} | {cells(full, 'refusal')} |",
        f"| 질문당 Claude 비용 (실측, 캐시 반영) | {cells(rag, 'cost', '${:.4f}')} | {cells(full, 'cost', '${:.4f}')} |",
        f"| 질문당 비용 — 캐시 없다고 가정 | {cells(rag, 'cost_nocache', '${:.4f}')} | {cells(full, 'cost_nocache', '${:.4f}')} |",
        f"| 캐시 쓰기 / 읽기 토큰 (실행 합계) | - | {' / '.join(f'{m["cache_write"]:,}·{m["cache_read"]:,}' for m in full)} |",
        f"| 지연 p50 (ms) | {cells(rag, 'p50', '{:.0f}')} | {cells(full, 'p50', '{:.0f}')} |",
        f"| 지연 p95 (ms) — 목표 8000 | {cells(rag, 'p95', '{:.0f}')} | {cells(full, 'p95', '{:.0f}')} |",
        "",
        "## 쌍별 차이: 전체 컨텍스트 − RAG (실행 번호끼리)",
        "",
        "| 지표 | 쌍1 | 쌍2 | 쌍3 | 평균 |",
        "|---|---|---|---|---|",
    ]
    for label, key in (
        ("답변 정확도(주) 문항 완전 /25", "acc_full"),
        ("사실 20문항 문항 완전 /20", "f20_full"),
        ("근거 충실도 위반 /35", "unfaithful"),
        ("거절 정확도 /10", "refusal"),
    ):
        d = [full[i][key] - rag[i][key] for i in range(3)]
        L.append(f"| {label} | " + " | ".join(f"{x:+d}" for x in d) + f" | {np.mean(d):+.1f} |")
    for label, key in (("지연 p50 (ms)", "p50"), ("질문당 비용 ($)", "cost")):
        d = [full[i][key] - rag[i][key] for i in range(3)]
        rel = np.mean([full[i][key] for i in range(3)]) / np.mean([rag[i][key] for i in range(3)]) - 1
        L.append(
            f"| {label} | " + " | ".join(f"{x:+.4g}" for x in d) + f" | {np.mean(d):+.4g} ({rel:+.0%}) |"
        )

    # 교차점: 사실 20문항. 1배 = 전체 컨텍스트 실행 1, RAG 기준 = RAG 3회 사실 문항 평균
    rag_f = [run_stats(facts_only(r)) for r in rag_runs]
    pts = [(1, run_stats(facts_only(full_runs[0])))]
    for spec in args.scale:
        k, body = spec.split("=", 1)
        _, runs = load_spec(f"x={body}", gold)
        pts.append((int(k), run_stats(facts_only(runs[0]))))
    pts.sort(key=lambda p: p[0])
    rag_cost = float(np.mean([m["cost"] for m in rag_f]))
    rag_p50 = float(np.mean([m["p50"] for m in rag_f]))
    rag_acc = float(np.mean([m["f20_full"] for m in rag_f]))
    L += [
        "",
        "## 교차점 측정 (사실 20문항, 배수별 1회)",
        "",
        "| 컨텍스트 | 문항 완전 /20 | 정답 사실 /22 | 충실도 위반 /20 | 에스컬레이션 | 다른 매장 근거 인용 | 질문당 비용 실측 | 캐시 적중 질문만 | 캐시 없다고 가정 | 지연 p50 | 지연 p95 |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
        f"| RAG (3회 평균, 참고) | {rag_acc:.1f} | {np.mean([m['f20_facts'] for m in rag_f]):.1f} | {np.mean([m['unfaithful'] for m in rag_f]):.1f} | {np.mean([m['escalated'] for m in rag_f]):.1f} | - | ${rag_cost:.4f} | - | ${np.mean([m['cost_nocache'] for m in rag_f]):.4f} | {rag_p50:.0f} | {np.mean([m['p95'] for m in rag_f]):.0f} |",
    ]
    for k, m in pts:
        warm = f"${m['cost_warm']:.4f}" if m["cost_warm"] is not None else "-"
        L.append(
            f"| 전체 {k}배 | {m['f20_full']} | {m['f20_facts']} | {m['unfaithful']} | {m['escalated']} | {m['other_store_cites']} | ${m['cost']:.4f} | {warm} | ${m['cost_nocache']:.4f} | {m['p50']} | {m['p95']} |"
        )
    xs = [k for k, _ in pts]
    if len(xs) >= 2:
        cross_cost = crossing(xs, [m["cost"] for _, m in pts], rag_cost)
        warm_pts = [(k, m["cost_warm"]) for k, m in pts if m["cost_warm"] is not None]
        cross_warm = (
            crossing([k for k, _ in warm_pts], [v for _, v in warm_pts], rag_cost)
            if len(warm_pts) >= 2
            else None
        )
        cross_p50 = crossing(xs, [m["p50"] for _, m in pts], rag_p50)

        def fx(x: float | None) -> str:
            if x is None:
                return "배수에 따라 늘지 않음(교차 없음)"
            return f"약 {x:.1f}배" if x >= 1 else "1배 이하(현재 규모에서 이미 RAG가 낮음)"

        L += [
            "",
            "- 직선 근사(최소제곱, 배수 1·2·5)로 RAG 값과 만나는 배수: "
            f"질문당 비용(실측) {fx(cross_cost)}, 캐시 적중 질문만 {fx(cross_warm)}, 지연 p50 {fx(cross_p50)}. "
            "점 3개·1회 측정이라 거친 추정이다. 정확도는 외삽하지 않고 추이만 본다",
        ]
    out = ROOT / "eval" / "results" / f"{date.today().isoformat()}-exp-F.md"
    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
