"""채점 모델(Groq, OpenAI 호환 chat completions) 호출 — 구조화 출력(strict json_schema), temperature 0.

채점 모델은 Claude 계열이 아니어야 한다(설계 7-3). 모델명은 설정값(AGENT_JUDGE_MODEL).
"""

import copy
import json
import re
import time
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from llm.client import CallInfo, CostTracker, cost_of

T = TypeVar("T", bound=BaseModel)
URL = "https://api.groq.com/openai/v1/chat/completions"


def inline_refs(schema: dict) -> dict:
    """pydantic이 만든 $defs/$ref를 펼친다 (strict 모드에서 $ref 지원 여부와 무관하게 안전하게)."""
    defs = schema.get("$defs", {})

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(copy.deepcopy(defs[node["$ref"].split("/")[-1]]))
            return {k: walk(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(schema)


class GroqJudge:
    def __init__(self, api_key: str, model: str, tracker: CostTracker):
        self.model = model
        self.tracker = tracker
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        # Groq 무료·기본 등급은 분당 8,000토큰(입력+요청한 최대 출력) 제한이라 응답 헤더의 잔여 토큰으로 호출 간격을 조절한다
        self._remaining_tokens: int | None = None
        self._reset_at = 0.0

    def _pace(self, estimate: int) -> None:
        if self._remaining_tokens is not None and estimate > self._remaining_tokens:
            time.sleep(max(0.0, self._reset_at - time.monotonic()) + 1.0)
            self._remaining_tokens = None

    def _read_limits(self, r: httpx.Response) -> None:
        rem = r.headers.get("x-ratelimit-remaining-tokens")
        reset = r.headers.get("x-ratelimit-reset-tokens", "")
        if rem is None:
            return
        self._remaining_tokens = int(rem)
        m = re.fullmatch(r"(?:(d+)m)?(?:([d.]+)s)?", reset)  # 예: "23.64s", "1m5.2s"
        secs = (int(m.group(1) or 0) * 60 + float(m.group(2) or 0)) if m else 30.0
        self._reset_at = time.monotonic() + secs

    def structured(
        self,
        *,
        system: str,
        user: str,
        schema: type[T],
        name: str,
        tag: str = "judge",
        max_completion_tokens: int = 3000,
    ) -> tuple[T, CallInfo]:
        body = {
            "model": self.model,
            "temperature": 0,
            "max_completion_tokens": max_completion_tokens,  # 추론 토큰 포함
            "reasoning_effort": "low",
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": name,
                    "strict": True,
                    "schema": inline_refs(schema.model_json_schema()),
                },
            },
        }
        last_err: Exception | None = None
        total_in = total_out = 0
        started = time.monotonic()
        estimate = int((len(system) + len(user)) * 0.8) + max_completion_tokens
        for attempt in range(6):
            self.tracker.check()
            self._pace(estimate)
            r = httpx.post(URL, headers=self._headers, json=body, timeout=120)
            self._read_limits(r)
            if r.status_code in (429, 500, 502, 503):
                wait = float(r.headers.get("retry-after", 5 * (attempt + 1)))
                time.sleep(min(wait, 90) + 1)
                continue
            if (
                r.status_code == 400 and "json_validate_failed" in r.text
            ):  # 서버 측 JSON 생성 실패 = 형식 오류와 같이 재시도
                last_err = RuntimeError(f"Groq json_validate_failed: {r.text[:200]}")
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"Groq 채점 호출 실패 {r.status_code}: {r.text[:300]}")
            data = r.json()
            u = data["usage"]
            info = CallInfo(
                self.model,
                int((time.monotonic() - started) * 1000),
                u["prompt_tokens"],
                u["completion_tokens"],
                cost_of(self.model, u["prompt_tokens"], u["completion_tokens"]),
            )
            total_in += info.input_tokens
            total_out += info.output_tokens
            self.tracker.record(info, tag)
            try:
                content = data["choices"][0]["message"]["content"]
                parsed = schema.model_validate(json.loads(content))
                return parsed, CallInfo(
                    self.model, info.latency_ms, total_in, total_out, cost_of(self.model, total_in, total_out)
                )
            except (ValidationError, ValueError, KeyError, TypeError) as e:
                last_err = e  # 형식 오류는 재시도 (temperature 0이어도 추론 경로가 달라질 수 있음)
        raise RuntimeError(f"채점 결과 검증 실패(재시도 후): {last_err}")
