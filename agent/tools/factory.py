from settings import Settings
from tools.store import MemoryToolStore, ToolStore


def make_tool_store(settings: Settings) -> ToolStore:
    if settings.agent_tool_store == "supabase":
        from tools.supabase_store import SupabaseToolStore

        assert settings.supabase_url and settings.supabase_service_role_key
        return SupabaseToolStore(settings.supabase_url, settings.supabase_service_role_key)
    return MemoryToolStore()
