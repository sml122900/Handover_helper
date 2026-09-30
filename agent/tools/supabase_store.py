"""0013 테이블에 쓰는 도구 저장소 (Supabase PostgREST, service_role). 메모리 구현과 같은 인터페이스.

0013 적용 전에는 실행할 수 없다 — 적용 후 `tests/test_supabase_tools.py`가 메모리 구현과 같은 결과인지 확인한다.
"""

from datetime import date, datetime

import httpx

from tools.store import DuplicateChecklist
from tools.timeutil import SEOUL


def _dt(v: str) -> datetime:
    return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(SEOUL)


class SupabaseToolStore:
    def __init__(self, url: str, service_key: str):
        self._base = url.rstrip("/") + "/rest/v1"
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        self._http = httpx.Client(timeout=30)

    def _check(self, r: httpx.Response, ok_conflict: bool = False) -> httpx.Response:
        if r.status_code >= 400 and not (ok_conflict and r.status_code == 409):
            raise RuntimeError(f"도구 저장소 오류 {r.status_code}: {r.text[:300]} (0013 적용 여부 확인)")
        return r

    def _get(self, table: str, **params) -> list[dict]:
        return self._check(
            self._http.get(f"{self._base}/{table}", headers=self._headers, params=params)
        ).json()

    def _row(self, r: dict) -> dict:
        out = dict(r)
        if "work_date" in out:
            out["work_date"] = date.fromisoformat(out["work_date"])
        for k in ("logged_at", "created_at"):
            if k in out:
                out[k] = _dt(out[k])
        return out

    def checklist_get(self, store_id, step_id, work_date, slot):
        rows = self._get(
            "handover_checklist_logs",
            store_id=f"eq.{store_id}",
            step_id=f"eq.{step_id}",
            work_date=f"eq.{work_date.isoformat()}",
            slot=f"eq.{slot}",
        )
        return self._row(rows[0]) if rows else None

    def checklist_add(self, store_id, step_id, work_date, slot, note, logged_at):
        r = self._http.post(
            f"{self._base}/handover_checklist_logs",
            headers=self._headers,
            json={
                "store_id": store_id,
                "step_id": step_id,
                "work_date": work_date.isoformat(),
                "slot": slot,
                "note": note,
                "logged_at": logged_at.isoformat(),
            },
        )
        if r.status_code == 409:  # unique 위반 = 이미 기록됨
            existing = self.checklist_get(store_id, step_id, work_date, slot)
            raise DuplicateChecklist(existing or {"logged_at": logged_at})
        return self._row(self._check(r).json()[0])

    def checklist_done(self, store_id, work_date):
        rows = self._get(
            "handover_checklist_logs", store_id=f"eq.{store_id}", work_date=f"eq.{work_date.isoformat()}"
        )
        return {(r["step_id"], r["slot"]) for r in rows}

    def waste_add(self, store_id, item, qty, reason, work_date, logged_at):
        r = self._http.post(
            f"{self._base}/handover_waste_logs",
            headers=self._headers,
            json={
                "store_id": store_id,
                "item": item,
                "qty": qty,
                "reason": reason,
                "work_date": work_date.isoformat(),
                "logged_at": logged_at.isoformat(),
            },
        )
        return self._row(self._check(r).json()[0])

    def waste_list(self, store_id, work_date):
        rows = self._get(
            "handover_waste_logs",
            store_id=f"eq.{store_id}",
            work_date=f"eq.{work_date.isoformat()}",
            order="logged_at.asc",
        )
        return [self._row(r) for r in rows]

    def notify_add(self, store_id, message, urgency, created_at):
        r = self._http.post(
            f"{self._base}/handover_notifications",
            headers=self._headers,
            json={
                "store_id": store_id,
                "message": message,
                "urgency": urgency,
                "created_at": created_at.isoformat(),
            },
        )
        return self._row(self._check(r).json()[0])

    def delete_by_store(self, store_id: str) -> None:
        """테스트 정리용: 이 store_id의 행 전부 삭제 (예: rls-test 등 가상 매장 ID)."""
        for t in ("handover_checklist_logs", "handover_waste_logs", "handover_notifications"):
            self._check(
                self._http.delete(
                    f"{self._base}/{t}", headers=self._headers, params={"store_id": f"eq.{store_id}"}
                )
            )
