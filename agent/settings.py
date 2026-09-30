from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """환경 변수 설정. 필수 키가 없으면 부팅(생성) 시점에 실패한다."""

    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    embedding_provider: Literal["voyage", "local"] = "voyage"
    voyage_api_key: str | None = None
    # provider별 기본 모델: voyage-4(1024차원) / bge-m3(1024차원)
    embedding_model: str | None = None
    # 실행당 임베딩 토큰 상한 (Voyage 대시보드 예산은 알림만 보내고 호출을 막지 않으므로 코드에서 막는다)
    embedding_token_budget: int = 200_000
    embedding_cache_dir: Path = ROOT / "agent" / ".cache" / "embeddings"

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if self.embedding_provider == "voyage" and not self.voyage_api_key:
            raise ValueError("EMBEDDING_PROVIDER=voyage 이면 VOYAGE_API_KEY가 필요합니다.")
        if self.embedding_model is None:
            self.embedding_model = "voyage-4" if self.embedding_provider == "voyage" else "BAAI/bge-m3"
        return self


def get_settings() -> Settings:
    return Settings()
