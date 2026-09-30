from collections.abc import Sequence

from embedding.base import Embedder, InputType
from privacy.mask import MaskedText


class LocalEmbedder(Embedder):
    """sentence-transformers CPU 실행 (uv sync --extra local).

    bge-m3는 접두어가 필요 없고, e5 계열은 query:/passage: 접두어를 붙인다. (이번 세션에서는 실행하지 않음)
    """

    provider = "local"

    def __init__(self, model, cache_dir, token_budget: int | None = None):
        super().__init__(model, cache_dir, token_budget)
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model, device="cpu")

    def _embed_batch(self, texts: Sequence[MaskedText], input_type: InputType) -> list[list[float]]:
        prefix = ""
        if "e5" in self.model.lower():
            prefix = "query: " if input_type == "query" else "passage: "
        vecs = self._model.encode([prefix + str(t) for t in texts], normalize_embeddings=True)
        return vecs.tolist()
