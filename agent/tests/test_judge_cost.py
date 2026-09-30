import pytest

from judge.groq import inline_refs
from judge.tasks import (
    AccuracyResult,
    FactCheck,
    PartCheck,
    RefusalResult,
    fact_covered,
    fact_covered_relevant,
    refusal_correct,
)
from llm.client import CallInfo, CostBudgetExceeded, CostTracker, cost_of, ledger_totals


def test_inline_refs_removes_defs_and_keeps_field_order():
    schema = inline_refs(AccuracyResult.model_json_schema())
    assert "$defs" not in schema and "$ref" not in str(schema)
    part = schema["properties"]["facts"]["items"]["properties"]["parts"]["items"]
    assert list(part["properties"]) == [
        "part",
        "relevant_to_question",
        "answer_quote",
        "covered",
    ]  # 인용이 covered 판정보다 앞
    assert part["additionalProperties"] is False and set(part["required"]) == set(part["properties"])


def test_fact_covered_needs_all_parts():
    ok = FactCheck(
        fact_id="C06", parts=[PartCheck(part="a", relevant_to_question=True, answer_quote="a", covered=True)]
    )
    bad = FactCheck(
        fact_id="C06",
        parts=[
            PartCheck(part="a", relevant_to_question=True, answer_quote="a", covered=True),
            PartCheck(part="b", relevant_to_question=False, answer_quote="", covered=False),
        ],
    )
    assert fact_covered(ok) and not fact_covered(bad) and not fact_covered(FactCheck(fact_id="x", parts=[]))
    assert fact_covered_relevant(bad)  # 빠진 조각이 질문과 무관하면 보조 지표에서는 포함으로 본다


def test_refusal_correct_rule():
    base = dict(
        not_in_doc_quote="q",
        manager_quote="q",
        guess_quote="",
        emergency_note_quote="",
        emergency_marked_not_from_doc=False,
    )
    assert refusal_correct(
        RefusalResult(states_not_in_doc=True, suggests_manager_check=True, gives_guess_answer=False, **base)
    )
    assert not refusal_correct(
        RefusalResult(states_not_in_doc=True, suggests_manager_check=True, gives_guess_answer=True, **base)
    )
    assert not refusal_correct(
        RefusalResult(states_not_in_doc=True, suggests_manager_check=False, gives_guess_answer=False, **base)
    )


def test_cost_tracker_budget_and_ledger(tmp_path):
    ledger = tmp_path / "l.jsonl"
    t = CostTracker(0.01, "anthropic", ledger)
    t.check()
    info = CallInfo("claude-sonnet-4-6", 5, 2000, 500, cost_of("claude-sonnet-4-6", 2000, 500))
    assert info.cost_usd == pytest.approx(0.0135)  # 2000*$3/M + 500*$15/M
    t.record(info, "x")
    with pytest.raises(CostBudgetExceeded) as e:
        t.check()
    assert "AGENT_COST_BUDGET_USD=$0.01" in str(e.value)
    tot = ledger_totals(ledger)["anthropic"]
    assert tot["calls"] == 1 and tot["in"] == 2000 and tot["usd"] == pytest.approx(0.0135)
