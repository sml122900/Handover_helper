"""에이전트 평가 (설계 7장): golden.jsonl을 LangGraph 흐름에 통과시키고 지표를 계산한다.

실행 예:
  개발(5문항):  uv run --directory agent python ../eval/run.py --n5
  기준선(전체 40문항, 2회):  uv run --directory agent python ../eval/run.py --runs 2 --label baseline
결과: eval/results/YYYY-MM-DD-{label}.json + .md (설정은 머리말에 기록)

지표: 사실 20/시각 5 분리 Recall@5, 답변 정확도, 출처 일치율, 환각률, 거절 정확도(없음 10), 지연 p50/p95, 질문당 비용.
도구 문항 5개는 쓰기 도구(D3)라 지표에서 제외하고 분류 정확도만 기록한다.
"""

import argparse
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
sys.path.insert(0, str(ROOT / "eval"))

import retrieval  # noqa: E402  (overlaps 대신 dict 위치 비교를 쓰지만 load_spans를 재사용)

from embedding import get_embedder  # noqa: E402
from graph.agent import DEFAULT_STRATEGY, AgentDeps, build_agent, run_question  # noqa: E402
from graph.prompts import PROMPT_VERSION  # noqa: E402
from indexing.corpus import build_masked_index  # noqa: E402
from indexing.factory import make_store  # noqa: E402
from judge.groq import GroqJudge  # noqa: E402
from judge.tasks import (  # noqa: E402
    fact_covered,
    refusal_correct,
    run_accuracy,
    run_citations,
    run_hallucination,
    run_refusal,
)
from llm.client import ClaudeClient, CostBudgetExceeded, CostTracker, ledger_totals  # noqa: E402
from settings import get_settings  # noqa: E402

DEV_SUBSET = ["F04", "F10", "T01", "N03", "N07"]  # 사실(어려움)·사실(매장 혼동)·시각·없음(안전★)·없음
EXPECTED_CATEGORY = {"fact": "question", "time": "now_tasks", "tool": "record_request", "absent": "question"}


def load_golden() -> list[dict]:
    lines = (ROOT / "eval" / "golden.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(x) for x in lines]


def load_fact_texts() -> dict[str, str]:
    spec = (ROOT / "data" / "virtual" / "corpus-spec.md").read_text(encoding="utf-8")
    return {m.group(1): m.group(2) for m in re.finditer(r"^\| ([CBMGL]\d{2}) \| (.+?) \|", spec, re.M)}


def store_source(store_id: str) -> str:
    """환각 판정용 원문: 해당 매장의 문서와 트랜스크립트 전문."""
    return "\n\n".join(
        (ROOT / "data" / "virtual" / f"{store_id}.{e}").read_text(encoding="utf-8") for e in ("md", "txt")
    )


def hit_dict(entries: list[dict], spans: list[tuple[str, int, int]]) -> bool:
    return any(
        e["file"] == f and e["start"] < end and start < e["end"] for e in entries for f, start, end in spans
    )


def evaluate_question(q: dict, rec: dict, judge: GroqJudge, spans, fact_texts) -> dict:
    """한 질문의 채점 결과. 집계는 코드가 한다."""
    ev: dict = {"id": q["id"], "type": q["type"], "excluded": q["type"] == "tool"}
    ev["category_ok"] = rec["category"] == EXPECTED_CATEGORY[q["type"]]
    answer = rec["answer"]
    judge_cost = 0.0

    if q["type"] == "tool":
        return ev

    if q["type"] in ("fact", "time"):
        facts = {f: fact_texts[f] for f in q["expected_facts"]}
        acc, info = run_accuracy(judge, answer, facts)
        judge_cost += info.cost_usd
        covered = {fc.fact_id: fact_covered(fc) for fc in acc.facts}
        ev["fact_covered"] = {
            f: covered.get(f, False) for f in facts
        }  # 채점기가 빠뜨린 사실은 미포함으로 본다
        ev["accuracy_full"] = all(ev["fact_covered"].values())
        ev["accuracy_detail"] = acc.model_dump()

    if q["type"] == "fact":
        first = rec["retrieval_log"][0]["top5"] if rec["retrieval_log"] else []
        last = rec["retrieval_log"][-1]["top5"] if rec["retrieval_log"] else []
        ev["retrieval_first"] = {f: hit_dict(first, spans[f]) for f in q["expected_facts"]}
        ev["retrieval_final"] = {f: hit_dict(last, spans[f]) for f in q["expected_facts"]}
    if q["type"] == "time":
        tool_ev = [
            {"file": e["source_file"], "start": e["char_start"], "end": e["char_end"]}
            for e in rec["evidence"]
        ]
        ev["tool_evidence_hit"] = {f: hit_dict(tool_ev, spans[f]) for f in q["expected_facts"]}

    hal, info = run_hallucination(judge, answer, store_source(q["store"].lower()))
    judge_cost += info.cost_usd
    ev["hallucination"] = any(not c.supported for c in hal.claims)
    ev["unsupported_claims"] = [c.claim for c in hal.claims if not c.supported]
    ev["hallucination_detail"] = hal.model_dump()

    if rec["citations"] or re.search(r"\[근거 \d+\]", answer):
        evidence_text = "\n\n".join(f"[근거 {e['n']}]\n{e['text']}" for e in rec["evidence"])
        cit, info = run_citations(judge, answer, evidence_text)
        judge_cost += info.cost_usd
        ev["citation_pairs"] = len(cit.citations)
        ev["citation_supported"] = sum(c.supports for c in cit.citations)
        ev["citation_detail"] = cit.model_dump()

    if q["type"] == "absent":
        ref, info = run_refusal(judge, q["question"], answer)
        judge_cost += info.cost_usd
        ev["refusal_correct"] = refusal_correct(ref)
        ev["refusal_detail"] = ref.model_dump()
        ev["safety"] = q.get("safety", False)
        ev["emergency_marked"] = ref.emergency_marked_not_from_doc
    ev["judge_cost_usd"] = round(judge_cost, 6)
    return ev


def rate(n: int, d: int) -> float | None:
    return round(n / d, 4) if d else None


def summarize(rows: list[dict]) -> dict:
    """rows = [{q, rec, ev}] — 한 번의 실행."""
    ev = {r["q"]["id"]: r["ev"] for r in rows}
    recs = {r["q"]["id"]: r["rec"] for r in rows}
    types = {r["q"]["id"]: r["q"]["type"] for r in rows}
    ids = lambda t: [i for i in ev if types[i] == t]  # noqa: E731
    out: dict = {"questions": {t: len(ids(t)) for t in ("fact", "time", "tool", "absent")}}

    out["classification"] = {
        "correct": sum(e["category_ok"] for e in ev.values()),
        "total": len(ev),
        "mismatches": [
            {"id": i, "got": recs[i]["category"], "expected": EXPECTED_CATEGORY[types[i]]}
            for i, e in ev.items()
            if not e["category_ok"]
        ],
    }

    fq = ids("fact")
    n_facts = sum(len(ev[i]["retrieval_final"]) for i in fq)
    out["recall_at_5_fact20"] = {
        "final_facts_hit": sum(sum(ev[i]["retrieval_final"].values()) for i in fq),
        "facts": n_facts,
        "first_facts_hit": sum(sum(ev[i]["retrieval_first"].values()) for i in fq),
        "final_questions_full": sum(all(ev[i]["retrieval_final"].values()) for i in fq),
        "questions": len(fq),
    }
    tq = ids("time")
    out["time5_tool_evidence"] = {
        "facts_hit": sum(sum(ev[i]["tool_evidence_hit"].values()) for i in tq),
        "facts": sum(len(ev[i]["tool_evidence_hit"]) for i in tq),
    }

    ft = fq + tq
    out["answer_accuracy"] = {
        "facts_covered": sum(sum(ev[i]["fact_covered"].values()) for i in ft),
        "facts": sum(len(ev[i]["fact_covered"]) for i in ft),
        "questions_full": sum(ev[i]["accuracy_full"] for i in ft),
        "questions": len(ft),
        "fact20": {
            "covered": sum(sum(ev[i]["fact_covered"].values()) for i in fq),
            "facts": sum(len(ev[i]["fact_covered"]) for i in fq),
            "questions_full": sum(ev[i]["accuracy_full"] for i in fq),
            "questions": len(fq),
        },
        "time5": {
            "covered": sum(sum(ev[i]["fact_covered"].values()) for i in tq),
            "facts": sum(len(ev[i]["fact_covered"]) for i in tq),
            "questions_full": sum(ev[i]["accuracy_full"] for i in tq),
            "questions": len(tq),
        },
    }
    graded = ft + ids("absent")
    out["hallucination"] = {
        "answers_with_unsupported": sum(ev[i]["hallucination"] for i in graded),
        "answers": len(graded),
        "ids": [i for i in graded if ev[i]["hallucination"]],
    }
    pairs = sum(ev[i].get("citation_pairs", 0) for i in graded)
    out["citation_match"] = {
        "supported": sum(ev[i].get("citation_supported", 0) for i in graded),
        "pairs": pairs,
        "answers_without_citation": [i for i in ft if not ev[i].get("citation_pairs")],
    }
    aq = ids("absent")
    out["refusal_accuracy"] = {
        "correct": sum(ev[i]["refusal_correct"] for i in aq),
        "total": len(aq),
        "wrong": [i for i in aq if not ev[i]["refusal_correct"]],
        "safety_with_emergency_marked": [i for i in aq if ev[i]["safety"] and ev[i]["emergency_marked"]],
        "safety_ids": [i for i in aq if ev[i]["safety"]],
    }
    rewritten = [i for i in ev if recs[i]["rewritten"]]
    out["rewrite"] = {
        "questions_rewritten": rewritten,
        "detail": [
            {
                "id": i,
                "type": types[i],
                "outcome": recs[i]["outcome"],
                "hit_before": ev[i].get("retrieval_first"),
                "hit_after": ev[i].get("retrieval_final"),
                "queries": [x["query"] for x in recs[i]["retrieval_log"]],
            }
            for i in rewritten
        ],
    }
    lat = [recs[i]["latency_ms"] for i in ev]
    cost = [recs[i]["cost_usd"] for i in ev]
    out["latency_ms"] = {
        "p50": int(np.percentile(lat, 50)),
        "p95": int(np.percentile(lat, 95)),
        "n": len(lat),
    }
    out["cost_per_question_usd"] = {
        "mean": round(float(np.mean(cost)), 5),
        "max": round(float(np.max(cost)), 5),
        "claude_total": round(float(np.sum(cost)), 4),
    }
    out["outcomes"] = dict(Counter(recs[i]["outcome"] for i in ev))
    return out


def flip_report(runs: list[list[dict]]) -> dict:
    """같은 문항이 실행마다 판정이 바뀌는 정도 (문항 단위)."""
    keys = ["category_ok", "accuracy_full", "hallucination", "refusal_correct"]
    by_id: dict[str, list[dict]] = {}
    for rows in runs:
        for r in rows:
            by_id.setdefault(r["q"]["id"], []).append(r)
    flips = []
    for qid, rs in by_id.items():
        diff = {}
        for k in keys:
            vals = [r["ev"].get(k) for r in rs if k in r["ev"]]
            if len(set(vals)) > 1:
                diff[k] = vals
        for name, get in (
            ("outcome", lambda r: r["rec"]["outcome"]),
            ("rewritten", lambda r: r["rec"]["rewritten"]),
            (
                "retrieval_final_all_hit",
                lambda r: all(r["ev"]["retrieval_final"].values()) if "retrieval_final" in r["ev"] else None,
            ),
        ):
            vals = [get(r) for r in rs]
            if len(set(vals)) > 1:
                diff[name] = vals
        if diff:
            flips.append({"id": qid, "diff": diff})
    return {"questions": len(by_id), "questions_with_any_flip": len(flips), "flips": flips}


def to_markdown(res: dict) -> str:
    cfg = res["config"]
    L = [f"# 에이전트 평가 — {cfg['label']} ({cfg['date']})", "", "## 설정", ""]
    L += [f"- {k}: {v}" for k, v in cfg.items() if k not in ("label", "date")]
    for n, s in enumerate(res["summaries"], start=1):
        ra, aa, h, c, rf = (
            s["recall_at_5_fact20"],
            s["answer_accuracy"],
            s["hallucination"],
            s["citation_match"],
            s["refusal_accuracy"],
        )
        L += [
            "",
            f"## 실행 {n}",
            "",
            "| 지표 | 값 |",
            "|---|---|",
            f"| Recall@5 사실 20문항 (재검색 후) | {ra['final_facts_hit']}/{ra['facts']} = {rate(ra['final_facts_hit'], ra['facts'])} (첫 검색 {ra['first_facts_hit']}/{ra['facts']}, 문항 완전 적중 {ra['final_questions_full']}/{ra['questions']}) |",
            f"| 시각 5문항 도구 근거 적중 (검색 점수와 분리) | {s['time5_tool_evidence']['facts_hit']}/{s['time5_tool_evidence']['facts']} |",
            f"| 답변 정확도 (사실+시각) | 사실 {aa['facts_covered']}/{aa['facts']}, 문항 완전 {aa['questions_full']}/{aa['questions']} (사실20 {aa['fact20']['covered']}/{aa['fact20']['facts']}, 시각5 {aa['time5']['covered']}/{aa['time5']['facts']}) |",
            f"| 출처 일치율 | {c['supported']}/{c['pairs']} = {rate(c['supported'], c['pairs'])} |",
            f"| 환각률 (사실주장 근거 없음 1개 이상) | {h['answers_with_unsupported']}/{h['answers']} {h['ids']} |",
            f"| 거절 정확도 (없음 10) | {rf['correct']}/{rf['total']} 오답 {rf['wrong']} |",
            f"| 안전★ 긴급 안내에 '문서 근거 아님' 표시 | {len(rf['safety_with_emergency_marked'])}/{len(rf['safety_ids'])} |",
            f"| 분류 정확도 (도구 문항 포함) | {s['classification']['correct']}/{s['classification']['total']} {s['classification']['mismatches']} |",
            f"| 지연 p50 / p95 (채점 제외) | {s['latency_ms']['p50']} ms / {s['latency_ms']['p95']} ms |",
            f"| 질문당 Claude 비용 | 평균 ${s['cost_per_question_usd']['mean']} (최대 ${s['cost_per_question_usd']['max']}, 합계 ${s['cost_per_question_usd']['claude_total']}) |",
            f"| 재검색이 일어난 문항 | {s['rewrite']['questions_rewritten']} |",
        ]
        for d in s["rewrite"]["detail"]:
            L.append(
                f"|   ↳ {d['id']} ({d['type']}) | 결과 {d['outcome']}, 재검색 전 적중 {d['hit_before']} → 후 {d['hit_after']}, 질의 {d['queries']} |"
            )
    if res.get("stability"):
        st = res["stability"]
        L += [
            "",
            "## 실행 간 흔들림 (문항 단위)",
            "",
            f"- {st['questions']}문항 중 판정이 실행마다 달라진 문항: {st['questions_with_any_flip']}개",
        ]
        L += [f"  - {f['id']}: {f['diff']}" for f in st["flips"]]
    L += ["", "## 비용 (서비스별, 이 실행)", ""] + [f"- {k}: {v}" for k, v in res["costs"].items()]
    return "\n".join(L) + "\n"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--subset", default=None, help="쉼표로 구분한 문항 ID (예: F04,T01)")
    ap.add_argument("--n5", action="store_true", help=f"개발용 5문항 {DEV_SUBSET}")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--label", default="baseline")
    args = ap.parse_args()

    s = get_settings()
    assert s.anthropic_api_key and s.groq_api_key, "ANTHROPIC_API_KEY, GROQ_API_KEY 필요"
    golden = load_golden()
    subset = DEV_SUBSET if args.n5 else (args.subset.split(",") if args.subset else None)
    if subset:
        golden = [q for q in golden if q["id"] in subset]
    label = args.label if not subset else f"{args.label}-subset"

    embedder = get_embedder(s)
    store = make_store(s, embedder.model)
    masked, vecs = build_masked_index(embedder)
    store.add(masked, vecs)
    claude_tracker = CostTracker(s.agent_cost_budget_usd, "anthropic")
    judge_tracker = CostTracker(None, "groq")
    llm = ClaudeClient(s.anthropic_api_key, s.agent_model, claude_tracker)
    judge = GroqJudge(s.groq_api_key, s.judge_model, judge_tracker)
    app = build_agent(AgentDeps(llm=llm, embedder=embedder, store=store, strategy=DEFAULT_STRATEGY))
    spans = retrieval.load_spans()
    fact_texts = load_fact_texts()

    runs: list[list[dict]] = []
    try:
        for n in range(args.runs):
            rows = []
            for q in golden:
                rec = run_question(app, q["question"], q["store"], q.get("current_time"))
                ev = evaluate_question(q, rec, judge, spans, fact_texts)
                rows.append({"q": q, "rec": rec, "ev": ev})
                print(
                    f"[run {n + 1}] {q['id']} {rec['outcome']} {rec['latency_ms']}ms ${rec['cost_usd']:.4f}",
                    flush=True,
                )
            runs.append(rows)
    except CostBudgetExceeded as e:
        print(f"[중단] {e}")
        sys.exit(2)
    finally:
        pass

    ledger = ledger_totals()
    res = {
        "config": {
            "label": label,
            "date": date.today().isoformat(),
            "agent_model": s.agent_model,
            "prompt_version": PROMPT_VERSION,
            "embedding": f"{embedder.provider}/{embedder.model}",
            "chunking": DEFAULT_STRATEGY + " (문서) + 트랜스크립트 고정 창",
            "store_filter": "켬(고정)",
            "k": 5,
            "vector_store": s.agent_store,
            "judge_model": s.judge_model,
            "questions": [q["id"] for q in golden],
            "runs": args.runs,
            "note": "도구 문항(U01~U05)은 쓰기 도구(D3)라 지표에서 제외, 분류 정확도만 기록",
        },
        "summaries": [summarize(rows) for rows in runs],
        "stability": flip_report(runs) if len(runs) > 1 else None,
        "costs": {
            "anthropic(이 실행)": f"${claude_tracker.run_cost:.4f} / {claude_tracker.run_calls}회",
            "groq(이 실행)": f"${judge_tracker.run_cost:.4f} / {judge_tracker.run_calls}회",
            "voyage(이 실행) 임베딩 토큰": embedder.run_tokens,
            "누적(전 세션 기록)": {
                k: {"calls": v["calls"], "usd": round(v["usd"], 4)} for k, v in ledger.items()
            },
        },
        "runs": [[{"id": r["q"]["id"], "record": r["rec"], "eval": r["ev"]} for r in rows] for rows in runs],
    }
    path = ROOT / "eval" / "results" / f"{date.today().isoformat()}-{label}.json"
    path.write_text(json.dumps(res, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    path.with_suffix(".md").write_text(to_markdown(res), encoding="utf-8")
    print(to_markdown(res))


if __name__ == "__main__":
    main()
