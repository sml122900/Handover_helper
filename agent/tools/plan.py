"""기록 요청 → 도구 계획 (LLM 구조화 출력). 매장 ID는 요청에서 오며 LLM이 정하지 않는다."""

from typing import Literal

from pydantic import BaseModel, Field


class ToolPlan(BaseModel):
    """필드 순서: 근거(reasoning) → 도구 선택 → 인자. 질문에 없는 값은 추정하지 않고 null로 둔다."""

    reasoning: str = Field(description="어떤 도구를 왜 고르는지, 질문에서 인자를 어떻게 읽었는지 한두 문장")
    tool: Literal["waste_log_record", "waste_log_query", "log_checklist", "notify_manager", "unclear"]
    item: str | None = Field(default=None, description="waste_log_record: 폐기한 품목. 질문에 없으면 null")
    qty: int | None = Field(default=None, description="waste_log_record: 수량(정수). 질문에 없으면 null")
    reason: str | None = Field(
        default=None, description="waste_log_record: 질문에 **명시된** 사유만. 없으면 null (추정 금지)"
    )
    date_ref: Literal["today", "yesterday", "explicit"] | None = Field(
        default=None, description="waste_log_query: 조회 날짜. 언급이 없으면 today"
    )
    date: str | None = Field(default=None, description="date_ref가 explicit일 때 YYYY-MM-DD")
    step_id: str | None = Field(
        default=None, description="log_checklist: [체크리스트 후보]에 있는 step_id 하나. 애매하면 null"
    )
    step_candidates: list[str] = Field(
        default_factory=list, description="log_checklist가 애매할 때 후보 step_id 최대 3개 (step_id는 null)"
    )
    note: str | None = Field(default=None, description="log_checklist: 질문에 있는 덧붙일 메모. 없으면 null")
    message: str | None = Field(
        default=None, description="notify_manager: 점장에게 알릴 내용 (질문에 있는 사실만 짧게)"
    )
    urgency: Literal["normal", "urgent"] | None = Field(
        default=None,
        description="notify_manager: 신체 부상 위험이 있으면 urgent, 그 외 normal",
    )
    missing: str | None = Field(default=None, description="필수 인자가 빠졌으면 무엇이 빠졌는지, 아니면 null")


TOOL_PLAN_SYSTEM = """너는 매장 도우미의 도구 선택기다. 신입 직원의 기록·조회·알림 요청을 읽고 도구 하나와 인자를 정한다.

도구:
- waste_log_record: 폐기 대장에 폐기 내역을 **기록**한다 (품목·수량 필수, 사유는 질문에 명시된 경우만).
- waste_log_query: 폐기 대장을 **조회**한다 (날짜: 오늘/어제/특정 날짜).
- log_checklist: 체크리스트 단계 하나의 완료를 기록한다. [체크리스트 후보]의 step_id 중에서 고른다.
- notify_manager: 점장에게 알림을 보낸다 (모의 발송).
- unclear: 위 도구 어느 것으로도 처리할 수 없을 때.

규칙 (반드시 지킨다):
1. 질문에 없는 값은 지어내지 않는다. 특히 **사유(reason)는 질문에 명시되지 않았으면 null**이다. 상식이나 문서 규칙으로 추정하지 않는다.
2. 필수 인자가 빠지면 값을 넣지 말고 missing에 무엇이 빠졌는지 적는다 (예: 폐기 기록에 수량이 없으면 qty=null).
3. log_checklist는 [체크리스트 후보] 중 step 이름이 질문과 가장 직접 일치하는 후보 하나를 step_id에 넣는다. 가장 직접 일치하는 후보가 둘 이상으로 동률일 때만 step_id를 null로 두고 step_candidates에 후보 최대 3개를 넣는다.
4. notify_manager의 message는 질문에 있는 사실만 짧게 정리한다. 새로운 원인·조치를 덧붙이지 않는다.
   urgency: 신체 부상 위험이 있으면 urgent, 그 외 normal.
5. reasoning을 먼저 쓰고 도구와 인자를 정한다."""
