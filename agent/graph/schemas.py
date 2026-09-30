"""LLM 구조화 출력 스키마. 필드 순서가 곧 생성 순서다: 근거(reasoning)를 판정보다 먼저 쓴다 (설계 5-2, 결함 #3의 교훈)."""

from typing import Literal

from pydantic import BaseModel, Field


class Classification(BaseModel):
    reasoning: str = Field(description="분류 근거 한두 문장")
    category: Literal["question", "now_tasks", "record_request", "out_of_scope"]
    safety_related: bool = Field(
        description="돈·안전·법(주류·담배 판매, 부상, 알레르기, 장비 운전 자격 등)과 관련된 질문인가"
    )


class Sufficiency(BaseModel):
    reasoning: str = Field(description="근거 청크가 질문에 답하는지 인용하며 설명")
    sufficient: bool
    missing: str = Field(description="부족하다면 무엇이 빠졌는지, 충분하면 빈 문자열")


class Rewrite(BaseModel):
    reasoning: str = Field(description="어떤 표현으로 바꿔야 문서에서 찾을 수 있는지")
    query: str = Field(description="문서식 표현으로 다시 쓴 검색 질의 한 줄")
