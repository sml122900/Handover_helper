"""에이전트 API (질문 화면용). 인증이 없으므로 127.0.0.1에서만 띄운다 (`serve.py`, 결정 로그 2026-10-01).

POST /ask     — 질문 → 답변 또는 확인 대기 상태(needs_confirmation)
POST /confirm — 확인 대기 중인 쓰기(폐기 기록·체크리스트·알림)를 승인·거절
스트리밍은 범위 밖. 매장 ID(store_id)는 필수이며 검색·도구 모두 그 매장으로만 한정된다.
"""

import logging
from functools import lru_cache
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from graph.agent import (
    EMERGENCY_NOTE,
    NOT_IN_DOC,
    AgentDeps,
    build_agent,
    manager_request_text,
    pending_confirmation,
    resume_question,
    run_question,
)
from settings import get_settings

get_settings()  # 필수 키 누락 시 부팅 실패

log = logging.getLogger("agent")
app = FastAPI(title="Handover Agent")

StoreId = Literal["s1", "s2", "s3", "s4", "s5"]
FAILED_TEXT = "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요. 계속되면 점장님께 직접 확인해 주세요."


class AskRequest(BaseModel):
    store_id: (
        StoreId  # 필수: 매장 필터(검색·도구)의 기준. 사용자→매장 매핑은 호출하는 쪽(Next.js 세션)의 책임
    )
    question: str = Field(min_length=1, max_length=1000)
    current_time: str | None = Field(
        default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="HH:MM (KST), 없으면 서버 KST 현재"
    )


class ConfirmRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=64)
    approve: bool
    reason: str | None = Field(
        default=None, max_length=200, description="폐기 기록 사유 (사용자가 확인 단계에서 추가)"
    )


class AskResponse(BaseModel):
    thread_id: str
    status: str  # answered | escalated | no_tasks | out_of_scope | needs_confirmation | clarify | tool_result | duplicate | tool_done | tool_rejected | failed
    answer: str
    category: str | None = None
    citations: list[
        dict
    ] = []  # 답변에 쓰인 [근거 n]: n, label(매장·섹션·영상 m:ss), needs_check, text(근거 조각, 마스킹됨)
    confirmation: dict | None = None  # needs_confirmation일 때 {tool, args, text}
    options: list[str] = []
    safety: bool = False
    escalation: dict | None = (
        None  # escalated일 때 {not_in_doc, manager_request, emergency} — 화면에서 구분해 보여 준다
    )


@lru_cache(maxsize=1)
def get_agent():
    """설정으로 그래프를 한 번만 만든다(첫 요청 시). 인덱스는 임베딩 캐시에서 만든다."""
    from embedding import get_embedder
    from indexing.corpus import build_masked_index
    from indexing.factory import make_store
    from llm.client import CostTracker, make_llm
    from tools.factory import make_tool_store

    s = get_settings()
    assert s.anthropic_api_key, "ANTHROPIC_API_KEY 필요"
    embedder = get_embedder(s)
    store = make_store(s, embedder.model)
    masked, vecs = build_masked_index(embedder)
    store.add(masked, vecs)
    llm = make_llm(
        "sonnet", s.anthropic_api_key, s.agent_model, CostTracker(s.agent_cost_budget_usd, "anthropic")
    )
    return build_agent(
        AgentDeps(
            llm=llm,
            embedder=embedder,
            store=store,
            answer_prompt=s.agent_answer_prompt,
            tool_store=make_tool_store(s),
        )
    )


def _response(rec: dict) -> AskResponse:
    if rec["outcome"] == "failed":
        log.error("agent 실패: %s", rec.get("error"))
        return AskResponse(thread_id=rec["thread_id"], status="failed", answer=FAILED_TEXT)
    by_n = {e["n"]: e for e in rec.get("evidence", [])}
    escalation = None
    if rec["outcome"] == "escalated":
        escalation = {
            "not_in_doc": NOT_IN_DOC,
            "manager_request": manager_request_text(rec["question"]),
            "emergency": EMERGENCY_NOTE if rec.get("safety") else None,
        }
    return AskResponse(
        thread_id=rec["thread_id"],
        status=rec["outcome"],
        answer=rec["answer"],
        category=rec.get("category"),
        citations=[
            {**c, "text": by_n[c["n"]]["text"]} if c["n"] in by_n else c for c in rec.get("citations", [])
        ],
        confirmation=rec.get("confirmation") if rec["outcome"] == "needs_confirmation" else None,
        options=rec.get("options", []),
        safety=rec.get("safety", False),
        escalation=escalation,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ask", response_model=AskResponse)
def ask(req: AskRequest, graph=Depends(get_agent)) -> AskResponse:
    return _response(run_question(graph, req.question, req.store_id, req.current_time))


@app.post("/confirm", response_model=AskResponse)
def confirm(req: ConfirmRequest, graph=Depends(get_agent)) -> AskResponse:
    snap = graph.get_state({"configurable": {"thread_id": req.thread_id}})
    if not snap.values:
        raise HTTPException(
            404, "확인 대기 중인 요청을 찾을 수 없어요. 서버가 다시 시작됐다면 처음부터 다시 요청해 주세요."
        )
    if pending_confirmation(graph, req.thread_id) is None:
        raise HTTPException(409, "이미 처리된 요청이에요.")
    return _response(resume_question(graph, req.thread_id, req.approve, req.reason))
