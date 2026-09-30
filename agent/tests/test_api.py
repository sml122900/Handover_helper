"""POST /ask · POST /confirm (TestClient, LLM은 스크립트, 저장소는 메모리)."""

import pytest
from fastapi.testclient import TestClient
from test_tools_flow import Script, dt, plan

import app as app_module
import serve
from graph.agent import AgentDeps, build_agent
from indexing.store import MemoryStore
from tools.store import MemoryToolStore


@pytest.fixture
def client_and_tools(monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "local")
    tools = MemoryToolStore()
    llm = Script(
        [
            plan(tool="waste_log_record", item="티라미수", qty=2),
            plan(tool="waste_log_record", item="김밥", qty=1),
        ]
    )
    graph = build_agent(
        AgentDeps(
            llm=llm,
            embedder=None,
            store=MemoryStore(),
            tool_store=tools,
            clock=lambda: dt(2026, 10, 1, 21, 40),
        )
    )
    app_module.app.dependency_overrides[app_module.get_agent] = lambda: graph
    yield TestClient(app_module.app), tools
    app_module.app.dependency_overrides.clear()


def test_ask_returns_confirmation_then_confirm_executes(client_and_tools):
    client, tools = client_and_tools
    r = client.post("/ask", json={"store_id": "s1", "question": "티라미수 2개 폐기했어요, 기록 좀 해주세요"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "needs_confirmation" and body["confirmation"]["tool"] == "waste_log"
    assert "폐기 대장에 기록할까요" in body["answer"] and tools.waste == []
    c = client.post(
        "/confirm", json={"thread_id": body["thread_id"], "approve": True, "reason": "당일 마감 잔여"}
    )
    assert c.status_code == 200 and c.json()["status"] == "tool_done"
    assert (
        tools.waste[0]["reason"] == "당일 마감 잔여" and tools.waste[0]["store_id"] == "s1"
    )  # 요청의 매장 ID로 기록


def test_confirm_reject_and_double_confirm(client_and_tools):
    client, tools = client_and_tools
    tid = client.post("/ask", json={"store_id": "s3", "question": "김밥 1개 폐기 기록"}).json()["thread_id"]
    rej = client.post("/confirm", json={"thread_id": tid, "approve": False})
    assert rej.status_code == 200 and rej.json()["status"] == "tool_rejected" and tools.waste == []
    assert "기록하지 않았어요" in rej.json()["answer"]
    again = client.post("/confirm", json={"thread_id": tid, "approve": True})
    assert again.status_code == 409 and tools.waste == []  # 이미 처리된 요청은 다시 실행되지 않는다


def test_confirm_unknown_thread_is_404(client_and_tools):
    client, _ = client_and_tools
    r = client.post("/confirm", json={"thread_id": "does-not-exist", "approve": True})
    assert r.status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"question": "질문"},  # store_id 필수
        {"store_id": "s9", "question": "질문"},  # 없는 매장
        {"store_id": "s1", "question": ""},
        {"store_id": "s1", "question": "질문", "current_time": "25:99"},
        {"store_id": "S1 OR 1=1", "question": "질문"},
    ],
)
def test_ask_validates_input(client_and_tools, payload):
    client, _ = client_and_tools
    assert client.post("/ask", json=payload).status_code == 422


def test_failed_run_returns_korean_message_without_internal_error(monkeypatch):
    class Boom(Script):
        def structured(self, **kw):
            raise RuntimeError("내부 스택 정보 SECRET")

    graph = build_agent(
        AgentDeps(llm=Boom([]), embedder=None, store=MemoryStore(), tool_store=MemoryToolStore())
    )
    app_module.app.dependency_overrides[app_module.get_agent] = lambda: graph
    try:
        r = TestClient(app_module.app).post("/ask", json={"store_id": "s1", "question": "질문"})
    finally:
        app_module.app.dependency_overrides.clear()
    assert r.status_code == 200 and r.json()["status"] == "failed"
    assert "SECRET" not in r.text and "잠시 후 다시 시도" in r.json()["answer"]


def test_serve_refuses_non_local_host():
    assert serve.check_host(None) == "127.0.0.1" and serve.check_host("localhost") == "127.0.0.1"
    for bad in ("0.0.0.0", "192.168.0.10", "example.com"):
        with pytest.raises(SystemExit):
            serve.check_host(bad)
