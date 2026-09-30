"""조건 비교 (실험 D'·C): 조건당 3회 실행을 실행 번호끼리 짝지어 쌍별 비교와 3회 평균을 낸다.

판정 기준 (결정 로그 2026-10-01): 실행 i번째끼리 짝지어 **3쌍 모두 같은 방향으로 2문항 이상** 차이일 때만 개선/악화, 아니면 "차이 없음(오차 범위)".
곁 지표 조건: 근거 충실도 위반 문항 수가 어느 쌍에서도 2문항 이상 늘지 않을 것.

사용:
  uv run --directory agent python ../eval/compare.py --kind D \\
      --ref "기준선(v1)=baseline:0,baseline:1,baseline:2" --cand "개선(v2)=expD-v2-1:0,expD-v2-2:0,expD-v2-3:0"
조건 명세 = 결과 파일 라벨:실행번호 목록. 결과 파일은 eval/results/*-{라벨}.json (가장 최근).
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "eval"))

import run as R  # noqa: E402

NODES = ("classify", "retrieve", "sufficiency", "rewrite", "answer", "tasks_answer")


def find_results(label: str) -> Path:
    files = sorted((ROOT / "eval" / "results").glob(f"*-{label}.json"))
    if not files:
        raise FileNotFoundError(f"결과 파일 없음: {label}")
    return files[-1]


def load_run(label: str, idx: int, gold: dict) -> tuple[dict, list[dict]]:
    d = json.loads(find_results(label).read_text(encoding="utf-8"))
    rows = [{"q": gold[r["id"]], "rec": r["record"], "ev": r["eval"]} for r in d["runs"][idx]]
    return d["config"], rows


def metrics(rows: list[dict]) -> dict:
    s = R.summarize(rows)
    if not s.get("judged"):
        raise RuntimeError("채점이 끝나지 않은 실행입니다")
    aa, fa, rf = s["answer_accuracy"], s["faithfulness"], s["refusal_accuracy"]
    lb = s["latency_breakdown"]["nodes"]
    return {
        "acc_full": aa["questions_full"],
        "acc_full_n": aa["questions"],
        "acc_facts": aa["facts_covered"],
        "acc_facts_n": aa["facts"],
        "acc_rel_full": aa["relevant_only"]["questions_full"],
        "unfaithful": fa["answers_with_unsupported"],
        "unfaithful_n": fa["answers"],
        "refusal": rf["correct"],
        "refusal_n": rf["total"],
        "cls": s["classification"]["correct"],
        "cls_n": s["classification"]["total"],
        "recall": s["recall_at_5_fact20"]["final_facts_hit"],
        "recall_n": s["recall_at_5_fact20"]["facts"],
        "p50": s["latency_ms"]["p50"],
        "p95": s["latency_ms"]["p95"],
        "cost": s["cost_per_question_usd"]["mean"],
        "node_ms": {k: lb[k]["mean_ms"] for k in NODES if k in lb},
    }


def verdict(diffs: list[int], higher_is_better: bool) -> str:
    """3쌍 모두 같은 방향으로 2 이상 차이일 때만 개선/악화."""
    good = [d if higher_is_better else -d for d in diffs]
    if all(g >= 2 for g in good):
        return "개선"
    if all(g <= -2 for g in good):
        return "악화"
    return "차이 없음(오차 범위)"


def spec_runs(spec: str, gold: dict) -> tuple[list[dict], dict]:
    ms, cfg = [], {}
    for item in spec.split(","):
        label, idx = item.rsplit(":", 1)
        cfg, rows = load_run(label, int(idx), gold)
        ms.append(metrics(rows))
    return ms, cfg


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["D", "C", "G"], required=True)
    ap.add_argument("--ref", required=True, help='"이름=라벨:번호,라벨:번호,라벨:번호"')
    ap.add_argument("--cand", action="append", required=True)
    ap.add_argument("--title", default=None)
    ap.add_argument("--header", default=None, help="머리말로 넣을 추가 마크다운 파일 경로")
    args = ap.parse_args()

    gold = {q["id"]: q for q in R.load_golden()}
    conds: dict[str, list[dict]] = {}
    cfgs: dict[str, dict] = {}
    order: list[str] = []
    for spec in [args.ref, *args.cand]:
        name, body = spec.split("=", 1)
        conds[name], cfgs[name] = spec_runs(body, gold)
        order.append(name)
    ref = order[0]

    jv = ROOT / "eval" / "results"
    jv_files = sorted(jv.glob("*-judge-variance.json"))
    jvar = json.loads(jv_files[-1].read_text(encoding="utf-8")) if jv_files else None

    def n_runs(name: str) -> int:
        return len(conds[name])

    L = [
        f"# {args.title or {'D': "실험 D' 답변 프롬프트", 'C': '실험 C 모델 비교', 'G': '실험 G 충분성 판단 통합'}[args.kind]} ({date.today().isoformat()})",
        "",
    ]
    if args.header:
        L += [Path(args.header).read_text(encoding="utf-8").rstrip(), ""]
    L += ["## 설정", ""]
    for name in order:
        c = cfgs[name]
        L.append(
            f"- **{name}**: 모델 {c.get('agent_model')} · 답변 프롬프트 {c.get('prompt_version')} · 임베딩 {c.get('embedding')} · 채점 {c.get('judge_model')} · {n_runs(name)}회"
        )
    L += [
        "- 판정 기준(결정 로그 2026-10-01): 실행 번호끼리 짝지은 3쌍 **모두 같은 방향으로 2문항 이상** 차이일 때만 개선/악화, 그 외는 차이 없음(오차 범위). "
        "곁 지표: 근거 충실도 위반이 어느 쌍에서도 2문항 이상 늘지 않을 것",
    ]
    if jvar:
        ch = jvar["metrics"]
        L.append(
            "- 채점기 변동(같은 답변 재채점, 기준선 실행 1): "
            + ", ".join(f"{k} {v['changed']}/{v['total']}" for k, v in ch.items() if not k.startswith("출처"))
            + " — 3회 변동에서 이 값만큼은 채점기 변동으로 본다"
        )

    key_rows = [
        ("답변 정확도(주) 문항 완전 /25", "acc_full", True),
        ("답변 정확도(주) 사실 /33", "acc_facts", True),
        ("답변 정확도(보조) 문항 완전 /25", "acc_rel_full", True),
        ("근거 충실도 위반 문항 /35 (낮을수록 좋음)", "unfaithful", False),
        ("거절 정확도 /10", "refusal", True),
        ("분류 정확도 /40", "cls", True),
        ("Recall@5 사실20 (사실 22개)", "recall", True),
    ]
    L += [
        "",
        "## 조건별 3회 값 (실행 1·2·3 / 평균)",
        "",
        "| 지표 | " + " | ".join(order) + " |",
        "|---|" + "---|" * len(order),
    ]
    for label, key, _ in key_rows:
        cells = []
        for name in order:
            vals = [m[key] for m in conds[name]]
            cells.append(" / ".join(str(v) for v in vals) + f" (평균 {np.mean(vals):.1f})")
        L.append(f"| {label} | " + " | ".join(cells) + " |")
    for label, key, fmt in (
        ("지연 p50 (ms)", "p50", "{:.0f}"),
        ("지연 p95 (ms) — 목표 8000 미달", "p95", "{:.0f}"),
        ("질문당 Claude 비용 ($)", "cost", "{:.4f}"),
    ):
        cells = []
        for name in order:
            vals = [m[key] for m in conds[name]]
            cells.append(" / ".join(fmt.format(v) for v in vals) + f" (평균 {fmt.format(np.mean(vals))})")
        L.append(f"| {label} | " + " | ".join(cells) + " |")

    for name in order[1:]:
        L += [
            "",
            f"## 쌍별 비교: {name} − {ref}",
            "",
            "| 지표 | 쌍1 | 쌍2 | 쌍3 | 3회 평균 차이 | 판정 |",
            "|---|---|---|---|---|---|",
        ]
        k = min(n_runs(name), n_runs(ref))
        for label, key, hib in key_rows:
            diffs = [conds[name][i][key] - conds[ref][i][key] for i in range(k)]
            L.append(
                f"| {label} | "
                + " | ".join(f"{d:+d}" for d in diffs)
                + f" | {np.mean(diffs):+.1f} | {verdict(diffs, hib)} |"
            )
        c_ref = np.mean([m["cost"] for m in conds[ref]])
        c_new = np.mean([m["cost"] for m in conds[name]])
        p_ref = np.mean([m["p50"] for m in conds[ref]])
        p_new = np.mean([m["p50"] for m in conds[name]])
        L.append(f"| 질문당 비용 (평균) | | | | {c_new - c_ref:+.4f} ({(c_new / c_ref - 1):+.0%}) | 기록 |")
        L.append(f"| 지연 p50 (평균, ms) | | | | {p_new - p_ref:+.0f} ({(p_new / p_ref - 1):+.0%}) | 기록 |")
        acc = [conds[name][i]["acc_full"] - conds[ref][i]["acc_full"] for i in range(k)]
        fai = [conds[name][i]["unfaithful"] - conds[ref][i]["unfaithful"] for i in range(k)]
        main_v = verdict(acc, True)
        side_ok = all(d < 2 for d in fai)
        proposal = (
            "채택 기준 충족(제안)" if main_v == "개선" and side_ok else "채택 기준 미충족(제안: 기본값 유지)"
        )
        L += [
            "",
            f"- **{name}**: 주 지표(답변 정확도) {main_v}, 곁 지표(충실도 위반 2문항 이상 증가 없음) {'통과' if side_ok else '실패'} → {proposal}. 실제 기본값 채택은 사용자 결정",
        ]
        if args.kind == "G":
            # 필수 조건: 거절 정확도가 기준선(10/10)보다 한 번이라도 떨어지면 다른 지표와 무관하게 미채택
            ref_refusal = min(m["refusal"] for m in conds[ref])
            refusal_ok = all(m["refusal"] >= max(ref_refusal, 10) for m in conds[name])
            no_worse = main_v != "악화" and verdict(fai, False) != "악화"
            gain = (c_new < c_ref) or (p_new < p_ref)
            if not refusal_ok:
                g = "**미채택(필수 조건 실패: 거절 정확도가 10/10 아래로 떨어짐)** — 다른 지표와 무관"
            elif no_worse and gain:
                g = "채택 제안 조건 충족(거절 10/10 유지·정확도/충실도 악화 없음·비용 또는 지연 이득)"
            else:
                g = "채택 제안 조건 미충족(제안: 기본값 유지)"
            L += [f"- **{name}** 실험 G 판정: 거절 정확도 {[m['refusal'] for m in conds[name]]} → {g}"]

    L += [
        "",
        "## 노드별 평균 지연 (ms, 3회 평균)",
        "",
        "| 노드 | " + " | ".join(order) + " |",
        "|---|" + "---|" * len(order),
    ]
    for node in NODES:
        cells = []
        for name in order:
            vals = [m["node_ms"].get(node) for m in conds[name] if m["node_ms"].get(node) is not None]
            cells.append(f"{np.mean(vals):.0f}" if vals else "-")
        L.append(f"| {node} | " + " | ".join(cells) + " |")

    out = ROOT / "eval" / "results" / f"{date.today().isoformat()}-exp-{args.kind}.md"
    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
