"""채점 항목 (설계 7-3, 7-4). 파이프라인 채점기 원칙: 항목별 yes/no, 근거 인용을 판정보다 먼저, 집계는 코드, temperature 0.

각 스키마에서 근거·인용 필드가 판정(bool) 필드보다 앞에 온다.
"""

from pydantic import BaseModel, ConfigDict, Field

from judge.groq import GroqJudge


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---- 1. 답변 정확도: 정답 사실을 더 작은 조각으로 나눠 조각별로 답변에 있는지 ----
class PartCheck(_Strict):
    part: str = Field(description="정답 사실을 이루는 조각 하나 (수치·시각·조건·대상 단위)")
    relevant_to_question: bool = Field(
        description="이 조각이 [질문]이 실제로 묻는 내용에 필요한가 (질문과 무관한 부가 세부는 false)"
    )
    answer_quote: str = Field(description="답변에서 그 조각에 해당하는 문장 인용. 없으면 빈 문자열")
    covered: bool = Field(description="인용이 조각의 의미(수치·시각·조건 포함)를 그대로 담고 있으면 true")


class FactCheck(_Strict):
    fact_id: str
    parts: list[PartCheck]


class AccuracyResult(_Strict):
    facts: list[FactCheck]


ACCURACY_SYSTEM = """너는 채점자다. [정답 사실] 각각이 [답변]에 담겨 있는지 채점한다.
절차:
1. 정답 사실을 수치·시각·조건·대상 단위의 조각으로 나눈다.
2. 조각마다 [질문]이 실제로 묻는 내용에 필요한 조각인지 relevant_to_question을 정한다.
3. 조각마다 답변에서 해당 문장을 그대로 인용한다(answer_quote). 없으면 빈 문자열.
4. 인용을 근거로 covered를 정한다. 표현이 달라도 의미(수치·시각·조건)가 같으면 true, 수치·시각이 다르거나 조건이 빠지면 false.
답변이 "문서에 없어요"라고 회피하면 해당 조각은 모두 false. 답변에 없는 내용을 네가 보충해서 true로 만들지 않는다."""

# 시각 문항은 "지금 할 일과 30분 내 다가오는 일을 모두 포함"이 기준(골든셋)이라 일 단위로 채점한다
ACCURACY_TASK_SYSTEM = """너는 채점자다. 시각 기반 질문의 [정답 사실]은 각각 '지금 또는 곧 해야 할 일' 하나를 가리킨다. 답변이 그 일을 알려 주는지 채점한다.
절차:
1. 정답 사실마다 parts에 조각 1개만 만든다(사실이 가리키는 일 전체를 한 조각으로, relevant_to_question은 항상 true).
2. 답변에서 그 일을 알려 주는 문장을 그대로 인용한다(answer_quote). 없으면 빈 문자열.
3. 답변이 그 일을 (해당하면 시각과 함께) 알려 주면 covered=true. 세부 수치·부가 조건까지 전부 요구하지 않는다. 다만 일의 시각이나 핵심 행동이 틀리거나 빠지면 false.
답변이 "문서에 없어요"라고 회피하면 false. 답변에 없는 내용을 네가 보충해서 true로 만들지 않는다."""


class ClaimCheck(_Strict):
    claim: str = Field(description="답변에 든 사실 주장 하나")
    source_quote: str = Field(
        description="[검색 근거]에서 그 주장을 뒷받침하는 문장 인용. 뒷받침이 없으면 빈 문자열"
    )
    supported: bool = Field(
        description="인용이 주장(수치·시각·조건 포함)과 일치하면 true. 검색 근거에 없거나 다르면 false"
    )


class FaithfulnessResult(_Strict):
    claims: list[ClaimCheck]


# ---- 2. 근거 충실도: 답변의 사실 주장을 "그 답변이 실제로 받은 청크"와 대조 (검색 근거 기준) ----
FAITHFULNESS_SYSTEM = """너는 근거 충실도 검증자다. [답변]에 든 사실 주장(업무 절차·수치·시각·규칙·장소·조건)을 하나씩 뽑아 [검색 근거](에이전트가 이 답변을 쓰면서 실제로 받은 청크)와 대조한다.
- 각 주장마다 검색 근거에서 뒷받침 문장을 그대로 인용한 뒤(source_quote) supported를 정한다. 검색 근거에 없거나 수치·시각이 다르면 false. 다른 곳에 사실일 수 있는 내용이라도 검색 근거에 없으면 false다.
- 사실 주장이 아닌 것은 뽑지 않는다: "문서에 없어요"·"~는 나와 있지 않아요" 같은 부재 진술, 점장님께 확인·요청하라는 안내, 인사, [확인 필요] 표시, 답변 형식 문구.
- 긴급 신고(119·112) 일반 안내가 "문서 근거 아님"이라고 표시돼 있으면 뽑지 않는다.
- 답변에 사실 주장이 하나도 없으면 claims는 빈 배열."""


# 시각 문항용: "지금·곧 해당 일정이 없다"도 사실 주장이므로 [검색 근거]에 든 [일정 도구 결과]와 대조한다 (2026-10-01 결정)
FAITHFULNESS_TASKS_SYSTEM = """너는 근거 충실도 검증자다. [답변]에 든 사실 주장을 하나씩 뽑아 [검색 근거](에이전트가 이 답변을 쓰면서 실제로 받은 문서 청크와 [일정 도구 결과])와 대조한다.
- 각 주장마다 검색 근거에서 뒷받침 문장을 그대로 인용한 뒤(source_quote) supported를 정한다. 검색 근거에 없거나 수치·시각이 다르면 false.
- **일정에 관한 주장은 부재 진술도 사실 주장이다**: "지금 시작한 일이 없다", "30분 안에 예정된 일이 없다", "그 시각에 ○○이 있다/없다"는 [일정 도구 결과]의 지금·곧 목록과 대조한다. 목록에 있는데 없다고 하거나, 없는데 있다고 하면 false.
- 사실 주장이 아닌 것은 뽑지 않는다: 문서 세부 내용이 "문서에 없어요"·"나와 있지 않아요"라는 진술, 점장님께 확인·요청하라는 안내, 인사, [확인 필요] 표시, 답변 형식 문구.
- 긴급 신고(119·112) 일반 안내가 "문서 근거 아님"이라고 표시돼 있으면 뽑지 않는다.
- 답변에 사실 주장이 하나도 없으면 claims는 빈 배열."""


# ---- 3. 출처 일치: 인용한 근거가 그 문장을 실제로 뒷받침하는지 ----
class CitationCheck(_Strict):
    sentence: str = Field(description="[근거 n]이 붙은 답변 문장")
    cited_n: int = Field(description="그 문장이 인용한 근거 번호 하나 (여러 개면 각각 별도 항목)")
    chunk_quote: str = Field(
        description="그 번호의 근거 본문에서 문장을 뒷받침하는 부분 인용. 없으면 빈 문자열"
    )
    supports: bool = Field(description="인용한 근거 본문이 문장의 사실을 뒷받침하면 true")


class CitationResult(_Strict):
    citations: list[CitationCheck]


CITATION_SYSTEM = """너는 인용 검증자다. [답변]에서 [근거 n]이 붙은 문장마다, 그 번호의 [근거] 본문이 실제로 그 문장을 뒷받침하는지 확인한다.
- 문장에 근거 번호가 여러 개면 번호마다 별도 항목으로 만든다.
- 각 항목에서 해당 근거 본문의 뒷받침 부분을 그대로 인용한 뒤(chunk_quote) supports를 정한다. 그 근거 본문에 없는 내용이면 false (다른 번호의 근거에 있어도 false).
- [근거 n] 표시가 없는 문장은 검증하지 않는다."""


# ---- 4. 거절 정확도: 문서에 없는 질문 ----
class RefusalResult(_Strict):
    not_in_doc_quote: str = Field(description="답변에서 '문서에 없다'고 밝힌 문장 인용. 없으면 빈 문자열")
    states_not_in_doc: bool
    manager_quote: str = Field(
        description="답변에서 점장·담당자에게 확인을 요청하거나 제안한 문장 인용. 없으면 빈 문자열"
    )
    suggests_manager_check: bool
    guess_quote: str = Field(
        description="답변이 문서에 없는 질문에 추측·일반 상식으로 구체적인 답이나 절차를 준 문장 인용. 없으면 빈 문자열"
    )
    gives_guess_answer: bool = Field(
        description="추측·일반 상식으로 구체적 답을 줬으면 true (긴급 신고 119·112 일반 안내는 '문서 근거 아님' 표시가 있으면 false)"
    )
    emergency_note_quote: str = Field(description="119·112 등 긴급 신고 안내 문장 인용. 없으면 빈 문자열")
    emergency_marked_not_from_doc: bool = Field(
        description="긴급 신고 안내가 있고 '문서 근거 아님'이라고 표시했으면 true, 안내가 없으면 false"
    )


REFUSAL_SYSTEM = """너는 채점자다. 이 질문의 답은 인수인계 문서에 없다. [답변]이 올바르게 거절했는지 채점한다.
올바른 답변: (1) 문서에 없다고 명시하고 (2) 점장 확인을 요청·제안하며 (3) 추측으로 구체적인 답을 주지 않는다.
각 항목마다 답변에서 해당 문장을 먼저 그대로 인용한 뒤 판정한다. 인용할 문장이 없으면 빈 문자열이고 판정은 false다."""


def run_accuracy(
    judge: GroqJudge, answer: str, facts: dict[str, str], question: str = "", mode: str = "fact"
):
    fact_lines = "\n".join(f"- {fid}: {text}" for fid, text in facts.items())
    user = f"[질문]\n{question}\n\n[정답 사실]\n{fact_lines}\n\n[답변]\n{answer}"
    system = ACCURACY_TASK_SYSTEM if mode == "task" else ACCURACY_SYSTEM
    return judge.structured(
        system=system, user=user, schema=AccuracyResult, name="accuracy", tag="judge:accuracy"
    )


def run_faithfulness(judge: GroqJudge, answer: str, evidence_text: str, mode: str = "doc"):
    user = f"[검색 근거]\n{evidence_text}\n\n[답변]\n{answer}"
    return judge.structured(
        system=FAITHFULNESS_TASKS_SYSTEM if mode == "tasks" else FAITHFULNESS_SYSTEM,
        user=user,
        schema=FaithfulnessResult,
        name="faithfulness",
        tag="judge:faithfulness",
    )


def run_citations(judge: GroqJudge, answer: str, evidence_text: str):
    user = f"[근거]\n{evidence_text}\n\n[답변]\n{answer}"
    return judge.structured(
        system=CITATION_SYSTEM, user=user, schema=CitationResult, name="citations", tag="judge:citations"
    )


def run_refusal(judge: GroqJudge, question: str, answer: str):
    user = f"[질문]\n{question}\n\n[답변]\n{answer}"
    return judge.structured(
        system=REFUSAL_SYSTEM, user=user, schema=RefusalResult, name="refusal", tag="judge:refusal"
    )


# ---- 집계는 코드가 한다 ----
def fact_covered(fc: FactCheck) -> bool:
    """정답 사실의 모든 조각이 답변에 있어야 포함 (골든셋 정의: 해당 사실 ID의 내용을 모두 포함)."""
    return bool(fc.parts) and all(p.covered for p in fc.parts)


def fact_covered_relevant(fc: FactCheck) -> bool:
    """보조 지표: 질문이 묻는 내용에 필요한 조각만 기준으로 (질문이 사실의 일부만 묻는 문항의 과소평가를 분리해 본다)."""
    rel = [p for p in fc.parts if p.relevant_to_question]
    return bool(rel) and all(p.covered for p in rel)


def refusal_correct(r: RefusalResult) -> bool:
    return r.states_not_in_doc and r.suggests_manager_check and not r.gives_guess_answer


# ---- 5. 도구 인자 의미 일치 (알림 메시지처럼 자유 문구 인자) ----
class MessageMatchResult(_Strict):
    expected_gist: str = Field(description="기대 문구의 핵심 내용(대상·상황)을 한 문장으로")
    actual_quote: str = Field(description="실제 문구에서 그 핵심에 해당하는 부분 인용. 없으면 빈 문자열")
    equivalent: bool = Field(description="실제 문구가 기대 문구와 같은 대상·상황을 말하고, 새로운 사실을 덧붙이지 않았으면 true")


MESSAGE_MATCH_SYSTEM = """너는 채점자다. 도구 인자로 만든 [실제 문구]가 [기대 문구]와 의미가 같은지 판정한다.
- 표현이 달라도 같은 대상(예: 몇 번 기구)과 같은 상황(예: 무엇이 어떻다)을 말하면 같다.
- 실제 문구에 기대 문구에 없는 새로운 사실·원인·조치가 더해졌거나 핵심(대상·상황)이 빠지면 다르다.
expected_gist → actual_quote → equivalent 순서로 쓴다."""


def run_message_match(judge: GroqJudge, expected: str, actual: str):
    user = f"[기대 문구]\n{expected}\n\n[실제 문구]\n{actual}"
    return judge.structured(
        system=MESSAGE_MATCH_SYSTEM, user=user, schema=MessageMatchResult, name="message_match", tag="judge:message"
    )
