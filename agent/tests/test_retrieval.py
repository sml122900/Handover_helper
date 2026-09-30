import importlib.util
import sys
from math import comb
from pathlib import Path

import numpy as np
import pytest

from embedding.base import Embedder
from indexing.store import MemoryStore
from indexing.types import RawChunk
from privacy.mask import MaskedText, mask_text

_spec = importlib.util.spec_from_file_location(
    "retrieval", Path(__file__).resolve().parents[2] / "eval" / "retrieval.py"
)
retrieval = importlib.util.module_from_spec(_spec)
sys.modules["retrieval"] = retrieval
_spec.loader.exec_module(retrieval)


def raw(store="s1", file="a.md", start=0, end=10, strategy="procedure", kind="document") -> RawChunk:
    return RawChunk(store, kind, file, None, None, start, end, None, None, "high", False, strategy, "본문")


def test_overlap_rules():
    spans = [("a.md", 10, 20)]
    assert retrieval.overlaps(SimpleChunk(raw(start=15, end=30)), spans)
    assert retrieval.overlaps(SimpleChunk(raw(start=0, end=11)), spans)
    assert not retrieval.overlaps(SimpleChunk(raw(start=20, end=30)), spans)  # 끝이 맞닿기만 하면 겹침 아님
    assert not retrieval.overlaps(SimpleChunk(raw(start=0, end=10)), spans)
    assert not retrieval.overlaps(
        SimpleChunk(raw(file="b.md", start=10, end=20)), spans
    )  # 파일이 다르면 아님


class SimpleChunk:
    def __init__(self, r):
        self.raw = r


def test_random_baseline_single_fact_matches_formula():
    n, m = 40, 3
    fact, full = retrieval.random_baseline([set(range(m))], n)
    expected = 1 - comb(n - m, 5) / comb(n, 5)
    assert fact == pytest.approx(expected)
    assert full == pytest.approx(expected)  # 사실 1개면 문항 완전 적중 = 사실 적중


def test_random_baseline_two_facts_inclusion_exclusion():
    n = 10
    a, b = {0, 1}, {2, 3}
    _, full = retrieval.random_baseline([a, b], n)
    # 전수 계산과 대조
    from itertools import combinations

    hit = sum(1 for s in combinations(range(n), 5) if set(s) & a and set(s) & b)
    assert full == pytest.approx(hit / comb(n, 5))


def test_random_baseline_pool_smaller_than_k_is_full():
    fact, full = retrieval.random_baseline([{0}], 5)  # 풀 5개면 5개 전부 뽑힘
    assert fact == 1.0 and full == 1.0


class FakeEmbedder(Embedder):
    provider = "fake"

    def _embed_batch(self, texts, input_type):
        self.api_calls += 1
        return [[float(len(t)), 1.0, float(input_type == "query")] for t in texts]


def test_embedder_rejects_unmasked_and_caches(tmp_path):
    e = FakeEmbedder("m", tmp_path)
    with pytest.raises(TypeError):
        e.embed(["원문 문자열"], "document")  # type: ignore[list-item]
    t = [mask_text("가나다"), mask_text("라마")]
    e.embed(t, "document")
    assert e.api_calls == 1
    e.embed(t, "document")
    assert e.api_calls == 1  # 캐시 적중 — 재호출 없음
    e.embed(t, "query")
    assert e.api_calls == 2  # 입력 타입이 다르면 별도 캐시


def test_embedder_saves_each_batch_before_failing(tmp_path):
    class Flaky(FakeEmbedder):
        max_batch_items = 1

        def _embed_batch(self, texts, input_type):
            if self.api_calls == 1:
                raise RuntimeError("429")
            return super()._embed_batch(texts, input_type)

    e = Flaky("m", tmp_path)
    texts = [mask_text("가"), mask_text("나")]
    with pytest.raises(RuntimeError):
        e.embed(texts, "document")
    assert len(list(e.cache_dir.glob("*.npy"))) == 1  # 성공한 배치는 남아 있다
    e2 = FakeEmbedder("m", tmp_path)
    e2.embed(texts, "document")
    assert e2.api_calls == 1  # 남은 1개만 호출


def test_store_pool_and_search():
    store = MemoryStore()
    chunks = [
        raw("s1", strategy="procedure").to_masked(),
        raw("s2", strategy="procedure").to_masked(),
        raw("s1", strategy="fixed150").to_masked(),
        raw("s1", strategy="transcript_fixed150", kind="transcript").to_masked(),
    ]
    store.add(chunks, np.array([[1, 0], [0, 1], [1, 1], [1, 0.1]], dtype=np.float32))
    assert store.pool("procedure", "s1") == [0, 3]  # 다른 전략·다른 매장 제외, 트랜스크립트는 공통
    assert store.pool("procedure", None) == [0, 1, 3]
    hits = store.search(np.array([1, 0], dtype=np.float32), 2, "procedure", None)
    assert [h.chunk.raw.store_id for h in hits] == ["s1", "s1"]
    with pytest.raises(TypeError):
        store.add(["x"], np.zeros((1, 2)))  # type: ignore[list-item]


def test_masked_text_is_str_subclass():
    assert isinstance(mask_text("a"), MaskedText)


def test_embedder_stops_when_run_budget_exceeded(tmp_path):
    from embedding.base import BudgetExceeded

    class Counting(FakeEmbedder):
        max_batch_items = 1

        def _embed_batch(self, texts, input_type):
            self._record_usage(sum(len(t) for t in texts), input_type)  # 과금 토큰 = 글자 수로 흉내
            return super()._embed_batch(texts, input_type)

    e = Counting("m", tmp_path, token_budget=5)
    texts = [mask_text("가나"), mask_text("다라"), mask_text("마바")]  # 배치당 2토큰
    with pytest.raises(BudgetExceeded) as err:
        e.embed(texts, "document")
    assert e.run_tokens == 4 and e.api_calls == 2  # 2개까지 처리, 3번째(4+2>5)에서 중단
    assert "EMBEDDING_TOKEN_BUDGET=5" in str(err.value) and "사용 4토큰" in str(err.value)
    assert len(list(e.cache_dir.glob("*.npy"))) == 2  # 받은 것은 캐시에 남음


def test_settings_default_budget():
    from settings import Settings

    assert Settings(_env_file=None, embedding_provider="local").embedding_token_budget == 200_000
