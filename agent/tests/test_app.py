import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from settings import Settings


def test_health(monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "local")
    import app

    assert TestClient(app.app).get("/health").json() == {"status": "ok"}


def test_voyage_requires_key():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, embedding_provider="voyage", voyage_api_key=None)


def test_local_does_not_require_key():
    s = Settings(_env_file=None, embedding_provider="local", voyage_api_key=None)
    assert s.embedding_model == "BAAI/bge-m3"
