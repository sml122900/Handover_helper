from embedding.base import Embedder
from settings import Settings


def get_embedder(settings: Settings, token_budget: int | None = None) -> Embedder:
    assert settings.embedding_model
    if token_budget is None:
        token_budget = settings.embedding_token_budget
    if settings.embedding_provider == "voyage":
        from embedding.voyage import VoyageEmbedder

        assert settings.voyage_api_key
        return VoyageEmbedder(
            settings.embedding_model, settings.embedding_cache_dir, settings.voyage_api_key, token_budget
        )
    from embedding.local import LocalEmbedder

    return LocalEmbedder(settings.embedding_model, settings.embedding_cache_dir, token_budget)
