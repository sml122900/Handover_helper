from dataclasses import dataclass
from typing import Protocol

import numpy as np

from indexing.types import MaskedChunk


@dataclass(frozen=True)
class Hit:
    chunk: MaskedChunk
    score: float


class VectorStore(Protocol):
    def add(self, chunks: list[MaskedChunk], vectors: np.ndarray) -> None: ...

    def search(self, query_vec: np.ndarray, k: int, strategy: str, store_id: str | None) -> list[Hit]: ...


class MemoryStore:
    """메모리 벡터 저장소 (코사인 유사도, 정확 검색). pgvector 테이블(0012)과 같은 필드를 갖는다.

    0012 적용 전 개발·측정용. 색인에는 MaskedChunk만 들어온다.
    """

    def __init__(self) -> None:
        self.chunks: list[MaskedChunk] = []
        self._vecs = np.zeros((0, 0), dtype=np.float32)

    def add(self, chunks: list[MaskedChunk], vectors: np.ndarray) -> None:
        for c in chunks:
            if not isinstance(c, MaskedChunk):
                raise TypeError("MaskedChunk만 색인할 수 있습니다")
        v = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
        self._vecs = v if not self.chunks else np.vstack([self._vecs, v])
        self.chunks += chunks

    def pool(self, strategy: str, store_id: str | None) -> list[int]:
        """조건의 검색 대상: 해당 문서 청킹 전략 + 공통 트랜스크립트. store_id가 있으면 그 매장만."""
        return [
            i
            for i, c in enumerate(self.chunks)
            if (c.raw.source_type == "transcript" or c.raw.chunking_strategy == strategy)
            and (store_id is None or c.raw.store_id == store_id)
        ]

    def search(self, query_vec: np.ndarray, k: int, strategy: str, store_id: str | None) -> list[Hit]:
        idx = self.pool(strategy, store_id)
        q = query_vec / np.linalg.norm(query_vec)
        scores = self._vecs[idx] @ q
        # 동점은 청크 순서로 고정 (재현성)
        order = sorted(range(len(idx)), key=lambda j: (-float(scores[j]), idx[j]))[:k]
        return [Hit(self.chunks[idx[j]], float(scores[j])) for j in order]
