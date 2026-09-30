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
2. 조각마다 답변에서 해당 문장을 그대로 인용한다(answer_quote). 없으면 빈 문자열.
3. 인용을 근거로 covered를 정한다. 표현이 달라도 의미(수치·시각·조건)가 같으면 true, 수치·시각이 다르거나 조건이 빠지면 false.
답변이 "문서에 없어요"라고 회피하면 해당 조각은 모두 false. 답변에 없는 내용을 네가 보충해서 true로 만들지 않는다."""


# ---- 2. 환각: 답변의 사실 주장을 원문 전체와 대조 ----
class ClaimCheck(_Strict):
    claim: str = Field(description="답변에 든 사실 주장 하나")
    source_quote: str = Field(
        description="[원문]에서 그 주장을 뒷받침하는 문장 인용. 뒷받침이 없으면 빈 문자열"
    )
    supported: bool = Field(
        description="인용이 주장(수치·시각·조건 포함)과 일치하면 true. 원문에 없거나 다르면 false"
    )


class HallucinationResult(_Strict):
    claims: list[ClaimCheck]


HALLUCINATION_SYSTEM = """너는 사실 검증자다. [답변]에 든 사실 주장(업무 절차·수치·시각·규칙·장소·조건)을 하나씩 뽑아 [원문](해당 매장의 인수인계 문서와 영상 발언 전문)과 대조한다.
- 각 주장마다 원문에서 뒷받침 문장을 그대로 인용한 뒤(source_quote) supported를 정한다. 원문에 없거나 수치·시각이 다르면 false.
- 사실 주장이 아닌 것은 뽑지 않는다: "문서에 없어요", 점장님께 확인·요청하라는 안내, 인사, [확인 필요] 표시, 답변 형식 문구.
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


def run_accuracy(judge: GroqJudge, answer: str, facts: dict[str, str]):
    user = (
        "[정답 사실]\n"
        + "\n".join(f"- {fid}: {text}" for fid, text in facts.items())
        + f"\n\n[답변]\n{answer}"
    )
    return judge.structured(
        system=ACCURACY_SYSTEM, user=user, schema=AccuracyResult, name="accuracy", tag="judge:accuracy"
    )


def run_hallucination(judge: GroqJudge, answer: str, source_text: str):
    user = f"[원문]\n{source_text}\n\n[답변]\n{answer}"
    return judge.structured(
        system=HALLUCINATION_SYSTEM,
        user=user,
        schema=HallucinationResult,
        name="hallucination",
        tag="judge:hallucination",
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
    return bool(fc.parts) and all(p.covered for p in fc.parts)


def refusal_correct(r: RefusalResult) -> bool:
    return r.states_not_in_doc and r.suggests_manager_check and not r.gives_guess_answer
