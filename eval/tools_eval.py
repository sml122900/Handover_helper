"""쓰기 도구 평가 (설계 7-4 도구 정확도): 골든셋 도구 5문항(U01~U05)을 실제 Claude로 계획·확인·승인/거절 두 경로 모두 실행한다.

실행: uv run --directory agent python ../eval/tools_eval.py
결과: eval/results/YYYY-MM-DD-tools.{json,md}

- 도구 정확도 = 올바른 도구·인자를 고르고(사유 제외 필수 인자), 쓰기 도구는 저장 전에 확인 단계를 거친 비율. 사유(reason)는 참고로 별도 표기한다
  (골든셋 U01·U05에서 reason 제거, 결정 로그 2026-10-01).
- 승인 경로: 확인 대기에서 저장소가 비어 있음을 확인한 뒤 승인 → 기대 인자로 정확히 1건 저장. 거절 경로: 거절 → 0건 저장 + "기록하지 않았어요".
- 자유 문구 인자(알림 메시지)는 채점 모델(안정화 채점: 2회 + 엇갈리면 3회째 다수결)로 의미 일치를 본다.
"""

import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))

from graph.agent import AgentDeps, build_agent, resume_question, run_question  # noqa: E402
from indexing.store import MemoryStore  # noqa: E402
from judge.groq import GroqJudge  # noqa: E402
from judge.stable import collect, majority  # noqa: E402
from judge.tasks import run_message_match  # noqa: E402
from llm.client import CostTracker, make_llm  # noqa: E402
from settings import get_settings  # noqa: E402
from tools.service import REJECT_TEXT  # noqa: E402
from tools.store import MemoryToolStore  # noqa: E402
from tools.timeutil import SEOUL  # noqa: E402

TODAY = datetime(2026, 10, 1, 12, 0, tzinfo=SEOUL)
CURRENT_TIME = {"s1": "21:40", "s3": "23:30", "s4": "06:50"}  # 매장별 고정 시각 (평가 재현성)


def norm(s: str | None) -> str:
    return "".join((s or "").split())


def seed(tools: MemoryToolStore, qid: str) -> None:
    if qid == "U02":  # 어제(2026-09-30) 폐기 기록 두 건
        y = TODAY - timedelta(days=1)
        tools.waste_add("s3", "김밥", 2, "사유 미기재", y.date(), y)
        tools.waste_add("s3", "도시락", 1, "유통기한 경과", y.date(), y)


def snapshot(tools: MemoryToolStore) -> dict:
    return {
        "waste": len(tools.waste),
        "checklist": len(tools.checklist),
        "notifications": len(tools.notifications),
    }


def check_args(q: dict, plan: dict, judge: GroqJudge | None) -> dict:
    exp, a = q["expected_tool"], q["args"]
    out: dict = {"tool_ok": False, "args_ok": False, "detail": {}}
    want_tool = {"record": "waste_log_record", "query": "waste_log_query"}.get(a.get("mode"), exp)
    out["tool_ok"] = plan["tool"] == want_tool
    d: dict = {}
    if want_tool == "waste_log_record":
        d = {"item": norm(plan.get("item")) == norm(a["item"]), "qty": plan.get("qty") == int(a["qty"])}
        d["reason_recorded_for_reference"] = plan.get("reason")  # 참고: 골든셋에는 사유 기대값 없음
    elif want_tool == "waste_log_query":
        d = {"date": plan.get("date_ref") == "yesterday"}  # 골든셋 기대: 어제
    elif want_tool == "log_checklist":
        d = {"step_id": plan.get("step_id") == a["step_id"]}
    elif want_tool == "notify_manager":
        d = {"urgency": plan.get("urgency") == a["urgency"]}
        if judge:
            v = collect(
                lambda: run_message_match(judge, a["message"], plan.get("message") or ""),
                lambda r: r.equivalent,
                True,
            )
            d["message"] = majority([r.equivalent for r in v.results])
            d["message_actual"] = plan.get("message")
            d["message_judge_calls"] = v.calls
    out["detail"] = d
    out["args_ok"] = all(
        v
        for k, v in d.items()
        if k not in ("reason_recorded_for_reference", "message_actual", "message_judge_calls")
    )
    return out


def run_case(app_factory, q: dict, path: str, judge) -> dict:
    tools = MemoryToolStore()
    seed(tools, q["id"])
    app = app_factory(tools)
    before = snapshot(tools)
    rec = run_question(
        app, q["question"], q["store"], CURRENT_TIME[q["store"].lower()]
    )  # 확인 대기에서 멈춘다
    paused = rec["outcome"] == "needs_confirmation"
    at_pause = snapshot(tools)
    res: dict = {
        "id": q["id"],
        "path": path,
        "category": rec["category"],
        "outcome_first": rec["outcome"],
        "plan": rec["tool_plan"],
        "confirmation": rec.get("confirmation"),
        "answer_first": rec["answer"],
        "store_unchanged_at_pause": at_pause == before,
    }
    res |= check_args(q, rec["tool_plan"] or {}, judge)
    is_write = q["requires_confirmation"]
    res["confirmation_shown"] = paused
    if is_write:
        final = resume_question(app, rec["thread_id"], approve=(path == "approve")) if paused else rec
        after = snapshot(tools)
        res["outcome_final"], res["answer_final"], res["after"] = final["outcome"], final["answer"], after
        if path == "approve":
            res["executed_ok"] = (
                sum(after.values()) - sum(before.values()) == 1 and final["outcome"] == "tool_done"
            )
        else:
            res["executed_ok"] = (
                after == before and final["outcome"] == "tool_rejected" and final["answer"] == REJECT_TEXT
            )
    else:  # 조회: 확인 없이 결과 반환, 저장 변화 없음
        res["outcome_final"], res["answer_final"], res["after"] = (
            rec["outcome"],
            rec["answer"],
            snapshot(tools),
        )
        res["executed_ok"] = (
            rec["outcome"] == "tool_result"
            and "김밥 2개" in rec["answer"]
            and "도시락 1개" in rec["answer"]
            and after_same(before, res["after"])
        )
    write_ok = (not is_write) or (paused and res["store_unchanged_at_pause"])
    res["tool_accuracy_ok"] = bool(res["tool_ok"] and res["args_ok"] and write_ok)
    return res, tools, app


def after_same(a: dict, b: dict) -> bool:
    return a == b


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    s = get_settings()
    assert s.anthropic_api_key and s.groq_api_key
    claude = CostTracker(1.0, "anthropic")
    groq = CostTracker(None, "groq")
    judge = GroqJudge(s.groq_api_key, s.judge_model, groq)
    llm = make_llm("sonnet", s.anthropic_api_key, s.agent_model, claude)

    def factory(tools):
        return build_agent(
            AgentDeps(llm=llm, embedder=None, store=MemoryStore(), tool_store=tools, clock=lambda: TODAY)
        )

    gold = [json.loads(x) for x in (ROOT / "eval" / "golden.jsonl").read_text(encoding="utf-8").splitlines()]
    tools_q = [q for q in gold if q["type"] == "tool"]
    results = []
    dup = None
    for q in tools_q:
        for path in ("approve", "reject"):
            res, tools, app = run_case(factory, q, path, judge)
            results.append(res)
            print(
                f"{q['id']} {path}: 도구 {res['tool_ok']} 인자 {res['args_ok']} 확인 {res['confirmation_shown']} 실행 {res['executed_ok']} → {'OK' if res['tool_accuracy_ok'] else 'FAIL'}",
                flush=True,
            )
            if (
                q["id"] == "U03" and path == "approve"
            ):  # 멱등성: 같은 매장·근무일에 다시 요청하면 확인 없이 안내
                again = run_question(app, q["question"], q["store"], CURRENT_TIME["s1"])
                dup = {
                    "outcome": again["outcome"],
                    "answer": again["answer"],
                    "records": len(tools.checklist),
                }
                print("U03 재요청:", dup, flush=True)

    summary = {}
    for path in ("approve", "reject"):
        rs = [r for r in results if r["path"] == path]
        summary[path] = {
            "tool_accuracy": f"{sum(r['tool_accuracy_ok'] for r in rs)}/{len(rs)}",
            "tool_ok": f"{sum(r['tool_ok'] for r in rs)}/{len(rs)}",
            "args_ok": f"{sum(r['args_ok'] for r in rs)}/{len(rs)}",
            "confirmation_before_write": f"{sum(r['confirmation_shown'] and r['store_unchanged_at_pause'] for r in rs if r['id'] != 'U02')}/4",
            "executed_ok": f"{sum(r['executed_ok'] for r in rs)}/{len(rs)}",
        }
    out = {
        "date": date.today().isoformat(),
        "agent_model": s.agent_model,
        "judge_model": s.judge_model,
        "summary": summary,
        "idempotency_recheck_U03": dup,
        "cases": results,
        "cost": {"anthropic_usd": round(claude.run_cost, 4), "groq_usd": round(groq.run_cost, 4)},
    }
    base = ROOT / "eval" / "results" / f"{date.today().isoformat()}-tools"
    base.with_suffix(".json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8"
    )
    L = [
        f"# 쓰기 도구 평가 ({out['date']})",
        "",
        f"- 모델 {s.agent_model}, 저장소 메모리(0013 적용 전), 시계 고정 {TODAY.isoformat()}, 도구 문항 U01~U05 × 승인·거절 두 경로 = 10건",
        "- 도구 정확도 = 올바른 도구·인자(사유 제외) + 쓰기는 저장 전 확인 단계를 거침. 사유는 참고로 표기(골든셋 U01·U05에서 reason 제거)",
        "",
        "| 경로 | 도구 정확도 | 도구 일치 | 인자 일치 | 저장 전 확인(쓰기 4) | 실행 결과 정확 |",
        "|---|---|---|---|---|---|",
    ]
    for path, m in summary.items():
        L.append(
            f"| {'승인' if path == 'approve' else '거절'} | {m['tool_accuracy']} | {m['tool_ok']} | {m['args_ok']} | {m['confirmation_before_write']} | {m['executed_ok']} |"
        )
    L += [
        "",
        "## 문항별",
        "",
        "| 문항 | 경로 | 도구 | 인자 | 확인 | 실행 | 인자 상세 | 확인 문구 / 결과 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        detail = {k: v for k, v in r["detail"].items() if k != "message_judge_calls"}
        text = (r["answer_first"] if r["confirmation_shown"] else r["answer_final"]).replace("\n", " / ")
        L.append(
            f"| {r['id']} | {r['path']} | {r['tool_ok']} | {r['args_ok']} | {r['confirmation_shown']} | {r['executed_ok']} | {detail} | {text[:110]} |"
        )
    L += [
        "",
        f"- 멱등성(U03 승인 후 같은 요청 재실행): {dup}",
        f"- 비용: Claude ${out['cost']['anthropic_usd']}, Groq ${out['cost']['groq_usd']}",
    ]
    base.with_suffix(".md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
