from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """환경 변수 설정. 필수 키가 없으면 부팅(생성) 시점에 실패한다."""

    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", env_file_encoding="utf-8-sig", extra="ignore", populate_by_name=True
    )

    # 검색 저장소: memory(기본, 평가 재현용) | pg(0012 handover_chunks, service_role)
    agent_store: Literal["memory", "pg"] = "memory"
    # 쓰기 도구 저장소: memory(기본) | supabase(0013 적용 후, service_role)
    agent_tool_store: Literal["memory", "supabase"] = "memory"
    supabase_url: str | None = Field(
        default=None, validation_alias=AliasChoices("supabase_url", "NEXT_PUBLIC_SUPABASE_URL")
    )
    supabase_service_role_key: str | None = None
    anthropic_api_key: str | None = None
    # 답변·분류·충분성 판단 모델 — 기존 앱과 같은 HANDOVER_MODEL (기본 claude-sonnet-4-6)
    agent_model: str = Field(
        default="claude-sonnet-4-6", validation_alias=AliasChoices("agent_model", "HANDOVER_MODEL")
    )
    # 답변 프롬프트 버전: v1(기준선) | v2(실험 D' 개선안)
    agent_answer_prompt: str = "v1"
    # 실행당 Claude 비용 상한(USD). 넘으면 그 실행을 중단하고 사용량을 보고한다
    agent_cost_budget_usd: float = 5.0
    # 채점 모델 (Groq, Claude 계열 금지 — 설계 7-3). 모델명은 설정값
    judge_model: str = "openai/gpt-oss-120b"
    embedding_provider: Literal["voyage", "local"] = "voyage"
    voyage_api_key: str | None = None
    groq_api_key: str | None = None  # 채점 모델(Groq) 호출용 — 채점 스크립트에서만 필수
    # provider별 기본 모델: voyage-4(1024차원) / bge-m3(1024차원)
    embedding_model: str | None = None
    # 실행당 임베딩 토큰 상한 (Voyage 대시보드 예산은 알림만 보내고 호출을 막지 않으므로 코드에서 막는다)
    embedding_token_budget: int = 200_000
    embedding_cache_dir: Path = ROOT / "agent" / ".cache" / "embeddings"

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if self.embedding_provider == "voyage" and not self.voyage_api_key:
            raise ValueError("EMBEDDING_PROVIDER=voyage 이면 VOYAGE_API_KEY가 필요합니다.")
        if self.agent_store == "pg" and not (self.supabase_url and self.supabase_service_role_key):
            raise ValueError(
                "AGENT_STORE=pg 이면 NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 필요합니다."
            )
        if self.embedding_model is None:
            self.embedding_model = "voyage-4" if self.embedding_provider == "voyage" else "BAAI/bge-m3"
        return self


def get_settings() -> Settings:
    return Settings()
