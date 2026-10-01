"""MCP 서버 (설계 6-4): 인수인계 문서 읽기 도구 3개를 stdio로 노출한다 — Claude Desktop 연결용.

실행: npm run agent:mcp  (= uv run --directory agent python mcp_server.py)
노출: search_handover, get_procedure, get_current_tasks (모두 읽기 전용, 매장 ID 필수)
제외: log_checklist, waste_log 기록, notify_manager — MCP 클라이언트에는 이 서비스의 확인 단계(사용자 승인 뒤에만 저장,
     설계 6-2)가 없어 "확인 없는 쓰기 금지"(설계 1-2)를 보장할 수 없다. 기록은 인수인계 앱의 확인 단계를 거쳐서만 한다.
데이터: 가상 코퍼스(data/virtual, 실제 매장과 무관). 표준출력은 MCP 프로토콜 전용이라 로그는 표준에러로만 쓴다.
"""

import re
from functools import lru_cache
from typing import Annotated, Literal

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations
from pydantic import Field

from graph.agent import DEFAULT_STRATEGY, K, evidence_label, to_evidence
from graph.tools import get_current_tasks as tasks_for
from indexing.corpus import load_sources
from privacy.mask import mask_text

StoreId = Annotated[
    Literal["s1", "s2", "s3", "s4", "s5"],
    Field(  # 매장 이름은 data/virtual/sN.md 머리말과 같다
        description="가상 매장 ID: s1 달빛커피(카페 마감) · s2 보리밭제과(베이커리 마감) · s3 한빛마트24(편의점 야간) · s4 오름피트니스(헬스장 오픈) · s5 동남물류 3센터(상하차 야간)"
    ),
]
READ_ONLY = ToolAnnotations(
    read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False
)
NO_WRITE = (
    "읽기 전용이다. 체크리스트 완료 기록·폐기 대장 기록·점장 알림 같은 쓰기 도구는 이 서버에 없다 — "
    "MCP 클라이언트에는 이 서비스의 확인 단계(사용자 승인 뒤에만 저장)가 없어 승인 없는 쓰기를 막을 수 없기 때문이다. "
    "기록이 필요하면 인수인계 앱에서 확인 단계를 거쳐 하라고 안내한다."
)

server = MCPServer(
    "handover-agent",
    instructions=(
        "인수인계 문서(가상 매장 5곳) 읽기 도구. 답할 때는 도구 결과에 있는 내용만 쓰고 출처(source)를 함께 밝힌다. "
        "needs_check가 true인 근거는 '[확인 필요]'를 붙이고 점장 확인을 권한다. 결과에 없으면 '문서에 없다'고 말한다. "
        + NO_WRITE
    ),
)


@lru_cache(maxsize=1)
def _index():
    """검색 인덱스(메모리, 임베딩 디스크 캐시 사용). 첫 검색 때 한 번 만든다."""
    from embedding import get_embedder
    from indexing.corpus import build_masked_index
    from indexing.store import MemoryStore
    from settings import get_settings

    embedder = get_embedder(get_settings())
    store = MemoryStore()
    store.add(*build_masked_index(embedder))
    return embedder, store


@server.tool(
    description="매장 인수인계 문서·영상 발언에서 질문과 관련된 근거 조각을 찾는다(매장 필터, 상위 5개). "
    + NO_WRITE,
    annotations=READ_ONLY,
)
def search_handover(
    store_id: StoreId, query: Annotated[str, Field(min_length=1, max_length=500, description="찾을 내용")]
) -> dict:
    embedder, store = _index()
    hits = store.search(embedder.embed([mask_text(query)], "query")[0], K, DEFAULT_STRATEGY, store_id)
    return {
        "store_id": store_id,
        "results": [
            {
                "source": evidence_label(e),
                "kind": "문서" if e["source_type"] == "document" else "영상 발언",
                "needs_check": e["needs_check"],
                "text": e["text"],
            }
            for e in to_evidence(hits)
        ],
    }


_ITEM = re.compile(r"^\d+\. \*\*(?P<title>.+?)\*\*(?P<meta>[^\n]*)\n(?P<body>(?:[ \t]+[^\n]*\n?)*)", re.M)


def procedures(store_id: str) -> list[dict]:
    """문서 '## 2. 절차'의 항목 (마스킹 후)."""
    doc = next(s.text for s in load_sources() if s.store_id == store_id and s.source_type == "document")
    section = re.search(r"^## 2\. 절차\n(.*?)(?=^## )", doc, re.S | re.M).group(1)
    out = []
    for m in _ITEM.finditer(str(mask_text(section))):
        meta = m.group("meta")
        ts = re.search(r"영상 ([\d:~]+)", meta)
        out.append(
            {
                "title": m.group("title"),
                "video": ts.group(1) if ts else None,
                "needs_check": "[AI 보완" in meta or "[확인 필요]" in meta + m.group("body"),
                "text": " ".join(line.strip() for line in m.group("body").splitlines() if line.strip()),
            }
        )
    return out


def _norm(s: str) -> str:
    return re.sub(r"[\s\W_]+", "", s)


@server.tool(
    description="매장 문서의 '절차' 항목을 이름으로 찾아 단계 내용을 돌려준다. 못 찾으면 절차 이름 목록을 돌려준다. "
    + NO_WRITE,
    annotations=READ_ONLY,
)
def get_procedure(
    store_id: StoreId,
    name: Annotated[str, Field(min_length=1, max_length=100, description="절차 이름 (예: 마감 정산)")],
) -> dict:
    items = procedures(store_id)
    key = _norm(name)
    found = [p for p in items if key and (key in _norm(p["title"]) or _norm(p["title"]) in key)]
    if not found:
        words = [w for w in re.split(r"\s+", name) if len(w) >= 2]
        found = [p for p in items if words and all(_norm(w) in _norm(p["title"] + p["text"]) for w in words)]
    if not found:
        return {"store_id": store_id, "found": False, "procedures": [p["title"] for p in items]}
    return {"store_id": store_id, "found": True, "matches": found}


@server.tool(
    description="매장 일정에서 '지금 시작한 일(최근 30분)'과 '곧 있을 일(30분 이내)'을 돌려준다. 시각은 Asia/Seoul. "
    + NO_WRITE,
    annotations=READ_ONLY,
)
def get_current_tasks(
    store_id: StoreId,
    current_time: Annotated[
        str | None,
        Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="HH:MM, 없으면 현재 서울 시각"),
    ] = None,
) -> dict:
    r = tasks_for(store_id, current_time)
    return {k: r[k] for k in ("store_id", "current_time", "now", "upcoming")}


if __name__ == "__main__":
    server.run("stdio")
