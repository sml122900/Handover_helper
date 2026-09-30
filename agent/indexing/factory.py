from indexing.store import MemoryStore, VectorStore
from settings import Settings


def make_store(settings: Settings, embedding_model: str) -> VectorStore:
    if settings.agent_store == "pg":
        from indexing.pgstore import PgVectorStore

        assert settings.supabase_url and settings.supabase_service_role_key
        return PgVectorStore(settings.supabase_url, settings.supabase_service_role_key, embedding_model)
    return MemoryStore()
