import hashlib
from collections.abc import Sequence

import numpy as np

from embedding.base import Embedder
from graph.agent import RECORD_REPLY, AgentDeps, build_agent, run_question
from graph.schemas import Classification, Rewrite, Sufficiency
from indexing.store import MemoryStore
from indexing.types import RawChunk
from llm.client import CallInfo
from privacy.mask import MaskedText


class HashEmbedder(Embedder):
    """텍스트 해시로 결정적 벡터를 만든다 (같은 단어가 겹치면 가깝게 — 단어별 해시 합)."""

    provider = "fake"

    def _embed_batch(self, texts: Sequence[MaskedText], input_type):
        out = []
        for t in texts:
            v = np.zeros(64)
            for w in str(t).split():
                v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 64] += 1
            out.append(v.tolist())
        return out


INFO = CallInfo("fake", 10, 100, 20, 0.001)


class ScriptedLLM:
    """tag별로 준비된 응답을 순서대로 돌려준다."""

    model = "fake"

    def __init__(self, script: dict[str, list]):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls: list[str] = []

    def structured(self, *, system, user, schema, tool_name, max_tokens=1024, tag=""):
        self.calls.append(tag)
        return self.script[tag].pop(0), INFO

    def text(self, *, system, user, max_tokens=1024, tag=""):
        self.calls.append(tag)
        self.last_user = user
        return self.script[tag].pop(0), INFO


def chunk(store, kind, text, start, section=None, conf="high", strategy="fixed150"):
    return RawChunk(
        store,
        kind,
        f"{store}.{'md' if kind == 'document' else 'txt'}",
        section,
        None,
        start,
        start + len(text),
        10.0,
        20.0,
        conf,
        False,
        strategy if kind == "document" else "transcript_fixed150",
        text,
    ).to_masked()


def make_app(tmp_path, llm):
    emb = HashEmbedder("m", tmp_path)
    chunks = [
        chunk("s1", "document", "케이크 남으면 전부 폐기 폐기 대장 기록", 0, "2. 절차"),
        chunk("s1", "transcript", "케이크 남으면 다 버려요 폐기 대장", 100),
        chunk("s1", "document", "우유 개봉 후 24시간 폐기", 200, "2. 절차", conf="needs_review"),
        chunk("s2", "document", "홀케이크 2일 판매 3일째 폐기", 0, "2. 절차"),
        chunk("s1", "document", "라스트오더·케이크 폐기·머신 청소 시작", 300, "2. 절차"),
        chunk("s1", "document", "음악·간판 끄기·마감 정산", 400, "2. 절차"),
    ]
    store = MemoryStore()
    store.add(chunks, emb.embed([c.embed_text for c in chunks], "document"))
    return build_agent(AgentDeps(llm=llm, embedder=emb, store=store)), llm


def cls(category, safety=False):
    return Classification(reasoning="r", category=category, safety_related=safety)


def test_question_answered_doc_first_with_citations(tmp_path):
    llm = ScriptedLLM(
        {
            "classify": [cls("question")],
            "sufficiency": [Sufficiency(reasoning="r", sufficient=True, missing="")],
            "answer": ["전부 폐기해요. [근거 1]"],
        }
    )
    app, _ = make_app(tmp_path, llm)
    rec = run_question(app, "케이크 남으면 폐기 대장 기록", "s1")
    assert rec["outcome"] == "answered" and not rec["rewritten"]
    assert llm.calls == ["classify", "sufficiency", "answer"]
    assert all(e["store_id"] == "s1" for e in rec["evidence"])  # 매장 필터 켬
    types = [e["source_type"] for e in rec["evidence"]]
    assert types == sorted(types, key=lambda t: t != "document")  # 문서 근거가 앞
    assert rec["citations"][0]["n"] == 1 and rec["citations"][0]["label"].startswith("S1 · 2. 절차")
    assert {t["node"] for t in rec["trace"]} == {"classify", "retrieve", "sufficiency", "answer"}
    assert rec["cost_usd"] > 0 and rec["retrieval_log"][0]["attempt"] == 0


def test_needs_review_evidence_is_labeled_in_prompt(tmp_path):
    llm = ScriptedLLM(
        {
            "classify": [cls("question")],
            "sufficiency": [Sufficiency(reasoning="r", sufficient=True, missing="")],
            "answer": ["24시간 뒤 폐기해요. [근거 1] [확인 필요]"],
        }
    )
    app, _ = make_app(tmp_path, llm)
    run_question(app, "우유 개봉 후 24시간 폐기", "s1")
    assert "확인 필요" in llm.last_user  # 근거 헤더에 라벨이 실린다


def test_rewrite_once_then_answer(tmp_path):
    llm = ScriptedLLM(
        {
            "classify": [cls("question")],
            "sufficiency": [
                Sufficiency(reasoning="r", sufficient=False, missing="폐기 기준"),
                Sufficiency(reasoning="r", sufficient=True, missing=""),
            ],
            "rewrite": [Rewrite(reasoning="r", query="케이크 폐기 대장")],
            "answer": ["폐기해요. [근거 1]"],
        }
    )
    app, _ = make_app(tmp_path, llm)
    rec = run_question(app, "이거 어떡해요", "s1")
    assert rec["rewritten"] and rec["outcome"] == "answered"
    assert llm.calls == ["classify", "sufficiency", "rewrite", "sufficiency", "answer"]
    assert [r["attempt"] for r in rec["retrieval_log"]] == [0, 1]
    assert rec["retrieval_log"][1]["query"] == "케이크 폐기 대장"


def test_insufficient_twice_escalates_without_answer_call(tmp_path):
    suf = Sufficiency(reasoning="r", sufficient=False, missing="x")
    llm = ScriptedLLM(
        {
            "classify": [cls("question", safety=True)],
            "sufficiency": [suf, suf],
            "rewrite": [Rewrite(reasoning="r", query="q2")],
        }
    )
    app, _ = make_app(tmp_path, llm)
    rec = run_question(app, "손님이 다쳤어요", "s1")
    assert rec["outcome"] == "escalated" and "answer" not in llm.calls
    assert "문서에 없어요" in rec["answer"] and "점장님께 확인" in rec["answer"]
    assert (
        "119" in rec["answer"] and "문서 근거 아님" in rec["answer"]
    )  # 안전 문항은 일반 안내 + 근거 아님 표시
    assert len(rec["retrieval_log"]) == 2  # 재검색은 최대 1회


def test_non_safety_escalation_has_no_emergency_text(tmp_path):
    suf = Sufficiency(reasoning="r", sufficient=False, missing="x")
    llm = ScriptedLLM(
        {
            "classify": [cls("question")],
            "sufficiency": [suf, suf],
            "rewrite": [Rewrite(reasoning="r", query="q")],
        }
    )
    app, _ = make_app(tmp_path, llm)
    assert "119" not in run_question(app, "와이파이 비번", "s1")["answer"]


def test_record_and_out_of_scope_skip_retrieval(tmp_path):
    llm = ScriptedLLM({"classify": [cls("record_request"), cls("out_of_scope")]})
    app, _ = make_app(tmp_path, llm)
    r1 = run_question(app, "티라미수 2개 폐기 기록해주세요", "s1")
    assert r1["outcome"] == "record_request" and r1["answer"] == RECORD_REPLY and not r1["retrieval_log"]
    r2 = run_question(app, "오늘 날씨", "s1")
    assert r2["outcome"] == "out_of_scope" and not r2["retrieval_log"]
    assert llm.calls == ["classify", "classify"]  # 답변 LLM 호출 없음


def test_now_tasks_uses_tool_and_attaches_evidence(tmp_path):
    llm = ScriptedLLM({"classify": [cls("now_tasks")], "answer": ["지금은 케이크 폐기예요. [근거 1]"]})
    app, _ = make_app(tmp_path, llm)
    rec = run_question(app, "지금 뭐 해요?", "s1", current_time="21:35")
    assert rec["outcome"] == "answered" and rec["tasks"]["now"] and rec["tasks"]["upcoming"]
    assert rec["evidence"] and all(e["store_id"] == "s1" for e in rec["evidence"])
    assert "21:30" in llm.last_user and "22:00" in llm.last_user  # 도구 결과가 답변 프롬프트에 실림
    assert [t["node"] for t in rec["trace"]] == ["classify", "tasks", "tasks_answer"]


def test_now_tasks_empty_returns_template_without_llm_answer(tmp_path):
    llm = ScriptedLLM({"classify": [cls("now_tasks")]})
    app, _ = make_app(tmp_path, llm)
    rec = run_question(app, "지금 뭐 해요?", "s1", current_time="12:00")
    assert rec["outcome"] == "no_tasks" and llm.calls == ["classify"]


def test_now_tasks_multiple_distinct_evidence_chunks(tmp_path):
    """서로 다른 근거 청크를 가진 일정이 둘 이상이어도 근거 번호가 항목마다 매겨진다 (회귀: evidence_key 이중 pop)."""
    llm = ScriptedLLM(
        {"classify": [cls("now_tasks")], "answer": ["케이크는 폐기, 우유는 곧이에요. [근거 1][근거 2]"]}
    )
    app, _ = make_app(tmp_path, llm)
    rec = run_question(app, "지금 뭐 해요?", "s1", current_time="21:35")
    numbers = {n for i in rec["tasks"]["now"] + rec["tasks"]["upcoming"] for n in i["evidence_ns"]}
    assert len(rec["evidence"]) >= 2  # 서로 다른 근거 청크가 둘 이상이어야 이 회귀 테스트가 의미 있다
    assert numbers <= {e["n"] for e in rec["evidence"]} and len(numbers) >= 2


def test_rewrite_structured_failure_escalates_instead_of_crashing(tmp_path):
    class FailingRewriteLLM(ScriptedLLM):
        def structured(self, *, system, user, schema, tool_name, max_tokens=1024, tag=""):
            if tag == "rewrite":
                self.calls.append(tag)
                raise RuntimeError("구조화 출력 검증 실패")
            return super().structured(
                system=system, user=user, schema=schema, tool_name=tool_name, max_tokens=max_tokens, tag=tag
            )

    suf = Sufficiency(reasoning="r", sufficient=False, missing="x")
    llm = FailingRewriteLLM({"classify": [cls("question")], "sufficiency": [suf]})
    app, _ = make_app(tmp_path, llm)
    rec = run_question(app, "이건 문서에 없는 질문", "s1")
    assert rec["outcome"] == "escalated" and len(rec["retrieval_log"]) == 1  # 재검색 없이 에스컬레이션


def test_node_failure_is_recorded_as_failed(tmp_path):
    class BrokenLLM(ScriptedLLM):
        def structured(self, **kw):
            raise RuntimeError("검증 실패")

    app, _ = make_app(tmp_path, BrokenLLM({}))
    rec = run_question(app, "질문", "s1")
    assert rec["outcome"] == "failed" and "검증 실패" in rec["error"] and rec["answer"] == ""
