"""채점기 네거티브 테스트 (설계 7-3): 정답 답변에 가짜 사실을 넣으면 환각으로, 정답 사실을 빼면 누락으로 잡는지 확인.

실행: uv run --directory agent python ../eval/judge_selftest.py   (Groq 채점 호출 8회, Claude 호출 없음)
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))

from judge.groq import GroqJudge  # noqa: E402
from judge.tasks import fact_covered, run_accuracy, run_faithfulness  # noqa: E402
from llm.client import CostTracker  # noqa: E402
from settings import get_settings  # noqa: E402

CORRECT = (
    "마감 정산은 포스의 '마감정산' 버튼으로 해요. 현금은 금고의 흰 봉투에 넣어요. "
    "정산 금액과 실제 현금이 1,000원 이상 차이 나면 매장 단톡방에 차액을 올려요."
)
CASES = {
    "A_정답": (CORRECT, "정답 그대로 → 누락 없음·위반 없음이어야 함"),
    "B_가짜사실_추가": (
        CORRECT + " 차액이 5,000원 이상이면 점장님께 전화로 바로 보고해야 해요.",
        "정답 + 원문에 없는 사실 1개 → 근거 충실도 위반으로 잡혀야 함 (누락은 없음)",
    ),
    "C_정답사실_누락": (
        "마감 정산은 포스의 '마감정산' 버튼으로 해요. 정산 금액과 실제 현금이 1,000원 이상 차이 나면 매장 단톡방에 차액을 올려요.",
        "'현금은 금고의 흰 봉투' 조각을 뺌 → 누락으로 잡혀야 함 (위반 없음)",
    ),
    "D_수치변조": (
        CORRECT.replace("1,000원", "3,000원"),
        "차액 기준 1,000원 → 3,000원으로 바꿈 → 누락(수치 불일치)과 환각이 모두 잡혀야 함",
    ),
}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    s = get_settings()
    assert s.groq_api_key, "GROQ_API_KEY 필요"
    tracker = CostTracker(None, "groq")
    judge = GroqJudge(s.groq_api_key, s.judge_model, tracker)

    spec = (ROOT / "data" / "virtual" / "corpus-spec.md").read_text(encoding="utf-8")
    fact_text = re.search(r"^\| C06 \| (.+?) \|", spec, re.M).group(1)
    facts = json.loads((ROOT / "eval" / "fact-spans.json").read_text(encoding="utf-8"))["facts"]["C06"]
    NL = chr(10)

    def u16(rel: str, a: int, b: int) -> str:
        raw = (ROOT / rel).read_bytes().decode("utf-8").encode("utf-16-le")
        return raw[a * 2 : b * 2].decode("utf-16-le")

    doc, tr = facts["document"], facts["transcript"]["spans"][0]
    # 에이전트가 실제로 받는 것과 같은 형태의 근거: 정답 사실이 있는 문서 구간 + 트랜스크립트 구간 (± 여유 문맥)
    evidence = (NL * 2).join(
        f"[청크 {n}]{NL}{u16(r['file'], max(0, r['char_start'] - 120), r['char_end'] + 120)}"
        for n, r in enumerate(
            ({**doc, "file": doc["file"]}, {**tr, "file": facts["transcript"]["file"]}), start=1
        )
    )

    out = {
        "date": date.today().isoformat(),
        "judge_model": s.judge_model,
        "fact": {"C06": fact_text},
        "cases": {},
    }
    for name, (answer, expect) in CASES.items():
        acc, _ = run_accuracy(judge, answer, {"C06": fact_text}, "마감 정산은 어떻게 하나요?")
        hal, _ = run_faithfulness(judge, answer, evidence)
        fc = acc.facts[0]
        unsupported = [c.claim for c in hal.claims if not c.supported]
        out["cases"][name] = {
            "expect": expect,
            "answer": answer,
            "fact_covered": fact_covered(fc),
            "uncovered_parts": [p.part for p in fc.parts if not p.covered],
            "unfaithful": bool(unsupported),
            "unsupported_claims": unsupported,
            "detail": {"accuracy": acc.model_dump(), "unfaithful": hal.model_dump()},
        }
        c = out["cases"][name]
        print(
            f"{name}: 사실 포함={c['fact_covered']} 누락 조각={c['uncovered_parts']} | 근거밖={c['unfaithful']} {unsupported}"
        )
    exp = {
        "A_정답": (True, False),
        "B_가짜사실_추가": (True, True),
        "C_정답사실_누락": (False, False),
        "D_수치변조": (False, True),
    }
    out["passed"] = {k: (v["fact_covered"], v["unfaithful"]) == exp[k] for k, v in out["cases"].items()}

    # 시각 문항: "일정 없음" 부재 진술도 도구 결과와 대조되는지 (2026-10-01 결정)
    tool = (
        "[일정 도구 결과] 현재 시각 06:50\n지금 시작한 일(최근 30분):\n- (없음)\n"
        "곧 있을 일(30분 이내):\n- 07:00 수건 입고·서명"
    )
    time_cases = {
        "E_시각_일정없음_정답": ("지금 시작한 일은 없어요. 곧 07:00에 수건 입고·서명이 있어요.", False),
        "F_시각_일정있는데_없다고함": ("지금 시작한 일도, 30분 안에 예정된 일도 없어요.", True),
        "G_시각_없는데_있다고함": ("지금 06:40에 시작한 음료 냉장고 채우기를 하고 계시면 돼요.", True),
    }
    out["time_cases"] = {}
    for name, (answer, expect_unfaithful) in time_cases.items():
        fai, _ = run_faithfulness(judge, answer, tool, "tasks")
        bad = [c.claim for c in fai.claims if not c.supported]
        out["time_cases"][name] = {
            "answer": answer,
            "expect_unfaithful": expect_unfaithful,
            "unfaithful": bool(bad),
            "unsupported_claims": bad,
            "ok": bool(bad) == expect_unfaithful,
        }
        print(
            f"{name}: 근거밖={bool(bad)} {bad} → 기대 {expect_unfaithful} {'OK' if bool(bad) == expect_unfaithful else 'FAIL'}"
        )
    out["cost_usd"] = round(tracker.run_cost, 6)
    print("기대와 일치:", out["passed"], "| 채점 호출", tracker.run_calls, "회, $", out["cost_usd"])
    path = ROOT / "eval" / "results" / f"{date.today().isoformat()}-judge-selftest.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
