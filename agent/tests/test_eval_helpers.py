import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "eval"))
_spec = importlib.util.spec_from_file_location("eval_run", ROOT / "eval" / "run.py")
run = importlib.util.module_from_spec(_spec)
sys.modules["eval_run"] = run
_spec.loader.exec_module(run)

from graph.agent import NO_TASKS_REPLY, OUT_OF_SCOPE_REPLY, escalation_text  # noqa: E402


def rec(outcome, answer, **kw):
    return {"outcome": outcome, "answer": answer, "evidence": [], "retrieval_log": [], "trace": [], **kw}


def test_template_kind_requires_exact_match():
    q = {"question": "원두 발주 어떻게 해요?"}
    exact = escalation_text(q["question"], False)
    assert run.template_kind(q, rec("escalated", exact, safety=False)) == "escalation"
    # 안전 문항은 응급 안내가 붙은 문구와 일치해야 한다
    assert (
        run.template_kind(q, rec("escalated", escalation_text(q["question"], True), safety=True))
        == "escalation"
    )
    assert run.template_kind(q, rec("escalated", exact, safety=True)) is None  # 안전 플래그와 문구가 어긋남
    assert (
        run.template_kind(q, rec("escalated", exact + " 그리고 추측이지만 보통 3일 걸려요.", safety=False))
        is None
    )
    assert run.template_kind(q, rec("out_of_scope", OUT_OF_SCOPE_REPLY)) == "out_of_scope"
    assert run.template_kind(q, rec("no_tasks", NO_TASKS_REPLY)) == "no_tasks"
    assert (
        run.template_kind(q, rec("answered", OUT_OF_SCOPE_REPLY)) is None
    )  # 답변 경로에서 나온 문구는 건너뛰지 않음


def test_received_chunks_adds_first_attempt_from_offsets():
    """재검색 전 검색 결과는 본문이 기록에 없어 위치로 복원해 근거에 포함한다."""
    text = (ROOT / "data" / "virtual" / "s1.txt").read_bytes().decode("utf-8")
    r = rec(
        "answered",
        "답",
        evidence=[{"source_file": "data/virtual/s1.txt", "char_start": 0, "text": text[:20]}],
        retrieval_log=[
            {"attempt": 0, "top5": [{"file": "data/virtual/s1.txt", "start": 30, "end": 60}]},
            {"attempt": 1, "top5": [{"file": "data/virtual/s1.txt", "start": 0, "end": 20}]},
        ],
    )
    chunks = run.received_chunks(r)
    assert chunks == [text[:20], text[30:60]]  # 최종 근거 + 재검색 전 청크(중복 제외)


def test_latency_breakdown_rewrite_path_share():
    trace = [
        {"node": "classify", "latency_ms": 100},
        {"node": "retrieve", "latency_ms": 10},
        {"node": "sufficiency", "latency_ms": 200},
        {"node": "rewrite", "latency_ms": 50},
        {"node": "retrieve", "latency_ms": 10},
        {"node": "sufficiency", "latency_ms": 200},
        {"node": "escalate", "latency_ms": 0},
    ]
    recs = {"N01": rec("escalated", "x", rewritten=True, trace=trace)}
    lb = run.latency_breakdown(recs, {"N01": "absent"})
    a = lb["absent_rewrite_path"]
    assert a["mean_total_ms"] == 570 and a["mean_rewrite_path_ms"] == 260  # rewrite+retrieve+sufficiency
    assert a["mean_without_rewrite_path_ms"] == 310
    assert lb["nodes"]["sufficiency"]["calls"] == 2


def test_g_confirm_criteria():
    """실험 G 확인 실행 사전 기준 a~d (결정 로그 2026-10-01)."""
    import compare

    def m(acc, unf_ids, p50, refusal=10):
        return {
            "acc_full": acc,
            "unfaithful": len(unf_ids),
            "unfaithful_ids": unf_ids,
            "p50": p50,
            "refusal": refusal,
        }

    ref = [m(14, ["F05"], 13000), m(14, ["F05", "F07"], 13000), m(14, [], 13000)]
    ok = [m(13, ["F05"], 10000), m(15, ["F09"], 10000), m(12, ["F07"], 10000)]  # 쌍3이 -2
    _, passed = compare.g_confirm(ref, ok)
    assert not passed  # b: 쌍3이 -2
    ok[2] = m(13, ["F07"], 10000)
    _, passed = compare.g_confirm(ref, ok)
    assert passed  # F09는 통합에서 1/3뿐
    only = [m(14, ["F09"], 10000), m(14, ["F09"], 10000), m(14, [], 10000)]
    lines, passed = compare.g_confirm(ref, only)
    assert not passed and any("['F09']" in x for x in lines)  # c: 통합에서만 2/3
    slow = [m(14, [], 10000), m(14, [], 13500), m(14, [], 10000)]
    assert not compare.g_confirm(ref, slow)[1]  # d: 쌍2가 느림
    refusal = [m(14, [], 10000, 9), m(14, [], 10000), m(14, [], 10000)]
    assert not compare.g_confirm(ref, refusal)[1]  # a
    many = [m(14, ["F01", "F02", "F10"], 10000), m(14, ["F03", "F04", "F06"], 10000), m(14, ["F08"], 10000)]
    assert not compare.g_confirm(ref, many)[1]  # c: 평균 차이 +1.33


def test_exp_f_helpers():
    """실험 F: 캐시 없다고 가정한 비용, 다른 매장 근거 인용 수, 직선 교차 배수."""
    import exp_f

    r = {"input_tokens": 1000, "cache_write_tokens": 0, "cache_read_tokens": 9000, "output_tokens": 100}
    assert exp_f.no_cache_cost(r) == pytest.approx((10000 * 3 + 100 * 15) / 1e6)
    rec = {
        "store_id": "s1",
        "evidence": [{"n": 1, "store_id": "s1"}, {"n": 2, "store_id": "s2"}],
        "citations": [{"n": 1}, {"n": 2}],
    }
    assert exp_f.other_store_citations(rec) == 1
    assert exp_f.crossing([1, 2, 5], [1.0, 2.0, 5.0], 3.0) == pytest.approx(3.0)
    assert (
        exp_f.crossing([1, 2, 5], [1.0, 1.5, 2.0], 3.0) is None
    )  # 측정 범위 안에서 넘지 않으면 외삽하지 않음
    assert exp_f.crossing([1, 2, 5], [3.0, 2.0, 1.0], 2.5) == 1.0  # 1배부터 이미 넘음
