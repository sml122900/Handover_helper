import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "eval"))
_spec = importlib.util.spec_from_file_location("eval_run", ROOT / "eval" / "run.py")
run = importlib.util.module_from_spec(_spec)
sys.modules["eval_run"] = run
_spec.loader.exec_module(run)

from graph.agent import NO_TASKS_REPLY, RECORD_REPLY, escalation_text  # noqa: E402


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
    assert run.template_kind(q, rec("record_request", RECORD_REPLY)) == "record_request"
    assert run.template_kind(q, rec("no_tasks", NO_TASKS_REPLY)) == "no_tasks"
    assert (
        run.template_kind(q, rec("answered", RECORD_REPLY)) is None
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
