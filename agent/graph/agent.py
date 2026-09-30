"""LangGraph 에이전트 흐름 (설계 문서 5절).

분류 → (질문) 검색 → 충분성 판단 → [부족 시 질의 재작성 → 재검색 1회] → 답변 | 에스컬레이션 제안
      → (지금 할 일) get_current_tasks → 답변
      → (기록 요청) "D3에서 지원" 응답  → (범위 밖) 거절 안내

노드마다 입력·출력·지연·토큰·비용을 trace에 남긴다 (실행 기록 JSON). 쓰기 도구·확인 단계는 D3.
"""

import operator
import re
import time
from dataclasses import dataclass, field
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from embedding.base import Embedder
from graph import prompts
from graph.schemas import Classification, IntegratedAnswer, Rewrite, Sufficiency
from graph.tools import get_current_tasks, load_schedules
from indexing.store import Hit, VectorStore
from llm.client import LLM
from privacy.mask import mask_text

K = 5
DEFAULT_STRATEGY = "fixed150"  # 실험 A 결과(차이 없음)에 따른 기본 청킹 — 결정 로그 2026-09-30
RECORD_REPLY = (
    "기록·조회 요청은 아직 지원하지 않아요. 다음 버전(D3)에서 지원할 예정이에요. "
    "지금은 폐기 대장·체크리스트에 직접 적거나 점장님께 직접 전달해 주세요."
)
OUT_OF_SCOPE_REPLY = "이 질문은 인수인계 문서로 답할 수 있는 범위 밖이에요. 필요하면 점장님이나 공식 기관에 직접 확인해 주세요."
NO_TASKS_REPLY = (
    "지금 시작한 일정도, 30분 안에 다가오는 일정도 문서에 없어요. "
    "지금 뭘 해야 하는지 확실하지 않다면 점장님께 확인을 요청해 볼까요?"
)


def escalation_text(question: str, safety: bool) -> str:
    text = (
        "문서에 없어요. 인수인계 문서에서 이 질문에 답할 내용을 찾지 못했어요. "
        f'점장님께 확인을 요청할까요? (요청 문구 제안: "{question.strip()}" 확인 부탁드립니다.)'
    )
    if safety:
        text += " 긴급한 상황이면 119(응급)·112(신고)에 바로 연락하세요. (문서 근거 아님, 일반 안내)"
    return text


class State(TypedDict, total=False):
    question: str
    store_id: str
    current_time: str | None
    category: str
    safety: bool
    query: str
    attempt: int
    hits: list[Any]  # Hit
    evidence: list[dict]
    tasks: dict
    sufficiency: dict
    answer: str
    citations: list[dict]
    rewrite_failed: bool
    outcome: str  # answered | escalated | record_request | out_of_scope | no_tasks
    retrieval_log: Annotated[list[dict], operator.add]
    trace: Annotated[list[dict], operator.add]


@dataclass
class AgentDeps:
    llm: LLM
    embedder: Embedder
    store: VectorStore
    strategy: str = DEFAULT_STRATEGY
    integrated: bool = False  # 실험 G: 충분성 판단을 답변 노드에 통합
    answer_prompt: str = "v1"  # v1(기준선) | v2(실험 D' 개선안)
    schedules: dict = field(default_factory=load_schedules)


def fmt_ts(start: float | None, end: float | None) -> str:
    def f(s: float) -> str:
        return f"{int(s) // 60}:{int(s) % 60:02d}"

    if start is None:
        return ""
    return f"영상 {f(start)}~{f(end)}" if end is not None and end != start else f"영상 {f(start)}"


def to_evidence(hits: list[Hit]) -> list[dict]:
    """문서 청크를 먼저, 트랜스크립트를 뒤에 두고 근거 번호를 붙인다 (인용은 문서 우선, 설계 3-3)."""
    ordered = sorted(hits, key=lambda h: h.chunk.raw.source_type != "document")  # 안정 정렬: 점수순 유지
    out = []
    for n, h in enumerate(ordered, start=1):
        r = h.chunk.raw
        out.append(
            {
                "n": n,
                "source_type": r.source_type,
                "store_id": r.store_id,
                "section": r.section,
                "item_id": r.item_id,
                "video_ts_start": r.video_ts_start,
                "video_ts_end": r.video_ts_end,
                "needs_check": r.confidence == "needs_review" or r.inferred,
                "confidence": r.confidence,
                "inferred": r.inferred,
                "source_file": r.source_file,
                "char_start": r.char_start,
                "char_end": r.char_end,
                "text": str(h.chunk.body),
                "score": round(h.score, 5),
            }
        )
    return out


def render_evidence(evidence: list[dict]) -> str:
    parts = []
    for e in evidence:
        kind = "문서" if e["source_type"] == "document" else "영상 발언(트랜스크립트)"
        meta = [kind] + ([e["section"]] if e["section"] else [])
        ts = fmt_ts(e["video_ts_start"], e["video_ts_end"])
        if ts:
            meta.append(ts)
        if e["needs_check"]:
            meta.append("확인 필요")
        parts.append(f"[근거 {e['n']}] ({' · '.join(meta)})\n{e['text']}")
    return "\n\n".join(parts)


def citation_view(evidence: list[dict], answer: str) -> list[dict]:
    """답변에 실제로 쓰인 [근거 n]을 `매장 · 섹션 · 영상 m:ss` 형태로 풀어 준다 (설계 5-4)."""
    used = sorted({int(n) for n in re.findall(r"\[근거 (\d+)\]", answer)})
    by_n = {e["n"]: e for e in evidence}
    out = []
    for n in used:
        e = by_n.get(n)
        if not e:
            continue
        label = " · ".join(
            x
            for x in (
                e["store_id"].upper(),
                e["section"] or "영상 발언",
                fmt_ts(e["video_ts_start"], e["video_ts_end"]),
            )
            if x
        )
        out.append(
            {
                "n": n,
                "label": label,
                **{k: e[k] for k in ("source_type", "source_file", "char_start", "char_end", "needs_check")},
            }
        )
    return out


def _timed(node_name: str, fn):  # noqa: ANN001 — 노드 실행 시간·입력·출력 기록용 얇은 래퍼
    def wrapper(state: State) -> dict:
        started = time.monotonic()
        out = fn(state)
        node_trace = out.pop("_trace", {})
        node_trace.setdefault("latency_ms", int((time.monotonic() - started) * 1000))
        node_trace["node"] = node_name
        out["trace"] = [node_trace]
        return out

    return wrapper


def _llm_trace(info, **extra) -> dict:
    return {
        "input_tokens": info.input_tokens,
        "output_tokens": info.output_tokens,
        "cost_usd": round(info.cost_usd, 6),
        **extra,
    }


def build_agent(deps: AgentDeps):
    llm, embedder, store = deps.llm, deps.embedder, deps.store

    def search_store(query: str, store_id: str, k: int = K) -> tuple[list[Hit], int]:
        before = embedder.run_tokens
        qvec = embedder.embed([mask_text(query)], "query")[0]
        return store.search(qvec, k, deps.strategy, store_id), embedder.run_tokens - before

    def classify(state: State) -> dict:
        res, info = llm.structured(
            system=prompts.CLASSIFY_SYSTEM,
            user=f"입력: {state['question']}",
            schema=Classification,
            tool_name="submit_classification",
            max_tokens=400,
            tag="classify",
        )
        return {
            "category": res.category,
            "safety": res.safety_related,
            "query": state["question"],
            "attempt": 0,
            "_trace": _llm_trace(
                info,
                input=state["question"],
                output={"category": res.category, "safety": res.safety_related, "reasoning": res.reasoning},
            ),
        }

    def retrieve(state: State) -> dict:
        query = state["query"]
        hits, emb_tokens = search_store(query, state["store_id"])
        log = {
            "attempt": state["attempt"],
            "query": query,
            "top5": [
                {
                    "file": h.chunk.raw.source_file,
                    "start": h.chunk.raw.char_start,
                    "end": h.chunk.raw.char_end,
                    "store": h.chunk.raw.store_id,
                    "strategy": h.chunk.raw.chunking_strategy,
                    "score": round(h.score, 5),
                }
                for h in hits
            ],
        }
        return {
            "hits": hits,
            "evidence": to_evidence(hits),
            "retrieval_log": [log],
            "_trace": {
                "input": query,
                "output": [f"{x['file']}:{x['start']}-{x['end']}" for x in log["top5"]],
                "embedding_tokens": emb_tokens,
            },
        }

    def sufficiency(state: State) -> dict:
        user = f"[질문]\n{state['question']}\n\n[근거]\n{render_evidence(state['evidence'])}"
        res, info = llm.structured(
            system=prompts.SUFFICIENCY_SYSTEM,
            user=user,
            schema=Sufficiency,
            tool_name="submit_sufficiency",
            max_tokens=700,
            tag="sufficiency",
        )
        return {
            "sufficiency": res.model_dump(),
            "_trace": _llm_trace(info, input=state["question"], output=res.model_dump()),
        }

    def rewrite(state: State) -> dict:
        user = f"[원래 질문]\n{state['question']}\n\n[부족했던 점]\n{state['sufficiency']['missing']}"
        try:
            res, info = llm.structured(
                system=prompts.REWRITE_SYSTEM,
                user=user,
                schema=Rewrite,
                tool_name="submit_rewrite",
                max_tokens=600,
                tag="rewrite",
            )
        except RuntimeError as e:  # 구조화 출력이 재시도 후에도 검증 실패 → 재검색 없이 에스컬레이션
            return {"attempt": state["attempt"] + 1, "rewrite_failed": True, "_trace": {"error": str(e)}}
        return {
            "query": res.query,
            "attempt": state["attempt"] + 1,
            "_trace": _llm_trace(
                info,
                input=state["sufficiency"]["missing"],
                output={"query": res.query, "reasoning": res.reasoning},
            ),
        }

    def write_answer(state: State, system: str, extra: str = "") -> dict:
        user = f"[질문]\n{state['question']}\n\n{extra}[근거]\n{render_evidence(state['evidence'])}"
        text, info = llm.text(system=system, user=user, max_tokens=900, tag="answer")
        return {
            "answer": text.strip(),
            "citations": citation_view(state["evidence"], text),
            "outcome": "answered",
            "_trace": _llm_trace(info, input=state["question"], output=text.strip()),
        }

    def answer(state: State) -> dict:
        return write_answer(state, prompts.answer_system(deps.answer_prompt))

    def answer_integrated(state: State) -> dict:
        user = f"[질문]\n{state['question']}\n\n[근거]\n{render_evidence(state['evidence'])}"
        res, info = llm.structured(
            system=prompts.INTEGRATED_ANSWER_SYSTEM,
            user=user,
            schema=IntegratedAnswer,
            tool_name="submit_answer",
            max_tokens=1500,
            tag="answer",
        )
        answerable = res.answerable and bool(res.answer.strip())
        out: dict = {
            "sufficiency": {"reasoning": res.reasoning, "sufficient": answerable, "missing": res.reasoning},
            "_trace": _llm_trace(info, input=state["question"], output=res.model_dump()),
        }
        if answerable:
            out |= {
                "answer": res.answer.strip(),
                "citations": citation_view(state["evidence"], res.answer),
                "outcome": "answered",
            }
        return out

    def escalate(state: State) -> dict:
        text = escalation_text(state["question"], state.get("safety", False))
        return {"answer": text, "citations": [], "outcome": "escalated", "_trace": {"output": text}}

    def tasks(state: State) -> dict:
        result = get_current_tasks(state["store_id"], state.get("current_time"), deps.schedules)
        items = result["now"] + result["upcoming"]
        if not items:
            return {
                "tasks": result,
                "answer": NO_TASKS_REPLY,
                "citations": [],
                "outcome": "no_tasks",
                "evidence": [],
                "_trace": {
                    "input": {"store": state["store_id"], "current_time": result["current_time"]},
                    "output": result,
                },
            }
        # 각 일정 항목의 근거: 항목이 여러 일을 묶었으면("A·B·C") 하위 표현마다 매장 필터 검색해 문서 청크 우선 1개씩 (정답표는 쓰지 않는다)
        before = embedder.run_tokens
        phrases = [[p.strip() for p in it["text"].split("·") if p.strip()] or [it["text"]] for it in items]
        flat = [p for group in phrases for p in group]
        qvecs = iter(embedder.embed([mask_text(p) for p in flat], "query"))
        evidence: list[dict] = []
        for it, group in zip(items, phrases, strict=True):
            it["evidence_ns"] = []
            for _ in group:
                top = store.search(next(qvecs), 3, deps.strategy, state["store_id"])
                pick = next((h for h in top if h.chunk.raw.source_type == "document"), top[0])
                key = (pick.chunk.raw.source_file, pick.chunk.raw.char_start)
                found = next((e for e in evidence if (e["source_file"], e["char_start"]) == key), None)
                if found is None:
                    found = to_evidence([pick])[0]
                    found["n"] = len(evidence) + 1
                    evidence.append(found)
                if found["n"] not in it["evidence_ns"]:
                    it["evidence_ns"].append(found["n"])
        return {
            "tasks": result,
            "evidence": evidence,
            "_trace": {
                "input": {"store": state["store_id"], "current_time": result["current_time"]},
                "output": result,
                "embedding_tokens": embedder.run_tokens - before,
            },
        }

    def tasks_answer(state: State) -> dict:
        t = state["tasks"]

        def lines(items):
            return (
                "\n".join(
                    f"- {i['time']} {i['text']} " + "".join(f"[근거 {n}]" for n in i["evidence_ns"])
                    for i in items
                )
                or "- (없음)"
            )

        extra = f"[일정] 현재 시각 {t['current_time']}\n지금 시작한 일(최근 30분):\n{lines(t['now'])}\n곧 있을 일(30분 이내):\n{lines(t['upcoming'])}\n\n"
        return write_answer(state, prompts.tasks_answer_system(deps.answer_prompt), extra)

    def record_reply(state: State) -> dict:
        return {
            "answer": RECORD_REPLY,
            "citations": [],
            "outcome": "record_request",
            "_trace": {"output": RECORD_REPLY},
        }

    def out_of_scope_reply(state: State) -> dict:
        return {
            "answer": OUT_OF_SCOPE_REPLY,
            "citations": [],
            "outcome": "out_of_scope",
            "_trace": {"output": OUT_OF_SCOPE_REPLY},
        }

    def after_classify(state: State) -> str:
        return {
            "question": "retrieve",
            "now_tasks": "tasks",
            "record_request": "record_reply",
            "out_of_scope": "out_of_scope_reply",
        }[state["category"]]

    def after_sufficiency(state: State) -> str:
        if state["sufficiency"]["sufficient"]:
            return "answer"
        return "rewrite" if state["attempt"] == 0 else "escalate"

    def after_tasks(state: State) -> str:
        return END if state.get("outcome") == "no_tasks" else "tasks_answer"

    def after_integrated(state: State) -> str:
        if state["sufficiency"]["sufficient"]:
            return END
        return "rewrite" if state["attempt"] == 0 else "escalate"

    g = StateGraph(State)
    nodes = [
        ("classify", classify),
        ("retrieve", retrieve),
        ("rewrite", rewrite),
        ("escalate", escalate),
        ("tasks", tasks),
        ("tasks_answer", tasks_answer),
        ("record_reply", record_reply),
        ("out_of_scope_reply", out_of_scope_reply),
    ]
    nodes += (
        [("answer", answer_integrated)]
        if deps.integrated
        else [("sufficiency", sufficiency), ("answer", answer)]
    )
    for name, fn in nodes:
        g.add_node(name, _timed(name, fn))
    g.add_edge(START, "classify")
    g.add_conditional_edges("classify", after_classify)
    if deps.integrated:  # 실험 G: retrieve → answer(충분성 판정 통합) → 답변 / 재작성 / 에스컬레이션
        g.add_edge("retrieve", "answer")
        g.add_conditional_edges("answer", after_integrated)
        end_nodes = ("escalate", "tasks_answer", "record_reply", "out_of_scope_reply")
    else:
        g.add_edge("retrieve", "sufficiency")
        g.add_conditional_edges("sufficiency", after_sufficiency)
        end_nodes = ("answer", "escalate", "tasks_answer", "record_reply", "out_of_scope_reply")
    g.add_conditional_edges("rewrite", lambda st: "escalate" if st.get("rewrite_failed") else "retrieve")
    g.add_conditional_edges("tasks", after_tasks)
    for end_node in end_nodes:
        g.add_edge(end_node, END)
    return g.compile()


def run_question(app, question: str, store_id: str, current_time: str | None = None) -> dict:
    """한 질문을 흐름에 통과시키고 실행 기록(JSON 직렬화 가능)을 돌려준다.

    구조화 출력이 재시도 후에도 실패하는 등 노드가 실패하면 outcome="failed"로 기록한다 (CLAUDE.md: 1회 재시도 후 failed 처리).
    """
    started = time.monotonic()
    base = {"question": question, "store_id": store_id.lower(), "current_time": current_time}
    try:
        final = app.invoke({**base, "trace": [], "retrieval_log": []})
    except RuntimeError as e:
        return {
            **base,
            "category": None,
            "safety": False,
            "outcome": "failed",
            "error": str(e),
            "answer": "",
            "citations": [],
            "evidence": [],
            "tasks": None,
            "sufficiency": None,
            "rewritten": False,
            "final_query": None,
            "retrieval_log": [],
            "latency_ms": int((time.monotonic() - started) * 1000),
            "cost_usd": 0.0,
            "input_tokens": 0,
            "output_tokens": 0,
            "embedding_tokens": 0,
            "trace": [],
        }
    trace = final["trace"]
    return {
        **base,
        "category": final.get("category"),
        "safety": final.get("safety", False),
        "outcome": final.get("outcome"),
        "answer": final.get("answer", ""),
        "citations": final.get("citations", []),
        "evidence": final.get("evidence", []),
        "tasks": final.get("tasks"),
        "sufficiency": final.get("sufficiency"),
        "rewritten": final.get("attempt", 0) > 0,
        "final_query": final.get("query"),
        "retrieval_log": final.get("retrieval_log", []),
        "latency_ms": int((time.monotonic() - started) * 1000),
        "cost_usd": round(sum(t.get("cost_usd", 0.0) for t in trace), 6),
        "input_tokens": sum(t.get("input_tokens", 0) for t in trace),
        "output_tokens": sum(t.get("output_tokens", 0) for t in trace),
        "embedding_tokens": sum(t.get("embedding_tokens", 0) for t in trace),
        "trace": trace,
    }
