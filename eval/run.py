"""에이전트 평가 (설계 7장): golden.jsonl을 LangGraph 흐름에 통과시키고 지표를 계산한다.

실행 예:
  개발(5문항):  uv run --directory agent python ../eval/run.py --n5
  기준선(전체 40문항, 2회):  uv run --directory agent python ../eval/run.py --runs 2 --label baseline
결과: eval/results/YYYY-MM-DD-{label}.json + .md (설정은 머리말에 기록)

지표: 사실 20/시각 5 분리 Recall@5, 답변 정확도, 출처 일치율, 근거 충실도, 거절 정확도(없음 10), 지연 p50/p95, 질문당 비용.
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
from graph.agent import (  # noqa: E402  # noqa: E402
    DEFAULT_STRATEGY,
    NO_TASKS_REPLY,
    OUT_OF_SCOPE_REPLY,
    AgentDeps,
    build_agent,
    escalation_text,
    run_question,
)
from graph.prompts import PROMPT_VERSIONS  # noqa: E402
from indexing.corpus import build_masked_index  # noqa: E402
from indexing.factory import make_store  # noqa: E402
from judge.groq import GroqJudge  # noqa: E402
from judge.stable import collect, majority, representative  # noqa: E402
from judge.tasks import (  # noqa: E402
    fact_covered,
    fact_covered_relevant,
    refusal_correct,
    run_accuracy,
    run_citations,
    run_faithfulness,
    run_refusal,
)
from llm.client import PRESETS, CostBudgetExceeded, CostTracker, ledger_totals, make_llm  # noqa: E402
from settings import get_settings  # noqa: E402

DEV_SUBSET = ["F04", "F10", "T01", "N03", "N07"]  # 사실(어려움)·사실(매장 혼동)·시각·없음(안전★)·없음
EXPECTED_CATEGORY = {"fact": "question", "time": "now_tasks", "tool": "record_request", "absent": "question"}


def load_golden() -> list[dict]:
    lines = (ROOT / "eval" / "golden.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(x) for x in lines]


def load_fact_texts() -> dict[str, str]:
    spec = (ROOT / "data" / "virtual" / "corpus-spec.md").read_text(encoding="utf-8")
    return {m.group(1): m.group(2) for m in re.finditer(r"^\| ([CBMGL]\d{2}) \| (.+?) \|", spec, re.M)}


def hit_dict(entries: list[dict], spans: list[tuple[str, int, int]]) -> bool:
    return any(
        e["file"] == f and e["start"] < end and start < e["end"] for e in entries for f, start, end in spans
    )


def base_eval(q: dict, rec: dict, spans) -> dict:
    """채점 모델 없이 계산하는 부분: 분류·검색 적중·도구 근거 적중."""
    ev: dict = {"id": q["id"], "type": q["type"], "excluded": q["type"] == "tool"}
    ev["category_ok"] = rec["category"] == EXPECTED_CATEGORY[q["type"]]
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
    return ev


def utf16_slice(text: str, start: int, end: int) -> str:
    b = text.encode("utf-16-le")
    return b[start * 2 : end * 2].decode("utf-16-le")


def tasks_evidence(tasks: dict) -> str:
    """get_current_tasks 결과를 에이전트가 답변 프롬프트에서 받은 형태로 옮긴다 (시각 문항의 근거)."""

    def lines(items: list[dict]) -> str:
        return "\n".join(f"- {i['time']} {i['text']}" for i in items) or "- (없음)"

    return (
        f"[일정 도구 결과] 현재 시각 {tasks['current_time']}\n"
        f"지금 시작한 일(최근 30분):\n{lines(tasks['now'])}\n"
        f"곧 있을 일(30분 이내):\n{lines(tasks['upcoming'])}"
    )


def received_chunks(rec: dict) -> list[str]:
    """이 답변을 쓰는 동안 에이전트가 실제로 받은 청크: 답변 근거(evidence) + 재검색 전 검색 결과(위치로 복원)."""
    seen: dict[tuple, str] = {(e["source_file"], e["char_start"]): e["text"] for e in rec["evidence"]}
    for attempt in rec["retrieval_log"]:
        for t in attempt["top5"]:
            key = (t["file"], t["start"])
            if key not in seen:
                text = (ROOT / t["file"]).read_bytes().decode("utf-8")
                seen[key] = utf16_slice(text, t["start"], t["end"])
    return list(seen.values())


def template_kind(q: dict, rec: dict) -> str | None:
    """답변이 고정 문구와 완전히 일치하면 그 종류 (그 외에는 None)."""
    a = rec["answer"]
    if rec["outcome"] == "escalated" and a == escalation_text(q["question"], rec.get("safety", False)):
        return "escalation"
    for name, text in (
        ("out_of_scope", OUT_OF_SCOPE_REPLY),
        ("no_tasks", NO_TASKS_REPLY),
    ):
        if rec["outcome"] == name and a == text:
            return name
    return None


def judge_eval(
    q: dict, rec: dict, judge: GroqJudge, fact_texts, stable: bool = False, reuse: dict | None = None
) -> dict:
    """채점 모델(Groq) 호출 부분: 답변 정확도·근거 충실도·출처 일치·거절. 집계는 코드가 한다.

    stable=True면 모든 항목을 2회 채점하고 엇갈리면 3회째로 다수결한다 (기존 단일 채점은 stable=False).
    reuse: 이전 채점 결과. 프롬프트가 바뀌지 않은 항목(출처 일치·거절)은 다시 채점하지 않고 이 값을 가져온다
    (채점 기준 보완 재채점, 2026-10-01 — 정확도·근거 충실도만 새 기준으로 다시 채점).
    """
    ev: dict = {}
    answer = rec["answer"]
    judge_cost = 0.0
    votes_log: dict[str, dict] = {}
    if q["type"] == "tool":
        return ev

    if q["type"] in ("fact", "time"):
        facts = {f: fact_texts[f] for f in q["expected_facts"]}
        mode = "task" if q["type"] == "time" else "fact"

        def verdict(acc) -> dict:
            got = {fc.fact_id: (fact_covered(fc), fact_covered_relevant(fc)) for fc in acc.facts}
            return {f: got.get(f, (False, False)) for f in facts}  # 채점기가 빠뜨린 사실은 미포함으로 본다

        v = collect(lambda: run_accuracy(judge, answer, facts, q["question"], mode), verdict, stable)
        judge_cost += v.cost_usd
        per = [verdict(r) for r in v.results]
        final = {f: (majority([x[f][0] for x in per]), majority([x[f][1] for x in per])) for f in facts}
        ev["fact_covered"] = {f: final[f][0] for f in facts}
        ev["accuracy_full"] = all(ev["fact_covered"].values())
        ev["fact_covered_relevant"] = {f: final[f][1] for f in facts}
        ev["accuracy_full_relevant"] = all(ev["fact_covered_relevant"].values())
        ev["accuracy_detail"] = representative(v, verdict, final).model_dump()
        votes_log["accuracy"] = {"calls": v.calls, "third": v.third}

    template = template_kind(q, rec)
    if template:  # 고정 문구는 검색 근거에서 온 사실 주장이 없다 → 호출을 건너뛰고 "사실 주장 없음"으로 집계
        ev["unfaithful"] = False
        ev["unsupported_claims"] = []
        ev["faithfulness_skipped"] = template
    else:
        chunks = received_chunks(rec)
        evidence_text = "\n\n".join(f"[청크 {i}]\n{t}" for i, t in enumerate(chunks, start=1))
        if rec.get("tasks") and rec["tasks"].get(
            "found"
        ):  # 시각 문항: 에이전트가 받은 도구 결과(일정)도 근거다
            evidence_text += "\n\n" + tasks_evidence(rec["tasks"])
        fmode = "tasks" if q["type"] == "time" else "doc"

        def unfaithful(fai) -> bool:
            return any(not c.supported for c in fai.claims)

        v = collect(lambda: run_faithfulness(judge, answer, evidence_text, fmode), unfaithful, stable)
        judge_cost += v.cost_usd
        final_u = majority([unfaithful(r) for r in v.results])
        rep = representative(v, unfaithful, final_u)
        ev["unfaithful"] = final_u
        ev["unsupported_claims"] = [c.claim for c in rep.claims if not c.supported]
        ev["faithfulness_detail"] = rep.model_dump()
        ev["faithfulness_chunks"] = len(chunks)
        votes_log["faithfulness"] = {"calls": v.calls, "third": v.third}

    if reuse is not None:
        for key in ("citation_supported", "citation_pairs", "citation_detail"):
            if key in reuse:
                ev[key] = reuse[key]
    elif rec["citations"] or re.search(r"\[근거 \d+\]", answer):
        evidence_text = "\n\n".join(f"[근거 {e['n']}]\n{e['text']}" for e in rec["evidence"])

        def cit_key(cit) -> tuple:
            return (sum(c.supports for c in cit.citations), len(cit.citations))

        v = collect(lambda: run_citations(judge, answer, evidence_text), cit_key, stable)
        judge_cost += v.cost_usd
        final_c = majority([cit_key(r) for r in v.results])
        rep = representative(v, cit_key, final_c)
        ev["citation_supported"], ev["citation_pairs"] = final_c
        ev["citation_detail"] = rep.model_dump()
        votes_log["citations"] = {"calls": v.calls, "third": v.third}

    if q["type"] == "absent" and reuse is not None:
        for key in ("refusal_correct", "refusal_detail", "safety", "emergency_marked"):
            if key in reuse:
                ev[key] = reuse[key]
    elif q["type"] == "absent":

        def ref_key(ref) -> tuple:
            return (refusal_correct(ref), ref.emergency_marked_not_from_doc)

        v = collect(lambda: run_refusal(judge, q["question"], answer), ref_key, stable)
        judge_cost += v.cost_usd
        per = [ref_key(r) for r in v.results]
        final_r = (majority([x[0] for x in per]), majority([x[1] for x in per]))
        ev["refusal_correct"] = final_r[0]
        ev["refusal_detail"] = representative(v, ref_key, final_r).model_dump()
        ev["safety"] = q.get("safety", False)
        ev["emergency_marked"] = final_r[1]
        votes_log["refusal"] = {"calls": v.calls, "third": v.third}
    ev["judge_cost_usd"] = round(judge_cost, 6)
    if stable:
        ev["judge_votes"] = votes_log
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
    graded = ft + ids("absent")
    out["judged"] = judged = all(
        "unfaithful" in ev[i] for i in graded
    )  # 채점 결과가 모두 있어야 채점 지표를 계산
    if judged:
        out["answer_accuracy"] = {
            "facts_covered": sum(sum(ev[i]["fact_covered"].values()) for i in ft),
            "facts": sum(len(ev[i]["fact_covered"]) for i in ft),
            "questions_full": sum(ev[i]["accuracy_full"] for i in ft),
            "questions": len(ft),
            "relevant_only": {
                "facts_covered": sum(sum(ev[i]["fact_covered_relevant"].values()) for i in ft),
                "facts": sum(len(ev[i]["fact_covered_relevant"]) for i in ft),
                "questions_full": sum(ev[i]["accuracy_full_relevant"] for i in ft),
                "questions": len(ft),
                "fact20_covered": sum(sum(ev[i]["fact_covered_relevant"].values()) for i in fq),
                "fact20_facts": sum(len(ev[i]["fact_covered_relevant"]) for i in fq),
            },
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
        out["faithfulness"] = {
            "answers_with_unsupported": sum(ev[i]["unfaithful"] for i in graded),
            "skipped_templates": sum(1 for i in graded if ev[i].get("faithfulness_skipped")),
            "answers": len(graded),
            "ids": [i for i in graded if ev[i]["unfaithful"]],
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
    out["latency_breakdown"] = latency_breakdown(recs, types)
    return out


def latency_breakdown(recs: dict, types: dict) -> dict:
    """노드별 지연 분해(전 문항) + 문서에 없음 문항에서 재검색 경로(재작성+2차 검색+2차 충분성)의 기여."""
    by_node: dict[str, list[int]] = {}
    total = 0
    for rec in recs.values():
        for t in rec["trace"]:
            by_node.setdefault(t["node"], []).append(t.get("latency_ms", 0))
            total += t.get("latency_ms", 0)
    nodes = {
        k: {
            "calls": len(v),
            "mean_ms": int(np.mean(v)),
            "p50_ms": int(np.percentile(v, 50)),
            "p95_ms": int(np.percentile(v, 95)),
            "share": round(sum(v) / total, 4) if total else None,
        }
        for k, v in by_node.items()
    }
    extra = []
    whole = []
    for qid, rec in recs.items():
        if types[qid] != "absent" or not rec["rewritten"]:
            continue
        names = [t["node"] for t in rec["trace"]]
        first_suff = names.index("sufficiency") if "sufficiency" in names else names.index("answer")
        extra.append(
            sum(t.get("latency_ms", 0) for t in rec["trace"][first_suff + 1 :] if t["node"] != "escalate")
        )
        whole.append(sum(t.get("latency_ms", 0) for t in rec["trace"]))
    absent = None
    if whole:
        absent = {
            "questions": len(whole),
            "mean_total_ms": int(np.mean(whole)),
            "mean_rewrite_path_ms": int(np.mean(extra)),
            "share": round(sum(extra) / sum(whole), 4),
            "mean_without_rewrite_path_ms": int(np.mean(whole) - np.mean(extra)),
        }
    return {"nodes": nodes, "absent_rewrite_path": absent}


def flip_report(runs: list[list[dict]]) -> dict:
    """같은 문항이 실행마다 판정이 바뀌는 정도 (문항 단위)."""
    keys = ["category_ok", "accuracy_full", "accuracy_full_relevant", "unfaithful", "refusal_correct"]
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


def judge_rows(s: dict) -> list[str]:
    aa, h, c, rf = s["answer_accuracy"], s["faithfulness"], s["citation_match"], s["refusal_accuracy"]
    ro = aa["relevant_only"]
    return [
        f"| 답변 정확도 (사실+시각) | 사실 {aa['facts_covered']}/{aa['facts']}, 문항 완전 {aa['questions_full']}/{aa['questions']} (사실20 {aa['fact20']['covered']}/{aa['fact20']['facts']}, 시각5 {aa['time5']['covered']}/{aa['time5']['facts']}). 정의: 정답 사실 내용을 모두 포함(시각 문항은 일 단위) |",
        f"| 답변 정확도 — 보조(질문이 묻는 조각만) | 사실 {ro['facts_covered']}/{ro['facts']}, 문항 완전 {ro['questions_full']}/{ro['questions']} (사실20 {ro['fact20_covered']}/{ro['fact20_facts']}) |",
        f"| 출처 일치율 | {c['supported']}/{c['pairs']} = {rate(c['supported'], c['pairs'])} |",
        f"| 근거 충실도 (검색 근거 기준) — 근거 밖 사실 주장이 1개 이상인 답변 | {h['answers_with_unsupported']}/{h['answers']} {h['ids']} (고정 문구라 호출 생략 {h['skipped_templates']}건, 사실 주장 없음으로 집계) |",
        f"| 거절 정확도 (없음 10) | {rf['correct']}/{rf['total']} 오답 {rf['wrong']} |",
        f"| 안전★ 긴급 안내에 '문서 근거 아님' 표시 | {len(rf['safety_with_emergency_marked'])}/{len(rf['safety_ids'])} |",
    ]


def to_markdown(res: dict) -> str:
    cfg = res["config"]
    L = [f"# 에이전트 평가 — {cfg['label']} ({cfg['date']})", "", "## 설정", ""]
    L += [f"- {k}: {v}" for k, v in cfg.items() if k not in ("label", "date")]
    for n, s in enumerate(res["summaries"], start=1):
        ra = s["recall_at_5_fact20"]
        judged = s.get("judged", False)
        L += [
            "",
            f"## 실행 {n}",
            "",
            "| 지표 | 값 |",
            "|---|---|",
            f"| Recall@5 사실 20문항 (재검색 후) | {ra['final_facts_hit']}/{ra['facts']} = {rate(ra['final_facts_hit'], ra['facts'])} (첫 검색 {ra['first_facts_hit']}/{ra['facts']}, 문항 완전 적중 {ra['final_questions_full']}/{ra['questions']}) |",
            f"| 시각 5문항 도구 근거 적중 (검색 점수와 분리) | {s['time5_tool_evidence']['facts_hit']}/{s['time5_tool_evidence']['facts']} |",
            *(
                judge_rows(s)
                if judged
                else ["| 채점 지표 (답변 정확도·출처 일치·환각·거절) | **채점 대기** |"]
            ),
            f"| 분류 정확도 (도구 문항 포함) | {s['classification']['correct']}/{s['classification']['total']} {s['classification']['mismatches']} |",
            f"| 지연 p50 / p95 (채점 제외) | {s['latency_ms']['p50']} ms / {s['latency_ms']['p95']} ms |",
            f"| 질문당 Claude 비용 | 평균 ${s['cost_per_question_usd']['mean']} (최대 ${s['cost_per_question_usd']['max']}, 합계 ${s['cost_per_question_usd']['claude_total']}) |",
            f"| 재검색이 일어난 문항 | {s['rewrite']['questions_rewritten']} |",
        ]
        for d in s["rewrite"]["detail"]:
            L.append(
                f"|   ↳ {d['id']} ({d['type']}) | 결과 {d['outcome']}, 재검색 전 적중 {d['hit_before']} → 후 {d['hit_after']}, 질의 {d['queries']} |"
            )
    lb = res["summaries"][0].get("latency_breakdown") if res["summaries"] else None
    if lb:
        L += [
            "",
            "## 지연 분해 (실행 1, 노드별)",
            "",
            "| 노드 | 호출 수 | 평균 | p50 | p95 | 전체 지연 중 비중 |",
            "|---|---|---|---|---|---|",
        ]
        for name, v in sorted(lb["nodes"].items(), key=lambda kv: -kv[1]["mean_ms"] * kv[1]["calls"]):
            L.append(
                f"| {name} | {v['calls']} | {v['mean_ms']} ms | {v['p50_ms']} ms | {v['p95_ms']} ms | {v['share']:.1%} |"
            )
        a = lb["absent_rewrite_path"]
        if a:
            L += [
                "",
                f"- 문서에 없음 {a['questions']}문항: 평균 {a['mean_total_ms']} ms 중 재검색 경로(재작성+2차 검색+2차 충분성)가 {a['mean_rewrite_path_ms']} ms ({a['share']:.1%}). 재검색 없이 에스컬레이션하면 약 {a['mean_without_rewrite_path_ms']} ms",
                "- 지연 목표(p95 8초)는 바꾸지 않고 미달로 기록한다",
            ]
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
    ap.add_argument(
        "--regen", default=None, help="쉼표로 구분한 문항 ID의 캐시를 보존용으로 옮기고 다시 생성"
    )
    ap.add_argument(
        "--rejudge",
        default=None,
        help="쉼표로 구분한 문항 ID의 채점 캐시를 보존용으로 옮기고 다시 채점(응답은 유지)",
    )
    ap.add_argument("--integrated", action="store_true", help="실험 G: 충분성 판단을 답변 노드에 통합")
    ap.add_argument(
        "--criteria-v2",
        action="store_true",
        help="채점 기준 보완 재채점: 정확도·근거 충실도만 새 기준으로 다시 채점(안정화), 출처·거절은 기존 결과 재사용",
    )
    ap.add_argument(
        "--no-generate",
        action="store_true",
        help="응답이 캐시에 없으면 생성하지 않고 오류 (Claude 호출 0회 보장)",
    )
    ap.add_argument(
        "--stable",
        action="store_true",
        help="채점 안정화: 모든 항목 2회 채점, 엇갈리면 3회째 다수결 (2026-10-01 결정)",
    )
    ap.add_argument("--judge-budget-usd", type=float, default=1.5, help="이 실행의 Groq 채점 비용 상한")
    ap.add_argument("--no-judge", action="store_true", help="질문 응답만 생성·캐시하고 채점은 나중에")
    ap.add_argument("--label", default="baseline")
    ap.add_argument("--preset", default="sonnet", choices=PRESETS, help="실험 C: 노드별 모델 조합")
    ap.add_argument(
        "--answer-prompt", default=None, choices=["v1", "v2"], help="실험 D': 답변 프롬프트 (기본은 설정값)"
    )
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
    judge_tracker = CostTracker(args.judge_budget_usd, "groq")
    llm = make_llm(args.preset, s.anthropic_api_key, s.agent_model, claude_tracker)
    answer_prompt = args.answer_prompt or s.agent_answer_prompt
    judge = GroqJudge(s.groq_api_key, s.judge_model, judge_tracker)
    app = build_agent(
        AgentDeps(
            llm=llm,
            embedder=embedder,
            store=store,
            strategy=DEFAULT_STRATEGY,
            answer_prompt=answer_prompt,
            integrated=args.integrated,
        )
    )
    spans = retrieval.load_spans()
    fact_texts = load_fact_texts()

    # 실행 결과 캐시: 질문 응답(Claude 비용)과 채점(Groq 한도)을 분리해 중단돼도 이어서 실행할 수 있다
    cache_dir = ROOT / "eval" / "results" / ".cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    if args.criteria_v2:
        args.stable = True
    suffix = "-stable-v2" if args.criteria_v2 else ("-stable" if args.stable else "")
    out_label = f"{label}{suffix}"  # 결과 파일 라벨 (안정화 채점은 별도 결과)
    rec_cache, ev_cache = cache_dir / f"{label}-recs.jsonl", cache_dir / f"{out_label}-evs.jsonl"

    def load(path: Path) -> dict:
        if not path.exists():
            return {}
        rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]
        return {(x["run"], x["id"]): x["data"] for x in rows}

    def save(path: Path, run: int, qid: str, data: dict) -> None:
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"run": run, "id": qid, "data": data}, ensure_ascii=False) + "\n")

    if args.regen:  # 지정한 문항의 캐시된 응답·채점을 보존용 파일로 옮기고 다시 생성한다 (다른 문항의 응답은 건드리지 않음)
        regen_ids = set(args.regen.split(","))
        for path in (rec_cache, ev_cache):
            if not path.exists():
                continue
            lines = [x for x in path.read_text(encoding="utf-8").splitlines() if x]
            keep = [x for x in lines if json.loads(x)["id"] not in regen_ids]
            gone = [x for x in lines if json.loads(x)["id"] in regen_ids]
            if gone:
                with path.with_name(path.stem + "-archive.jsonl").open("a", encoding="utf-8") as f:
                    f.write("\n".join(gone) + "\n")
                path.write_text("\n".join(keep) + ("\n" if keep else ""), encoding="utf-8")
    if args.rejudge and ev_cache.exists():
        rejudge_ids = set(args.rejudge.split(","))
        lines = [x for x in ev_cache.read_text(encoding="utf-8").splitlines() if x]
        gone = [x for x in lines if json.loads(x)["id"] in rejudge_ids]
        if gone:
            with ev_cache.with_name(ev_cache.stem + "-archive.jsonl").open("a", encoding="utf-8") as f:
                f.write("\n".join(gone) + "\n")
            keep = [x for x in lines if json.loads(x)["id"] not in rejudge_ids]
            ev_cache.write_text("\n".join(keep) + ("\n" if keep else ""), encoding="utf-8")
    recs, evs = load(rec_cache), load(ev_cache)
    prev: dict = {}
    if args.criteria_v2:  # 재사용할 이전 채점: 안정화 채점이 있으면 그것, 없으면 단일 채점
        for name in (f"{label}-stable-evs.jsonl", f"{label}-evs.jsonl"):
            if (cache_dir / name).exists():
                prev = load(cache_dir / name)
                break
    runs: list[list[dict]] = []
    judge_stopped = False
    try:
        for n in range(args.runs):
            rows = []
            for q in golden:
                key = (n, q["id"])
                if key not in recs:
                    if args.no_generate:
                        raise SystemExit(f"응답 캐시 없음(--no-generate): {label} 실행 {n + 1} {q['id']}")
                    recs[key] = run_question(app, q["question"], q["store"], q.get("current_time"))
                    save(rec_cache, n, q["id"], recs[key])
                rec = recs[key]
                base = base_eval(q, rec, spans)
                if key not in evs and not args.no_judge and not judge_stopped:
                    try:
                        evs[key] = judge_eval(
                            q, rec, judge, fact_texts, stable=args.stable, reuse=prev.get(key)
                        )
                        save(ev_cache, n, q["id"], evs[key])
                    except (
                        RuntimeError
                    ) as e:  # 채점 한도(예: Groq 일일 토큰) 소진 등 — 지금까지의 결과는 캐시에 남는다
                        print(f"[채점 중단] {q['id']}: {e}")
                        judge_stopped = True
                rows.append({"q": q, "rec": rec, "ev": {**base, **evs.get(key, {})}})
                print(
                    f"[run {n + 1}] {q['id']} {rec['outcome']} {rec['latency_ms']}ms ${rec['cost_usd']:.4f} "
                    + ("채점 완료" if key in evs else "채점 대기"),
                    flush=True,
                )
            runs.append(rows)
    except CostBudgetExceeded as e:
        print(f"[중단] {e}")
        sys.exit(2)
    pending = sum(
        1 for n in range(args.runs) for q in golden if q["type"] != "tool" and (n, q["id"]) not in evs
    )
    if pending:
        print(
            f"채점 대기 {pending}건 — 결과 파일에는 채점 지표 없이 저장한다. "
            "같은 명령을 --no-judge 없이 다시 실행하면 캐시된 응답을 재사용해 채점을 이어서 진행한다."
        )

    ledger = ledger_totals()
    res = {
        "config": {
            "label": out_label,
            "judge_mode": "stable-v2(보완 기준: 정확도·충실도 2회+다수결 재채점, 출처·거절은 기존 채점 재사용)"
            if args.criteria_v2
            else ("stable(2회+다수결)" if args.stable else "single"),
            "date": date.today().isoformat(),
            "agent_model": llm.describe(),
            "llm_preset": args.preset,
            "answer_prompt": answer_prompt,
            "graph": "integrated(충분성 통합)" if args.integrated else "split(충분성 노드 분리)",
            "prompt_version": PROMPT_VERSIONS[answer_prompt],
            "embedding": f"{embedder.provider}/{embedder.model}",
            "chunking": DEFAULT_STRATEGY + " (문서) + 트랜스크립트 고정 창",
            "store_filter": "켬(고정)",
            "k": 5,
            "vector_store": s.agent_store,
            "judge_model": s.judge_model,
            "questions": [q["id"] for q in golden],
            "runs": args.runs,
            "note": "도구 문항(U01~U05)은 쓰기 도구(D3)라 지표에서 제외, 분류 정확도만 기록",
            "faithfulness_definition": "근거 충실도(faithfulness, 검색 근거 기준): 답변의 사실 주장(부재 진술·점장 확인 안내·응급 일반 안내 제외)이 그 답변이 실제로 받은 청크(최초 검색 상위 5개 + 재검색분, 시각 문항은 도구 근거 청크)에 뒷받침되는지. 원문에는 있어도 받은 청크에 없으면 근거 밖. 답변이 고정 문구(에스컬레이션·기록 요청·범위 밖·일정 없음)와 완전히 일치하면 호출을 건너뛰고 사실 주장 없음으로 집계",
            "accuracy_definition": "주 지표: 골든셋 정의(정답 사실 내용 전체 포함, 시각 문항은 일 단위). 보조 지표: 질문이 묻는 조각만 — 채점 모델 판단 포함",
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
    path = ROOT / "eval" / "results" / f"{date.today().isoformat()}-{out_label}.json"
    path.write_text(json.dumps(res, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    path.with_suffix(".md").write_text(to_markdown(res), encoding="utf-8")
    print(to_markdown(res))


if __name__ == "__main__":
    main()
