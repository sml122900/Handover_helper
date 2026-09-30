"""pgvector 저장소 (0012 handover_chunks) — MemoryStore와 같은 인터페이스.

Supabase PostgREST를 service_role 키로 호출한다 (테이블은 service_role 전용).
검색은 RPC match_handover_chunks(코사인 거리)로 하고, RPC가 전략 필터를 하나만 받으므로
"문서 전략 + 공통 트랜스크립트"는 두 번 조회해 거리순으로 합친다.
"""

import httpx
import numpy as np

from indexing.chunkers import TRANSCRIPT_STRATEGY
from indexing.store import Hit
from indexing.types import MaskedChunk, RawChunk

TABLE = "handover_chunks"
INSERT_BATCH = 50


class PgVectorStore:
    def __init__(self, url: str, service_key: str, embedding_model: str):
        self._base = url.rstrip("/") + "/rest/v1"
        self._headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }
        self.embedding_model = embedding_model
        self._http = httpx.Client(timeout=60)

    def _check(self, r: httpx.Response) -> httpx.Response:
        if r.status_code >= 400:
            raise RuntimeError(f"pgvector 저장소 오류 {r.status_code}: {r.text[:300]} (0012 적용 여부 확인)")
        return r

    def clear(self) -> None:
        """이 임베딩 모델로 색인된 행만 삭제 (재색인용)."""
        self._check(
            self._http.delete(
                f"{self._base}/{TABLE}",
                headers=self._headers,
                params={"embedding_model": f"eq.{self.embedding_model}"},
            )
        )

    def add(self, chunks: list[MaskedChunk], vectors: np.ndarray) -> None:
        for c in chunks:
            if not isinstance(c, MaskedChunk):
                raise TypeError("MaskedChunk만 색인할 수 있습니다")
        rows = [
            {
                "store_id": c.raw.store_id,
                "source_type": c.raw.source_type,
                "section": c.raw.section,
                "item_id": c.raw.item_id,
                "video_ts_start": c.raw.video_ts_start,
                "video_ts_end": c.raw.video_ts_end,
                "confidence": c.raw.confidence,
                "inferred": c.raw.inferred,
                "source_file": c.raw.source_file,
                "char_start": c.raw.char_start,
                "char_end": c.raw.char_end,
                "content": str(c.body),
                "chunking_strategy": c.raw.chunking_strategy,
                "embedding_model": self.embedding_model,
                "embedding": "[" + ",".join(repr(float(x)) for x in v) + "]",
            }
            for c, v in zip(chunks, vectors, strict=True)
        ]
        for i in range(0, len(rows), INSERT_BATCH):
            self._check(
                self._http.post(
                    f"{self._base}/{TABLE}", headers=self._headers, json=rows[i : i + INSERT_BATCH]
                )
            )

    def _rpc(self, qvec: np.ndarray, k: int, strategy: str, store_id: str | None) -> list[dict]:
        body = {
            "query_embedding": "[" + ",".join(repr(float(x)) for x in qvec) + "]",
            "match_count": k,
            "filter_store": store_id,
            "filter_strategy": strategy,
        }
        return self._check(
            self._http.post(f"{self._base}/rpc/match_handover_chunks", headers=self._headers, json=body)
        ).json()

    def search(self, query_vec: np.ndarray, k: int, strategy: str, store_id: str | None) -> list[Hit]:
        cand: list[dict] = []
        for strat in dict.fromkeys((strategy, TRANSCRIPT_STRATEGY)):
            cand += self._rpc(query_vec, k, strat, store_id)
        cand = sorted(cand, key=lambda r: (r["distance"], r["id"]))[:k]
        if not cand:
            return []
        ids = ",".join(r["id"] for r in cand)
        full = self._check(
            self._http.get(
                f"{self._base}/{TABLE}", headers=self._headers, params={"id": f"in.({ids})", "select": "*"}
            )
        ).json()
        by_id = {r["id"]: r for r in full}
        hits = []
        for r in cand:
            row = by_id[r["id"]]
            raw = RawChunk(
                store_id=row["store_id"],
                source_type=row["source_type"],
                source_file=row["source_file"],
                section=row["section"],
                item_id=row["item_id"],
                char_start=row["char_start"],
                char_end=row["char_end"],
                video_ts_start=row["video_ts_start"],
                video_ts_end=row["video_ts_end"],
                confidence=row["confidence"],
                inferred=row["inferred"],
                chunking_strategy=row["chunking_strategy"],
                body=row["content"],
            )
            hits.append(Hit(raw.to_masked(), 1.0 - float(r["distance"])))
        return hits
