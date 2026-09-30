from fastapi import FastAPI

from settings import get_settings

get_settings()  # 필수 키 누락 시 부팅 실패

app = FastAPI(title="Handover Agent")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
