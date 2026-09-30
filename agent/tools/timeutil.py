"""근무일·슬롯 규칙 (설계 6-3, 2026-10-01 갱신). 모든 날짜·시각은 Asia/Seoul."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

SEOUL = ZoneInfo("Asia/Seoul")


def now_kst() -> datetime:
    return datetime.now(SEOUL)


def with_time(base: datetime, hhmm: str | None) -> datetime:
    """요청에 명시된 current_time(HH:MM)이 있으면 그 시각으로, 없으면 base 그대로."""
    if not hhmm:
        return base
    h, m = hhmm.split(":")
    return base.replace(hour=int(h), minute=int(m), second=0, microsecond=0)


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def work_date(store: dict, now: datetime) -> date:
    """근무일 = KST 날짜. 야간 매장(overnight)의 자정 이후(근무 종료 시각 이전) 시각은 근무 시작일 소속."""
    if store.get("overnight") and _minutes(now.strftime("%H:%M")) < _minutes(store["work_end"]):
        return (now - timedelta(days=1)).date()
    return now.date()


def repeated_steps(store: dict) -> dict[str, list[str]]:
    """한 매장 일정에 둘 이상 나오는 step → 예정 시각 목록. (예: S3 shift_cash_check 22:00, 07:50)"""
    times: dict[str, list[str]] = {}
    for item in store["items"]:
        if not item.get("time"):
            continue
        for sid in item["step_ids"]:
            times.setdefault(sid, []).append(item["time"])
    return {sid: ts for sid, ts in times.items() if len(ts) > 1}


def slot_for(store: dict, step_id: str, now: datetime) -> str:
    """반복 step이면 현재 시각에 가장 가까운 예정 시각(원형 거리), 아니면 빈 값."""
    rep = repeated_steps(store).get(step_id)
    if not rep:
        return ""
    cur = _minutes(now.strftime("%H:%M"))

    def dist(t: str) -> int:
        d = abs(_minutes(t) - cur)
        return min(d, 1440 - d)

    return min(rep, key=dist)
