"""채점 안정화 (2026-10-01 결정): 모든 채점 항목을 2회 채점하고, 판정이 엇갈리면 3회째로 다수결한다.

호출 하나는 여러 판정을 한꺼번에 낸다(정답 사실 여러 개, 주장 여러 개). 엇갈림은 **집계에 쓰이는 판정** 단위로 본다:
- 답변 정확도: 정답 사실별 (전부 포함, 질문 관련 조각 포함) 두 판정
- 근거 충실도: 근거 밖 주장이 있는지(bool)
- 출처 일치: (지지 수, 인용 쌍 수)
- 거절: (거절 정확 여부, 응급 안내 표시 여부)
"""

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass
class Votes:
    results: list[Any]  # 호출 결과(파싱된 객체) 2개 또는 3개
    cost_usd: float
    third: bool  # 엇갈려서 3회째를 호출했는가

    @property
    def calls(self) -> int:
        return len(self.results)


def collect(fn: Callable[[], tuple[Any, Any]], key: Callable[[Any], Any], stable: bool) -> Votes:
    """fn() -> (parsed, info). stable=False면 1회(기존 단일 채점), True면 2회 + 엇갈리면 3회째."""
    parsed, info = fn()
    results, cost = [parsed], info.cost_usd
    third = False
    if stable:
        p2, i2 = fn()
        results.append(p2)
        cost += i2.cost_usd
        if key(parsed) != key(p2):
            p3, i3 = fn()
            results.append(p3)
            cost += i3.cost_usd
            third = True
    return Votes(results, cost, third)


def majority(values: list[Any]) -> Any:
    """다수결. 셋이 모두 다르면(튜플 판정) 가운데 값이 아니라 첫 호출 값을 쓴다."""
    value, n = Counter(values).most_common(1)[0]
    return value if n > 1 or len(values) == 1 else values[0]


def representative(votes: Votes, key: Callable[[Any], Any], final_key: Any) -> Any:
    """최종 판정과 같은 판정을 낸 호출 하나(상세 기록용). 없으면 첫 호출."""
    for r in votes.results:
        if key(r) == final_key:
            return r
    return votes.results[0]
