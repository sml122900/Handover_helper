"""쓰기 도구 3종 + 확인 단계 (설계 6절). LLM은 스크립트로 대체, 저장소는 메모리."""

import pathlib
from datetime import date, datetime

import pytest

from graph.agent import AgentDeps, build_agent, pending_confirmation, resume_question, run_question
from graph.schemas import Classification
from graph.tools import get_current_tasks, load_schedules
from indexing.store import MemoryStore
from llm.client import CallInfo
from tools.plan import ToolPlan
from tools.service import REASON_PROMPT, REJECT_TEXT
from tools.store import DuplicateChecklist, MemoryToolStore
from tools.timeutil import SEOUL, slot_for, work_date

INFO = CallInfo("fake", 5, 10, 5, 0.0)
SCHEDULES = load_schedules()


class Script:
    model = "fake"

    def __init__(self, plans):
        self.plans = list(plans)

    def structured(self, *, system, user, schema, tool_name, max_tokens=1024, tag=""):
        if tag == "classify":
            return Classification(reasoning="r", category="record_request", safety_related=False), INFO
        assert tag == "tool_plan"
        self.last_user = user
        return self.plans.pop(0), INFO

    def text(self, **kw):  # 도구 경로에서는 답변 LLM을 부르지 않는다
        raise AssertionError("도구 경로에서 text LLM 호출")


def dt(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=SEOUL)


def make(plans, tools=None, clock=None):
    tools = tools or MemoryToolStore()
    deps = AgentDeps(
        llm=Script(plans),
        embedder=None,
        store=MemoryStore(),
        tool_store=tools,
        clock=lambda: clock or dt(2026, 10, 1, 21, 40),
    )
    return build_agent(deps), tools


def plan(**kw):
    base = dict(reasoning="r", tool="unclear")
    return ToolPlan(**{**base, **kw})


def test_waste_record_needs_confirmation_and_writes_only_on_approve():
    app, tools = make([plan(tool="waste_log_record", item="티라미수", qty=2)])
    rec = run_question(app, "티라미수 2개 폐기했어요, 기록 좀 해주세요", "s1")
    assert rec["outcome"] == "needs_confirmation" and tools.waste == []  # 쓰기 전에 멈춘다
    assert "티라미수 2개를 폐기 대장에 기록할까요?" in rec["answer"]
    assert REASON_PROMPT in rec["answer"]  # 사유 추정 없이 미기재로 안내
    assert "오늘 같은 품목 기록 0건 있음" in rec["answer"]
    assert pending_confirmation(app, rec["thread_id"])["tool"] == "waste_log"
    done = resume_question(app, rec["thread_id"], approve=True)
    assert done["outcome"] == "tool_done" and len(tools.waste) == 1
    row = tools.waste[0]
    assert (row["store_id"], row["item"], row["qty"], row["reason"]) == ("s1", "티라미수", 2, "사유 미기재")


def test_reject_does_not_write():
    app, tools = make([plan(tool="waste_log_record", item="김밥", qty=3)])
    rec = run_question(app, "김밥 3개 폐기 등록했어요", "s3")
    done = resume_question(app, rec["thread_id"], approve=False)
    assert done["outcome"] == "tool_rejected" and done["answer"] == REJECT_TEXT and tools.waste == []


def test_reason_given_at_confirmation_is_stored_and_same_item_count_shown():
    tools = MemoryToolStore()
    app, _ = make(
        [
            plan(tool="waste_log_record", item="케이크", qty=1),
            plan(tool="waste_log_record", item="케이크", qty=2),
        ],
        tools,
    )
    r1 = run_question(
        app, "케이크 1개 폐기 기록", "s1", auto_confirm="approve", decision_reason="유통기한 경과"
    )
    assert tools.waste[0]["reason"] == "유통기한 경과" and r1["outcome"] == "tool_done"
    r2 = run_question(app, "케이크 2개 폐기 기록", "s1")
    assert "오늘 같은 품목 기록 1건 있음" in r2["answer"]  # 중복 차단이 아니라 건수 표시


def test_reason_in_question_is_used_without_prompt():
    app, tools = make([plan(tool="waste_log_record", item="우유", qty=1, reason="개봉 24시간 경과")])
    rec = run_question(app, "개봉 24시간 지난 우유 1개 폐기 기록", "s1")
    assert "사유: 개봉 24시간 경과" in rec["answer"] and REASON_PROMPT not in rec["answer"]
    resume_question(app, rec["thread_id"], approve=True)
    assert tools.waste[0]["reason"] == "개봉 24시간 경과"


def test_missing_qty_asks_back_without_interrupt():
    app, tools = make([plan(tool="waste_log_record", item="빵", qty=None, missing="수량")])
    rec = run_question(app, "빵 폐기했어요 기록해줘", "s2")
    assert rec["outcome"] == "clarify" and "수량" in rec["answer"] and tools.waste == []


def test_checklist_confirm_then_duplicate_notice():
    app, tools = make(
        [
            plan(tool="log_checklist", step_id="s1.machine_clean"),
            plan(tool="log_checklist", step_id="s1.machine_clean"),
        ]
    )
    r1 = run_question(app, "머신 청소 끝났어요, 체크해주세요", "s1")
    assert (
        r1["outcome"] == "needs_confirmation" and "s1.machine_clean" in r1["answer"] and tools.checklist == []
    )
    resume_question(app, r1["thread_id"], approve=True)
    assert len(tools.checklist) == 1
    r2 = run_question(app, "머신 청소 끝났어요, 체크해주세요", "s1")
    assert r2["outcome"] == "duplicate" and "이미 기록돼 있어요" in r2["answer"] and "21:40" in r2["answer"]
    assert len(tools.checklist) == 1  # 중복은 확인 단계 없이 기록하지 않음


def test_ambiguous_checklist_step_returns_candidates():
    app, _ = make(
        [
            plan(
                tool="log_checklist",
                step_id=None,
                step_candidates=["s1.cake_waste", "s1.machine_clean", "nonexistent"],
            )
        ]
    )
    rec = run_question(app, "정리 끝났어요 체크해줘", "s1")
    assert rec["outcome"] == "clarify" and rec["options"] == [
        "s1.cake_waste",
        "s1.machine_clean",
    ]  # 없는 step은 걸러냄


def test_repeated_step_slot_allows_start_and_end_checks_of_same_shift():
    """S3 shift_cash_check는 22:00·07:50 두 번 — 같은 근무의 두 번째 점검이 중복으로 막히지 않는다."""
    tools = MemoryToolStore()
    s3 = SCHEDULES["s3"]
    assert slot_for(s3, "s3.shift_cash_check", dt(2026, 10, 1, 22, 5)) == "22:00"
    assert slot_for(s3, "s3.shift_cash_check", dt(2026, 10, 2, 7, 55)) == "07:50"
    assert slot_for(s3, "s3.waste_check_03", dt(2026, 10, 2, 3, 5)) == ""  # 반복 step이 아니면 빈 값
    assert work_date(s3, dt(2026, 10, 2, 7, 55)) == date(2026, 10, 1)  # 자정 이후는 근무 시작일 소속
    assert work_date(s3, dt(2026, 10, 1, 22, 5)) == date(2026, 10, 1)
    app_a, _ = make(
        [plan(tool="log_checklist", step_id="s3.shift_cash_check")], tools, clock=dt(2026, 10, 1, 22, 5)
    )
    app_b, _ = make(
        [plan(tool="log_checklist", step_id="s3.shift_cash_check")], tools, clock=dt(2026, 10, 2, 7, 55)
    )
    app_c, _ = make(
        [plan(tool="log_checklist", step_id="s3.shift_cash_check")], tools, clock=dt(2026, 10, 2, 22, 10)
    )
    for app in (app_a, app_b, app_c):
        r = run_question(app, "시재 점검 끝났어요 체크해줘", "s3", auto_confirm="approve")
        assert r["outcome"] == "tool_done"
    assert len(tools.checklist) == 3  # 22:00 / 07:50(같은 근무일) / 다음 근무 22:00
    with pytest.raises(DuplicateChecklist):
        tools.checklist_add(
            "s3", "s3.shift_cash_check", date(2026, 10, 1), "22:00", None, dt(2026, 10, 1, 22, 30)
        )


def test_waste_query_yesterday_reads_without_confirmation():
    tools = MemoryToolStore()
    tools.waste_add("s3", "김밥", 2, "사유 미기재", date(2026, 9, 30), dt(2026, 9, 30, 23, 0))
    tools.waste_add("s3", "도시락", 1, "유통기한 경과", date(2026, 9, 30), dt(2026, 9, 30, 23, 5))
    app, _ = make([plan(tool="waste_log_query", date_ref="yesterday")], tools, clock=dt(2026, 10, 1, 23, 30))
    rec = run_question(app, "어제 폐기 뭐 했는지 보여줘요", "s3")
    assert rec["outcome"] == "tool_result" and "김밥 2개" in rec["answer"] and "도시락 1개" in rec["answer"]
    assert "2026-09-30" in rec["answer"] and "confirmation" not in rec


def test_notify_manager_is_mock_and_confirmed():
    app, tools = make([plan(tool="notify_manager", message="3번 러닝머신 벨트 미끄러짐", urgency="normal")])
    rec = run_question(app, "3번 러닝머신 벨트가 미끄러져요. 매니저님한테 알려주세요", "s4")
    assert (
        rec["outcome"] == "needs_confirmation" and "모의 발송" in rec["answer"] and tools.notifications == []
    )
    resume_question(app, rec["thread_id"], approve=True)
    assert len(tools.notifications) == 1 and tools.notifications[0]["mock"] is True


def test_completed_steps_are_excluded_from_current_tasks():
    done = {("s1.cake_waste", ""), ("s1.machine_clean", "")}
    base = get_current_tasks("s1", "21:35", SCHEDULES)
    after = get_current_tasks("s1", "21:35", SCHEDULES, done)
    assert [i["time"] for i in base["now"]] == ["21:30"] and after[
        "now"
    ] == []  # 21:30 일정의 step이 전부 완료
    assert set(after["done_excluded"]) == done_ids(done)
    partial = get_current_tasks("s1", "21:35", SCHEDULES, {("s1.cake_waste", "")})
    assert partial["now"][0]["step_ids"] == ["s1.machine_clean"]  # 일부만 완료면 남은 step만


def done_ids(done):
    return {sid for sid, _ in done}


def test_tasks_node_reads_completed_steps_from_tool_store(tmp_path):
    from graph.schemas import Classification as C

    tools = MemoryToolStore()
    tools.checklist_add("s1", "s1.cake_waste", date(2026, 10, 1), "", None, dt(2026, 10, 1, 21, 31))
    tools.checklist_add("s1", "s1.machine_clean", date(2026, 10, 1), "", None, dt(2026, 10, 1, 21, 33))

    class L(Script):
        def structured(self, *, tag="", **kw):
            return C(reasoning="r", category="now_tasks", safety_related=False), INFO

        def text(self, **kw):
            return "곧 22:00에 정산이 있어요. [근거 2]", INFO

    from test_graph import HashEmbedder, chunk

    emb = HashEmbedder("m", pathlib.Path(tmp_path))
    chunks = [
        chunk("s1", "document", "라스트오더 케이크 폐기 머신 청소 시작", 0, "2. 절차"),
        chunk("s1", "document", "음악 간판 끄기 마감 정산", 100, "2. 절차"),
    ]
    store = MemoryStore()
    store.add(chunks, emb.embed([c.embed_text for c in chunks], "document"))
    deps = AgentDeps(
        llm=L([]), embedder=emb, store=store, tool_store=tools, clock=lambda: dt(2026, 10, 1, 21, 40)
    )
    rec = run_question(build_agent(deps), "지금 뭐 해요?", "s1", current_time="21:35")
    assert (
        rec["tasks"]["now"] == [] and rec["tasks"]["upcoming"]
    )  # 완료된 일정은 지금에서 빠지고 곧(22:00)만 남는다
