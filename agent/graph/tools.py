"""읽기 전용 도구: get_current_tasks (설계 6-1). data/virtual/schedules.json 기반, 시각은 Asia/Seoul."""

import json
from datetime import datetime
from zoneinfo import ZoneInfo

from settings import ROOT

SEOUL = ZoneInfo("Asia/Seoul")
# 지금 = 최근 30분 이내 시작한 일, 곧 = 30분 이내 시작할 일 (대칭). 폐기한 15분 창은 골든셋을 본 뒤 정한 값이라 평가셋 과적합 — 결정 로그 2026-10-01
WINDOW_MINUTES = 30


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _delta(item_time: str, now: int) -> int:
    """일정 시각까지 남은 분 (-720 초과 ~ 720 이하로 접어 자정을 넘는 근무도 처리)."""
    d = (_minutes(item_time) - now) % 1440
    return d - 1440 if d > 720 else d


def load_schedules() -> dict[str, dict]:
    data = json.loads((ROOT / "data" / "virtual" / "schedules.json").read_text(encoding="utf-8"))
    return {s["store_id"]: s for s in data["stores"]}


def get_current_tasks(store_id: str, current_time: str | None = None, schedules: dict | None = None) -> dict:
    """요청에 명시된 current_time(HH:MM)이 우선이고, 없으면 Asia/Seoul 현재 시각."""
    schedules = schedules or load_schedules()
    if current_time is None:
        now_dt = datetime.now(SEOUL)
        current_time = now_dt.strftime("%H:%M")
    now = _minutes(current_time)
    store = schedules.get(store_id.lower())
    if store is None:
        return {"store_id": store_id, "current_time": current_time, "found": False, "now": [], "upcoming": []}
    now_items, upcoming = [], []
    for item in store["items"]:
        if not item.get("time"):  # 요일·상황 조건 일정(예: 월요일 마감 시)은 시각이 없어 제외
            continue
        d = _delta(item["time"], now)
        entry = {"time": item["time"], "text": item["text"], "step_ids": item["step_ids"]}
        if -WINDOW_MINUTES <= d <= 0:
            now_items.append(entry)
        elif 0 < d <= WINDOW_MINUTES:
            upcoming.append(entry)
    return {
        "store_id": store_id,
        "current_time": current_time,
        "found": True,
        "now": now_items,
        "upcoming": upcoming,
    }
