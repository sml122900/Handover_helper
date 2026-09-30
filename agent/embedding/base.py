import hashlib
import json
from abc import ABC, abstractmethod
from collections.abc import Sequence
from pathlib import Path
from typing import Literal

import numpy as np

from privacy.mask import MaskedText

InputType = Literal["query", "document"]


class BudgetExceeded(RuntimeError):
    pass


class Embedder(ABC):
    """마스킹된 텍스트(MaskedText)만 임베딩한다. 같은 (모델, 입력 타입, 텍스트)는 디스크 캐시에서 재사용."""

    provider: str

    def __init__(self, model: str, cache_dir: Path, token_budget: int | None = None):
        self.model = model
        self.cache_dir = cache_dir / model.replace("/", "_")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.token_budget = token_budget
        self.api_calls = 0  # 캐시에 없어 실제 호출한 배치 수 (재실행 시 0이어야 함)

    def _key(self, text: str, input_type: str) -> Path:
        h = hashlib.sha256(f"{self.provider}|{self.model}|{input_type}|{text}".encode()).hexdigest()
        return self.cache_dir / f"{h}.npy"

    def embed(self, texts: Sequence[MaskedText], input_type: InputType) -> np.ndarray:
        for t in texts:
            if not isinstance(t, MaskedText):
                raise TypeError("임베딩 입력은 mask_text()를 거친 MaskedText여야 합니다")
        paths = [self._key(t, input_type) for t in texts]
        missing = [i for i, p in enumerate(paths) if not p.exists()]
        # 배치마다 즉시 캐시에 저장 — 중간에 실패해도 이미 받은(과금된) 임베딩은 잃지 않는다
        for batch in self._batches(missing, texts):
            vecs = self._embed_batch([texts[i] for i in batch], input_type)
            for i, v in zip(batch, vecs, strict=True):
                np.save(paths[i], np.asarray(v, dtype=np.float32))
        return np.stack([np.load(p) for p in paths])

    max_batch_items = 64
    max_batch_tokens: int | None = None

    def _text_tokens(self, text: str) -> int:
        return len(text)

    def _batches(self, missing: list[int], texts: Sequence[MaskedText]) -> list[list[int]]:
        out: list[list[int]] = []
        cur: list[int] = []
        cur_tokens = 0
        for i in missing:
            n = self._text_tokens(texts[i])
            too_big = self.max_batch_tokens is not None and cur_tokens + n > self.max_batch_tokens
            if cur and (len(cur) >= self.max_batch_items or too_big):
                out.append(cur)
                cur, cur_tokens = [], 0
            cur.append(i)
            cur_tokens += n
        if cur:
            out.append(cur)
        return out

    # ---- 토큰 사용량 기록 (예산 가드) ----
    @property
    def _usage_file(self) -> Path:
        return self.cache_dir.parent / "usage.jsonl"

    def tokens_used(self) -> int:
        if not self._usage_file.exists():
            return 0
        lines = self._usage_file.read_text().splitlines()
        return sum(json.loads(line)["tokens"] for line in lines if line)

    def _record_usage(self, tokens: int, input_type: str) -> None:
        with self._usage_file.open("a") as f:
            f.write(json.dumps({"model": self.model, "input_type": input_type, "tokens": tokens}) + "\n")

    @abstractmethod
    def _embed_batch(self, texts: Sequence[MaskedText], input_type: InputType) -> list[list[float]]: ...
