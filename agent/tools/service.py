"""쓰기 도구 로직 (설계 6절): 계획 검증 → 되물음 / 조회 / 중복 안내 / 확인 대기 → 실행.

쓰기 도구는 여기서 실행하지 않고 `Pending`을 돌려준다. 실제 실행(`execute`)은 사용자 승인 뒤에만 호출된다.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from tools.plan import ToolPlan
from tools.store import DuplicateChecklist, ToolStore
from tools.timeutil import slot_for, work_date

REASON_UNSET = "미기재"
REASON_PROMPT = "사유: 미기재 — 추가할 내용이 있으면 말씀해 주세요"
STORED_REASON_UNSET = "사유 미기재"
REJECT_TEXT = "기록하지 않았어요. 수정할 내용이 있으면 말씀해 주세요."


@dataclass
class Clarify:
    text: str
    options: list[str] = field(default_factory=list)


@dataclass
class Done:
    """확인 없이 끝나는 경우: 조회 결과, 중복 안내."""

    kind: str  # query | duplicate
    text: str
    data: list[dict] = field(default_factory=list)


@dataclass
class Pending:
    """사용자 확인 대기 중인 쓰기: 확인 문구와 실행에 필요한 인자."""

    tool: str  # waste_log | log_checklist | notify_manager
    args: dict
    text: str


def step_catalog(store: dict) -> dict[str, str]:
    """step_id → 일정 항목 문구 (체크리스트 후보 목록 / 확인 문구용). 같은 step이 여러 번이면 첫 항목."""
    out: dict[str, str] = {}
    for item in store["items"]:
        for sid in item["step_ids"]:
            out.setdefault(sid, item["text"])
    return out


def catalog_prompt(store: dict) -> str:
    return "\n".join(f"- {sid}: {text}" for sid, text in step_catalog(store).items())


def resolve_date(plan: ToolPlan, today: date) -> date | None:
    if plan.date_ref in (None, "today"):
        return today
    if plan.date_ref == "yesterday":
        return today - timedelta(days=1)
    try:
        return date.fromisoformat(plan.date or "")
    except ValueError:
        return None


def plan_action(plan: ToolPlan, store_id: str, store: dict, now: datetime, tools: ToolStore):
    """검증된 계획 → Clarify | Done | Pending. 쓰기는 실행하지 않는다."""
    wd = work_date(store, now)

    if plan.tool == "unclear":
        return Clarify(
            "어떤 기록·조회를 원하시는지 잘 모르겠어요. 폐기 기록, 체크리스트 완료, 점장님께 알림 중 무엇인지 알려 주세요."
        )

    if plan.tool == "waste_log_query":
        d = resolve_date(plan, wd)
        if d is None:
            return Clarify("조회할 날짜를 알려 주세요. (예: 오늘, 어제, 2026-09-30)")
        rows = tools.waste_list(store_id, d)
        if not rows:
            return Done("query", f"{d.isoformat()}에 기록된 폐기 내역이 없어요.", [])
        lines = [f"- {r['item']} {r['qty']}개 (사유: {r['reason']})" for r in rows]
        return Done("query", f"{d.isoformat()} 폐기 대장 ({len(rows)}건)\n" + "\n".join(lines), rows)

    if plan.tool == "waste_log_record":
        missing = [n for n, v in (("품목", plan.item), ("수량", plan.qty)) if not v]
        if missing or (plan.qty is not None and plan.qty <= 0):
            return Clarify(f"폐기 기록에 {'·'.join(missing) or '수량'}이(가) 필요해요. 알려 주세요.")
        same = sum(1 for r in tools.waste_list(store_id, wd) if r["item"] == plan.item)
        reason = (plan.reason or "").strip()
        text = (
            f"{plan.item} {plan.qty}개를 폐기 대장에 기록할까요?\n"
            f"{('사유: ' + reason) if reason else REASON_PROMPT}\n"
            f"(오늘 같은 품목 기록 {same}건 있음)"
        )
        args = {"item": plan.item, "qty": plan.qty, "reason": reason or None, "same_item_today": same}
        return Pending("waste_log", args, text)

    if plan.tool == "log_checklist":
        catalog = step_catalog(store)
        if plan.step_id and plan.step_id in catalog:
            slot = slot_for(store, plan.step_id, now)
            existing = tools.checklist_get(store_id, plan.step_id, wd, slot)
            if existing:
                t = existing["logged_at"].strftime("%H:%M")
                return Done("duplicate", f"오늘 {t}에 이미 기록돼 있어요.")
            text = f"'{catalog[plan.step_id]}'({plan.step_id}) 완료를 체크리스트에 기록할까요?"
            if plan.note:
                text += f"\n메모: {plan.note}"
            return Pending("log_checklist", {"step_id": plan.step_id, "slot": slot, "note": plan.note}, text)
        options = [c for c in plan.step_candidates if c in catalog][:3] or list(catalog)[:3]
        listing = "\n".join(f"{i}) {c} — {catalog[c]}" for i, c in enumerate(options, start=1))
        return Clarify(f"어느 단계를 기록할지 정확히 모르겠어요. 골라 주세요:\n{listing}", options)

    if plan.tool == "notify_manager":
        if not (plan.message or "").strip():
            return Clarify("점장님께 전할 내용을 알려 주세요.")
        urgency = plan.urgency or "normal"
        text = (
            f"점장님께 알림을 보낼까요?\n내용: {plan.message}\n긴급도: {'긴급' if urgency == 'urgent' else '보통'}\n"
            "(모의 발송 — 실제로 전송되지 않고 기록만 남아요)"
        )
        return Pending("notify_manager", {"message": plan.message, "urgency": urgency}, text)

    return Clarify("처리할 수 없는 요청이에요.")


def execute(
    pending: Pending, store_id: str, store: dict, now: datetime, tools: ToolStore, reason: str | None = None
) -> str:
    """승인 뒤에만 호출. 사유는 확인 단계에서 사용자가 준 값이 있으면 그것, 없으면 '사유 미기재'."""
    wd = work_date(store, now)
    a = pending.args
    if pending.tool == "waste_log":
        final_reason = (reason or a.get("reason") or "").strip() or STORED_REASON_UNSET
        row = tools.waste_add(store_id, a["item"], a["qty"], final_reason, wd, now)
        return f"폐기 대장에 기록했어요. (기록 ID {row['id']}, 사유: {final_reason})"
    if pending.tool == "log_checklist":
        try:
            row = tools.checklist_add(store_id, a["step_id"], wd, a["slot"], a.get("note"), now)
        except DuplicateChecklist as e:  # 확인 사이에 다른 곳에서 먼저 기록된 경우
            return f"오늘 {e.existing['logged_at'].strftime('%H:%M')}에 이미 기록돼 있어요."
        return f"체크리스트에 기록했어요. (기록 ID {row['id']})"
    row = tools.notify_add(store_id, a["message"], a["urgency"], now)
    return f"점장님께 알림을 남겼어요. (모의 발송, 기록 ID {row['id']})"
