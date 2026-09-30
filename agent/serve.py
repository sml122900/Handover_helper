"""에이전트 API 실행 — 127.0.0.1 바인딩만 허용.

인증이 없으므로 외부 노출·배포는 Next.js 세션 기반 인증과 사용자→매장 매핑이 붙기 전까지 금지한다
(CLAUDE.md, 결정 로그 2026-10-01). 호스트를 바꿀 수 있는 옵션을 일부러 두지 않는다.
"""

import os

HOST = "127.0.0.1"


def check_host(requested: str | None) -> str:
    """AGENT_HOST가 설정돼 있어도 127.0.0.1이 아니면 실행을 거부한다."""
    if requested not in (None, "", HOST, "localhost"):
        raise SystemExit(
            f"에이전트 API는 {HOST}에서만 실행할 수 있어요 (요청: {requested}). 외부 노출은 인증이 붙기 전까지 금지입니다."
        )
    return HOST


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app", host=check_host(os.getenv("AGENT_HOST")), port=int(os.getenv("AGENT_PORT", "8000"))
    )
