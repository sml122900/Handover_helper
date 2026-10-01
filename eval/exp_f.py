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
        # 도구 문항 제외: 09-30 기준선에는 D3 도구 계획 호출이 없었다 (비교 보정용)
        "cost_no_tool": float(np.mean([r["rec"]["cost_usd"] for r in rows if r["q"]["type"] != "tool"])),
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
    """측정한 점 사이를 직선으로 이어 y가 처음 target 이상이 되는 x (측정 범위 안에서만, 외삽하지 않음).
    첫 점부터 이미 target 이상이면 xs[0], 끝까지 넘지 않으면 None."""
    if ys[0] >= target:
        return float(xs[0])
    pts = list(zip(xs, ys, strict=True))
    for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
        if y1 >= target > y0:
            return x0 + (target - y0) / (y1 - y0) * (x1 - x0)
    return None


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--rag", required=True)
    ap.add_argument("--full", required=True)
    ap.add_argument("--reference", default=None, help="참고 열 (판정·교차점에 쓰지 않음). 예: RAG 통합 노드")
    ap.add_argument("--scale", action="append", default=[], help='"배수=라벨:번호" (사실 20문항 실행)')
    args = ap.parse_args()

    gold = {q["id"]: q for q in R.load_golden()}
    rag_name, rag_runs = load_spec(args.rag, gold)
    full_name, full_runs = load_spec(args.full, gold)
    rag = [run_stats(r) for r in rag_runs]
    full = [run_stats(r) for r in full_runs]
    ref_name, ref = None, None
    if args.reference:
        ref_name, ref_runs = load_spec(args.reference, gold)
        ref = [run_stats(r) for r in ref_runs]

    def cells(ms: list[dict] | None, key: str, fmt: str | None = None) -> str:
        if ms is None:
            return "-"
        vals = [m[key] for m in ms]
        f = fmt or "{}"
        return (
            " / ".join(f.format(v) for v in vals)
            + f" (평균 {(fmt or '{:.1f}').format(float(np.mean(vals)))})"
        )

    def row(label: str, key: str, fmt: str | None = None) -> str:
        cols = [cells(rag, key, fmt), cells(full, key, fmt)] + ([cells(ref, key, fmt)] if ref else [])
        return f"| {label} | " + " | ".join(cols) + " |"

    L = [
        f"# 실험 F 컨텍스트 방식: RAG vs 매장 원문 전체 ({date.today().isoformat()})",
        "",
        "> 판정은 채택이 아니라 비교 보고다: 현재 규모에서 어느 쪽이 나은가, 몇 배부터 역전되는가.",
        "",
        "## 조건별 3회 값 (실행 1·2·3 / 평균)",
        "",
        f"| 지표 | {rag_name} | {full_name} |" + (f" 참고: {ref_name} |" if ref else ""),
        "|---|---|---|" + ("---|" if ref else ""),
        row("답변 정확도(주) 문항 완전 /25", "acc_full"),
        row("└ 사실 20문항 문항 완전 /20", "f20_full"),
        row("└ 사실 20문항 정답 사실 /22", "f20_facts"),
        row("근거 충실도 위반 문항 /35 (낮을수록 좋음)", "unfaithful"),
        row("거절 정확도 /10", "refusal"),
        row("질문당 Claude 비용 (실측, 캐시 반영)", "cost", "${:.4f}"),
        row("└ 도구 5문항 제외 (09-30 기준선엔 도구 계획 호출 없음)", "cost_no_tool", "${:.4f}"),
        row("질문당 비용 — 캐시 없다고 가정", "cost_nocache", "${:.4f}"),
        f"| 캐시 쓰기·읽기 토큰 (실행 합계) | - | {' / '.join(f'{m["cache_write"]:,}·{m["cache_read"]:,}' for m in full)} |"
        + (" - |" if ref else ""),
        row("지연 p50 (ms)", "p50", "{:.0f}"),
        row("지연 p95 (ms) — 목표 8000", "p95", "{:.0f}"),
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
    for label, key in (
        ("지연 p50 (ms)", "p50"),
        ("질문당 비용 ($)", "cost"),
        ("질문당 비용, 도구 문항 제외 ($)", "cost_no_tool"),
    ):
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
                return f"측정 범위({xs[-1]}배) 안에서 역전 없음"
            return f"약 {x:.1f}배" if x > xs[0] else f"{xs[0]}배에서 이미 RAG 이상"

        L += [
            "",
            "- 전체 컨텍스트가 RAG(3회 평균)보다 비싸지거나 느려지는 배수 (측정한 점 사이 직선 보간, 외삽 없음): "
            f"질문당 비용 실측 {fx(cross_cost)}, 캐시 적중 질문만 {fx(cross_warm)}, 지연 p50 {fx(cross_p50)}. "
            "배수별 1회·20문항이라 거친 추정이다. 정확도는 추이만 본다",
        ]
    out = ROOT / "eval" / "results" / f"{date.today().isoformat()}-exp-F.md"
    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
