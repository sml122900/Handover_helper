"""0013 적용 후: Supabase 도구 저장소가 메모리 구현과 같이 동작하는지 (환경변수 없으면 skip). 가상 매장 ID로 쓰고 지운다."""

from datetime import date, datetime

import pytest

from settings import Settings
from tools.store import DuplicateChecklist, MemoryToolStore
from tools.timeutil import SEOUL

s = Settings()
enabled = bool(s.supabase_url and s.supabase_service_role_key)
STORE = "parity-test"


@pytest.mark.skipif(not enabled, reason="Supabase 환경변수 없음")
def test_supabase_store_matches_memory_behavior():
    from tools.supabase_store import SupabaseToolStore

    db = SupabaseToolStore(s.supabase_url, s.supabase_service_role_key)
    try:
        db.checklist_done(STORE, date(2026, 10, 1))
    except RuntimeError:
        pytest.skip("0013_agent_tool_logs.sql 미적용 — 적용 후 다시 실행")
    mem = MemoryToolStore()
    d, now = date(2026, 10, 1), datetime(2026, 10, 1, 21, 42, tzinfo=SEOUL)
    try:
        db.delete_by_store(STORE)
        for store in (db, mem):
            row = store.checklist_add(STORE, "s1.machine_clean", d, "", None, now)
            assert row["step_id"] == "s1.machine_clean"
            with pytest.raises(DuplicateChecklist) as e:
                store.checklist_add(STORE, "s1.machine_clean", d, "", None, now)
            assert e.value.existing["logged_at"].strftime("%H:%M") == "21:42"
            store.checklist_add(STORE, "s3.shift_cash_check", d, "22:00", None, now)
            store.checklist_add(STORE, "s3.shift_cash_check", d, "07:50", None, now)  # 슬롯이 다르면 별도
            assert store.checklist_done(STORE, d) == {
                ("s1.machine_clean", ""),
                ("s3.shift_cash_check", "22:00"),
                ("s3.shift_cash_check", "07:50"),
            }
            store.waste_add(STORE, "김밥", 3, "사유 미기재", d, now)
            store.waste_add(STORE, "김밥", 1, "유통기한 경과", d, now)
            assert [(r["item"], r["qty"]) for r in store.waste_list(STORE, d)] == [("김밥", 3), ("김밥", 1)]
            assert store.notify_add(STORE, "테스트", "urgent", now)["urgency"] == "urgent"
    finally:
        db.delete_by_store(STORE)
