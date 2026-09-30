"""쓰기 도구 저장소 (0013 테이블과 같은 필드). 적용 전에는 메모리 구현으로 개발·평가한다."""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Protocol


class DuplicateChecklist(Exception):
    """(store_id, step_id, 근무일, 슬롯)이 이미 기록됨."""

    def __init__(self, existing: dict):
        super().__init__("이미 기록됨")
        self.existing = existing


class ToolStore(Protocol):
    def checklist_get(self, store_id: str, step_id: str, work_date: date, slot: str) -> dict | None: ...

    def checklist_add(
        self, store_id: str, step_id: str, work_date: date, slot: str, note: str | None, logged_at: datetime
    ) -> dict: ...

    def checklist_done(self, store_id: str, work_date: date) -> set[tuple[str, str]]: ...

    def waste_add(
        self, store_id: str, item: str, qty: int, reason: str, work_date: date, logged_at: datetime
    ) -> dict: ...

    def waste_list(self, store_id: str, work_date: date) -> list[dict]: ...

    def notify_add(self, store_id: str, message: str, urgency: str, created_at: datetime) -> dict: ...


@dataclass
class MemoryToolStore:
    checklist: list[dict] = field(default_factory=list)
    waste: list[dict] = field(default_factory=list)
    notifications: list[dict] = field(default_factory=list)

    def checklist_get(self, store_id, step_id, work_date, slot):
        return next(
            (
                r
                for r in self.checklist
                if (r["store_id"], r["step_id"], r["work_date"], r["slot"])
                == (store_id, step_id, work_date, slot)
            ),
            None,
        )

    def checklist_add(self, store_id, step_id, work_date, slot, note, logged_at):
        existing = self.checklist_get(store_id, step_id, work_date, slot)
        if existing:
            raise DuplicateChecklist(existing)
        row = {
            "id": f"mem-{uuid.uuid4().hex[:8]}",
            "store_id": store_id,
            "step_id": step_id,
            "work_date": work_date,
            "slot": slot,
            "note": note,
            "logged_at": logged_at,
        }
        self.checklist.append(row)
        return row

    def checklist_done(self, store_id, work_date):
        return {
            (r["step_id"], r["slot"])
            for r in self.checklist
            if r["store_id"] == store_id and r["work_date"] == work_date
        }

    def waste_add(self, store_id, item, qty, reason, work_date, logged_at):
        row = {
            "id": f"mem-{uuid.uuid4().hex[:8]}",
            "store_id": store_id,
            "item": item,
            "qty": qty,
            "reason": reason,
            "work_date": work_date,
            "logged_at": logged_at,
        }
        self.waste.append(row)
        return row

    def waste_list(self, store_id, work_date):
        return [r for r in self.waste if r["store_id"] == store_id and r["work_date"] == work_date]

    def notify_add(self, store_id, message, urgency, created_at):
        row = {
            "id": f"mem-{uuid.uuid4().hex[:8]}",
            "store_id": store_id,
            "message": message,
            "urgency": urgency,
            "created_at": created_at,
            "mock": True,
        }
        self.notifications.append(row)
        return row
