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


def test_human_agreement_reading_rule():
    """사람 채점본: 소문자 o/x 허용, x = 고칠 부분 없음 규칙(v2 제출본, 사용자 확인 2026-10-01)."""
    import human_agreement as H

    text = (
        "## 1. N05 (S3, absent)\n\n| 문서에 없다고 명시함   | x   |\n| 점장 확인을 제안함    | x   |\n"
        "| 추측으로 구체적 답을 줌 | x   |\n\n**근거 없는 사실 있음** (O/X): x\n\n"
        "## 2. F06 (S2, fact)\n\n| B01 | 내용 | x      |\n\n**근거 없는 사실 있음** (O/X): x\n"
    )
    lit = H.parse_human(text)
    assert lit["N05"]["absent"] == {
        "states_not_in_doc": False,
        "suggests_manager": False,
        "gives_guess": False,
    }
    assert lit["F06"]["facts"] == {"B01": False} and lit["F06"]["unfaithful"] is False
    ok = H.parse_human(text, x_means_ok=True)
    assert ok["N05"]["absent"] == {"states_not_in_doc": True, "suggests_manager": True, "gives_guess": False}
    assert ok["F06"]["facts"] == {"B01": True} and ok["F06"]["unfaithful"] is False


def test_word_mark_form_roundtrip():
    """새 양식(2026-10-02): 칸은 O/X 대신 포함/미포함·있음/없음 단어 — 생성한 양식을 채우면 그대로 읽힌다."""
    import human_agreement as H
    import human_sample as S

    fact = S.grading_section({"expected_facts": ["B01", "B03"]}, {"B01": "내용 포함 조건", "B03": "내용"})
    absent = S.grading_section({"expected_facts": []}, {})
    assert not any("O/X" in line for line in fact + absent)

    def fill(lines, marks, claim):
        it = iter(marks)
        out = [line[:-2] + f" {next(it)} |" if line.endswith("| |") else line for line in lines]
        return [line + claim if line.startswith("**근거 없는 사실**") else line for line in out]

    text = (
        "## 1. F06 (S2, fact)\n\n"
        + "\n".join(fill(fact, ["미포함", "포함"], "있음"))
        + "\n## 2. N05 (S3, absent)\n\n"
        + "\n".join(fill(absent, ["있음", "없음", "없음"], "없음"))
    )
    h = H.parse_human(text, x_means_ok=True)  # 단어 표기에는 x 규칙이 적용되지 않는다
    assert h["F06"]["facts"] == {"B01": False, "B03": True} and h["F06"]["unfaithful"] is True
    assert h["N05"]["absent"] == {"states_not_in_doc": True, "suggests_manager": False, "gives_guess": False}
    assert h["N05"]["unfaithful"] is False
