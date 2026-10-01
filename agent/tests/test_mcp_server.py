"""MCP 서버(설계 6-4): 실제 MCP 클라이언트로 stdio에 붙어 도구 목록과 각 도구 결과를 확인한다.

쓰기 도구(체크리스트·폐기 기록·점장 알림)는 목록에 없어야 한다. 검색 질의는 골든셋 문항(F10)이라
임베딩이 디스크 캐시에 있어 Voyage를 호출하지 않는다 (VOYAGE_API_KEY가 없으면 검색 확인만 건너뜀).
"""

import asyncio
import json
import sys
from pathlib import Path

import pytest
from mcp import Client, StdioServerParameters

from settings import Settings

AGENT = Path(__file__).resolve().parents[1]
READ_TOOLS = {"search_handover", "get_procedure", "get_current_tasks"}
WRITE_TOOLS = {"log_checklist", "waste_log", "waste_log_record", "waste_log_query", "notify_manager"}
F10 = "마감하고 돈 세는데 화면에 뜬 금액이랑 실제 돈이 좀 달라요, 이거 어디다 말해야 돼요?"


def session(fn):
    async def run():
        params = StdioServerParameters(command=sys.executable, args=["mcp_server.py"], cwd=str(AGENT))
        async with Client(params) as client:
            return await fn(client)

    return asyncio.run(run())


async def call(client, name: str, args: dict):
    r = await client.call_tool(name, args)
    return r.is_error, (json.loads(r.content[0].text) if not r.is_error else r.content[0].text)


def test_only_read_tools_are_listed():
    async def fn(client):
        return (await client.list_tools()).tools

    tools = session(fn)
    names = {t.name for t in tools}
    assert names == READ_TOOLS
    assert not names & WRITE_TOOLS
    for t in tools:
        assert t.annotations.read_only_hint is True and t.annotations.destructive_hint is False
        assert "쓰기 도구" in t.description and "확인 단계" in t.description  # 제외 이유가 설명에 있다


def test_read_tools_return_store_scoped_results_and_write_call_fails():
    async def fn(client):
        return {
            "proc": await call(client, "get_procedure", {"store_id": "s1", "name": "마감 정산"}),
            "proc_ai": await call(client, "get_procedure", {"store_id": "s3", "name": "새벽 3시 폐기 점검"}),
            "proc_none": await call(client, "get_procedure", {"store_id": "s1", "name": "주차 등록"}),
            "tasks": await call(client, "get_current_tasks", {"store_id": "s1", "current_time": "21:35"}),
            "bad_time": await call(client, "get_current_tasks", {"store_id": "s1", "current_time": "25:00"}),
            "write": await call(client, "notify_manager", {"store_id": "s4", "message": "벨트 미끄러짐"}),
        }

    r = session(fn)
    err, proc = r["proc"]
    assert not err and proc["found"] and proc["matches"][0]["title"] == "마감 정산"
    assert "흰 봉투" in proc["matches"][0]["text"] and proc["matches"][0]["video"] == "6:48~7:41"
    assert r["proc_ai"][1]["matches"][0]["needs_check"] is True  # [AI 보완] 항목은 확인 필요 표시
    err, none = r["proc_none"]
    assert not err and none["found"] is False and len(none["procedures"]) == 9
    err, tasks = r["tasks"]
    assert not err and tasks["current_time"] == "21:35"
    assert any("s1.machine_clean" in i["step_ids"] for i in tasks["now"])
    assert any(i["time"] == "22:00" for i in tasks["upcoming"])
    assert r["bad_time"][0] is True  # 시각 형식 검증
    assert r["write"][0] is True and "Unknown tool" in r["write"][1]


@pytest.mark.skipif(not Settings().voyage_api_key, reason="VOYAGE_API_KEY 없음")
def test_search_handover_store_filter():
    async def fn(client):
        return await call(client, "search_handover", {"store_id": "s1", "query": F10})

    err, res = session(fn)
    assert not err and len(res["results"]) == 5
    assert all(x["source"].startswith("S1") for x in res["results"])  # 매장 필터
    assert any("단톡방" in x["text"] for x in res["results"])
