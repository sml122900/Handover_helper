import pytest

from graph.tools import get_current_tasks


def steps(items):
    return {s for i in items for s in i["step_ids"]}


@pytest.mark.parametrize(
    ("store", "time", "now", "upcoming"),
    [
        ("s1", "21:35", {"s1.cake_waste", "s1.machine_clean"}, {"s1.lights_off", "s1.closing_settle"}),
        ("s2", "20:35", {"s2.discount_sticker"}, {"s2.waste_sort", "s2.oven_cooldown"}),
        ("s3", "02:05", {"s3.drink_stock"}, set()),  # 03:00 폐기 점검은 55분 뒤 = 30분 밖
        (
            "s4",
            "06:50",
            {"s4.drink_fridge"},
            {"s4.towel_receive"},
        ),  # 06:30 일정은 20분 전 = 최근 30분 이내라 '지금'
        ("s5", "23:20", set(), {"s5.meal_break"}),
    ],
)
def test_golden_time_cases(store, time, now, upcoming):
    r = get_current_tasks(store, time)
    assert steps(r["now"]) == now
    assert steps(r["upcoming"]) == upcoming


def test_overnight_wraps_past_midnight():
    r = get_current_tasks("s3", "23:50")
    assert steps(r["upcoming"]) == {"s3.waste_check_00"}  # 00:00은 10분 뒤


def test_explicit_time_wins_and_default_is_seoul_now():
    assert get_current_tasks("s1", "21:35")["current_time"] == "21:35"
    auto = get_current_tasks("s1")["current_time"]
    assert len(auto) == 5 and auto[2] == ":"


def test_unknown_store():
    assert get_current_tasks("zz", "10:00")["found"] is False
