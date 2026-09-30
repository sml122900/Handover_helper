import time
from collections import deque
from collections.abc import Sequence

import httpx

from embedding.base import Embedder, InputType
from indexing.tokens import count_tokens
from privacy.mask import MaskedText

URL = "https://api.voyageai.com/v1/embeddings"

# voyage-4 Usage tier 1 한도(대시보드 2,000 RPM / 8,000,000 TPM)의 절반 (2026-09-30 결제 수단 등록 후 상향)
RPM_LIMIT = 1_000
TPM_LIMIT = 4_000_000


class VoyageEmbedder(Embedder):
    provider = "voyage"
    max_batch_tokens = 4_000  # 배치 1개의 토큰 크기

    def __init__(self, model, cache_dir, api_key: str, token_budget: int | None = None):
        super().__init__(model, cache_dir, token_budget)
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        self._window: deque[tuple[float, int]] = deque()  # (호출 시각, 토큰) — 최근 60초

    def _text_tokens(self, text: str) -> int:
        return count_tokens(text, self.model)

    def _wait_for_rate_limit(self, tokens: int) -> None:
        while True:
            now = time.monotonic()
            while self._window and now - self._window[0][0] >= 61:
                self._window.popleft()
            used = sum(t for _, t in self._window)
            if len(self._window) < RPM_LIMIT and used + tokens <= TPM_LIMIT:
                return
            time.sleep(max(1.0, 61 - (now - self._window[0][0])) if self._window else 1.0)

    def _embed_batch(self, texts: Sequence[MaskedText], input_type: InputType) -> list[list[float]]:
        estimate = sum(count_tokens(t, self.model) for t in texts)
        body = {"input": [str(t) for t in texts], "model": self.model, "input_type": input_type}
        for attempt in range(6):
            self._wait_for_rate_limit(estimate)
            self._window.append((time.monotonic(), estimate))
            r = httpx.post(URL, headers=self._headers, json=body, timeout=60)
            if r.status_code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(30)
                continue
            r.raise_for_status()
            break
        data = r.json()
        self.api_calls += 1
        self._record_usage(data["usage"]["total_tokens"], input_type)
        return [d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"])]
