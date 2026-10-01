"""Claude(Anthropic SDK) 호출 래퍼 — 구조화 출력(도구 호출 강제) + 비용 기록·실행당 비용 상한.

구조화 출력은 pydantic 모델로 검증하고, 실패하면 1회 재시도한다 (CLAUDE.md의 파이프라인 규칙과 동일).
필드 순서는 모델 정의 순서를 그대로 JSON 스키마에 싣는다 (근거 필드를 판정보다 먼저 두기 위함).
"""

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, TypeVar

import anthropic
from pydantic import BaseModel, ValidationError

from settings import ROOT

T = TypeVar("T", bound=BaseModel)

# 1M 토큰당 (입력, 출력) USD. Claude는 공식 가격표, Groq는 gpt-oss-120b 공개 가격(집계용 추정치)
PRICES: dict[str, tuple[float, float]] = {
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
    "openai/gpt-oss-120b": (0.15, 0.60),
}
# 프롬프트 캐시(5분 TTL) 단가 배수: 쓰기 1.25배, 읽기 0.1배 (공식 문서, 실험 F)
CACHE_WRITE_X, CACHE_READ_X = 1.25, 0.1
LEDGER = ROOT / "agent" / ".cache" / "llm_usage.jsonl"


class CostBudgetExceeded(RuntimeError):
    pass


@dataclass
class CallInfo:
    model: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    cache_write_tokens: int = 0  # input_tokens에 포함되지 않는 캐시 쓰기 토큰
    cache_read_tokens: int = 0  # input_tokens에 포함되지 않는 캐시 읽기 토큰


def cost_of(
    model: str, input_tokens: int, output_tokens: int, cache_write: int = 0, cache_read: int = 0
) -> float:
    pin, pout = PRICES.get(model, (0.0, 0.0))
    cached = cache_write * pin * CACHE_WRITE_X + cache_read * pin * CACHE_READ_X
    return (input_tokens * pin + output_tokens * pout + cached) / 1_000_000


class CostTracker:
    """서비스별 비용 기록(파일 누적) + 이 실행의 상한. 상한을 넘기면 다음 호출 전에 중단한다."""

    def __init__(self, budget_usd: float | None, service: str, ledger: Path = LEDGER):
        self.budget_usd = budget_usd
        self.service = service
        self.ledger = ledger
        self.run_cost = 0.0
        self.run_calls = 0

    def check(self) -> None:
        if self.budget_usd is not None and self.run_cost >= self.budget_usd:
            raise CostBudgetExceeded(
                f"이 실행의 {self.service} 비용 상한(AGENT_COST_BUDGET_USD=${self.budget_usd:.2f})에 도달해 중단합니다. "
                f"이 실행 사용: ${self.run_cost:.4f} ({self.run_calls}회 호출)."
            )

    def record(self, info: CallInfo, tag: str = "") -> None:
        self.run_cost += info.cost_usd
        self.run_calls += 1
        self.ledger.parent.mkdir(parents=True, exist_ok=True)
        with self.ledger.open("a", encoding="utf-8") as f:
            row = {
                "service": self.service,
                "model": info.model,
                "in": info.input_tokens,
                "out": info.output_tokens,
                **(
                    {"cw": info.cache_write_tokens, "cr": info.cache_read_tokens}
                    if info.cache_write_tokens or info.cache_read_tokens
                    else {}
                ),
                "usd": round(info.cost_usd, 6),
                "tag": tag,
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def ledger_totals(ledger: Path = LEDGER) -> dict[str, dict]:
    """서비스별 누적 (호출 수, 입력·출력 토큰, USD)."""
    out: dict[str, dict] = {}
    if not ledger.exists():
        return out
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        r = json.loads(line)
        t = out.setdefault(r["service"], {"calls": 0, "in": 0, "out": 0, "usd": 0.0})
        t["calls"] += 1
        t["in"] += r["in"]
        t["out"] += r["out"]
        t["usd"] += r["usd"]
    return out


class LLM(Protocol):
    model: str

    def structured(
        self,
        *,
        system: str,
        user: str,
        schema: type[T],
        tool_name: str,
        max_tokens: int = 1024,
        tag: str = "",
        cache_prefix: str | None = None,
    ) -> tuple[T, CallInfo]: ...

    def text(
        self, *, system: str, user: str, max_tokens: int = 1024, tag: str = ""
    ) -> tuple[str, CallInfo]: ...


class ClaudeClient:
    def __init__(self, api_key: str, model: str, tracker: CostTracker):
        self.model = model
        self.tracker = tracker
        self._client = anthropic.Anthropic(api_key=api_key, max_retries=2)

    def _info(self, resp, started: float) -> CallInfo:
        u = resp.usage
        cw, cr = u.cache_creation_input_tokens or 0, u.cache_read_input_tokens or 0
        return CallInfo(
            model=self.model,
            latency_ms=int((time.monotonic() - started) * 1000),
            input_tokens=u.input_tokens,
            output_tokens=u.output_tokens,
            cost_usd=cost_of(self.model, u.input_tokens, u.output_tokens, cw, cr),
            cache_write_tokens=cw,
            cache_read_tokens=cr,
        )

    def structured(self, *, system, user, schema, tool_name, max_tokens=1024, tag="", cache_prefix=None):
        """cache_prefix: 시스템 프롬프트 뒤에 붙여 캐시할 고정 문맥(실험 F 전체 컨텍스트). 질문은 user에 둔다."""
        tool = {
            "name": tool_name,
            "description": "결과를 이 도구의 입력으로 제출한다. 필드는 정의된 순서대로 채운다.",
            "input_schema": schema.model_json_schema(),
        }
        if cache_prefix is not None:
            system = [
                {"type": "text", "text": system},
                {"type": "text", "text": cache_prefix, "cache_control": {"type": "ephemeral"}},
            ]
        last_err: Exception | None = None
        total_in = total_out = total_cw = total_cr = 0
        started = time.monotonic()
        for _attempt in range(2):  # 검증 실패 시 1회 재시도
            self.tracker.check()
            resp = self._client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                extra_body={
                    "temperature": 0
                },  # SDK 1.x messages.create에 temperature 인자가 없어 본문으로 전달
                system=system,
                messages=[{"role": "user", "content": user}],
                tools=[tool],
                tool_choice={"type": "tool", "name": tool_name},
            )
            info = self._info(resp, started)
            total_in += info.input_tokens
            total_out += info.output_tokens
            total_cw += info.cache_write_tokens
            total_cr += info.cache_read_tokens
            self.tracker.record(info, tag)
            block = next((b for b in resp.content if b.type == "tool_use"), None)
            try:
                if block is None:
                    raise ValueError("도구 호출 없음")
                parsed = schema.model_validate(block.input)
                total = CallInfo(
                    self.model,
                    info.latency_ms,
                    total_in,
                    total_out,
                    cost_of(self.model, total_in, total_out, total_cw, total_cr),
                    total_cw,
                    total_cr,
                )
                return parsed, total
            except (ValidationError, ValueError) as e:
                last_err = e
        raise RuntimeError(f"구조화 출력 검증 실패(재시도 1회 후): {last_err}")

    def text(self, *, system, user, max_tokens=1024, tag=""):
        self.tracker.check()
        started = time.monotonic()
        resp = self._client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            extra_body={"temperature": 0},  # SDK 1.x messages.create에 temperature 인자가 없어 본문으로 전달
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        info = self._info(resp, started)
        self.tracker.record(info, tag)
        return "".join(b.text for b in resp.content if b.type == "text"), info


HAIKU = "claude-haiku-4-5-20251001"  # Models API로 확인한 Haiku 4.5 (2026-10-01)
AUX_NODES = ("classify", "sufficiency", "rewrite")  # 보조 노드 = 분류·충분성·재작성. 답변 노드는 tag "answer"

# 실험 C 조건: 전 노드 Sonnet(기준) / 답변만 Sonnet·보조 노드 전부 Haiku / 전 노드 Haiku
PRESETS = ("sonnet", "aux-haiku", "haiku")


class RoutedLLM:
    """노드(tag)별로 다른 모델 클라이언트를 고른다 (실험 C). 한 실행의 비용은 공유 CostTracker에 합산된다."""

    def __init__(self, default: "LLM", overrides: dict[str, "LLM"] | None = None):
        self._default = default
        self._overrides = overrides or {}
        self.model = default.model

    def _pick(self, tag: str):
        return self._overrides.get(tag, self._default)

    def structured(self, *, tag: str = "", **kw):
        return self._pick(tag).structured(tag=tag, **kw)

    def text(self, *, tag: str = "", **kw):
        return self._pick(tag).text(tag=tag, **kw)

    def describe(self) -> str:
        parts = {tag: c.model for tag, c in self._overrides.items()}
        return f"기본 {self._default.model}" + (f", 재정의 {parts}" if parts else "")


def make_llm(preset: str, api_key: str, sonnet: str, tracker: CostTracker) -> "RoutedLLM":
    if preset not in PRESETS:
        raise ValueError(f"알 수 없는 프리셋: {preset}")
    son = ClaudeClient(api_key, sonnet, tracker)
    if preset == "sonnet":
        return RoutedLLM(son)
    hai = ClaudeClient(api_key, HAIKU, tracker)
    if preset == "haiku":
        return RoutedLLM(hai)
    return RoutedLLM(son, {tag: hai for tag in AUX_NODES})
