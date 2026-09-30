"""pgvector 저장소가 메모리 저장소와 같은 결과를 내는지 (0012 적용 + Supabase 환경변수 필요, 없으면 skip).

캐시된 임베딩만 쓴다(임베딩 API 호출 없음). 이 임베딩 모델로 색인된 handover_chunks 행을 지우고 다시 넣는다(가상 코퍼스).
"""

import pytest

from embedding import get_embedder
from indexing.corpus import build_masked_index
from indexing.pgstore import PgVectorStore
from indexing.store import MemoryStore
from indexing.types import STRATEGIES
from privacy.mask import mask_text
from settings import Settings

settings = Settings()
enabled = bool(settings.supabase_url and settings.supabase_service_role_key)


@pytest.mark.skipif(not enabled, reason="Supabase 환경변수 없음")
def test_pg_matches_memory():
    import json

    from settings import ROOT

    embedder = get_embedder(settings)
    masked, vecs = build_masked_index(embedder)
    mem = MemoryStore()
    mem.add(masked, vecs)
    pg = PgVectorStore(settings.supabase_url, settings.supabase_service_role_key, embedder.model)
    try:
        pg.clear()
    except RuntimeError as e:
        pytest.fail(str(e))  # 0012 미적용이면 여기서 실패
    pg.add(masked, vecs)

    golden = [
        json.loads(line) for line in (ROOT / "eval" / "golden.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    golden = [q for q in golden if q["type"] in ("fact", "time")]
    qvecs = embedder.embed([mask_text(q["question"]) for q in golden], "query")

    def key(hits):
        return [
            (
                h.chunk.raw.source_file,
                h.chunk.raw.char_start,
                h.chunk.raw.char_end,
                h.chunk.raw.chunking_strategy,
            )
            for h in hits
        ]

    checked = 0
    for strategy in STRATEGIES:
        for use_filter in (True, False):
            for q, qv in zip(golden, qvecs, strict=True):
                sid = q["store"].lower() if use_filter else None
                a = mem.search(qv, 5, strategy, sid)
                b = pg.search(qv, 5, strategy, sid)
                assert key(a) == key(b), (strategy, use_filter, q["id"])
                assert [round(h.score, 4) for h in a] == [round(h.score, 4) for h in b]
                checked += 1
    assert checked == 150
    hit = next(
        h.chunk for h in pg.search(qvecs[0], 5, "procedure", "s1") if h.chunk.raw.source_type == "document"
    )
    assert hit.raw.section and hit.raw.confidence in ("high", "needs_review")  # 메타데이터가 저장·복원됨
