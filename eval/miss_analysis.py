"""답변 누락 분석 (API 0회): 기준선에서 검색은 적중했는데 답변에서 빠진 정답 사실과 근거 충실도 위반 문장을 유형별로 분류한다.

입력: eval/results/2026-09-30-baseline.json (기준선 2회, 문항별 기록·채점)
출력: eval/results/2026-10-01-miss-analysis.{md,json}

분류는 규칙으로 1차 분류하고, 규칙이 못 잡거나 채점 모델 판정이 의심스러운 건은 MANUAL 표에서 사람이 읽고 보정한 값이다
(전 건을 직접 읽고 확인했다). 골든셋 문항 자체를 프롬프트 예시로 쓰지 않는다 — 이 분석은 유형(일반 원칙)만 다음 단계로 넘긴다.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "eval" / "results" / "2026-09-30-baseline.json"

TYPES = {
    "irrelevant": "기타 — 질문과 무관한 조각 (엄격 정의의 산물, 답변 결함 아님)",
    "premise": "일부 조각만 답함 — 전제·주체 조각 (언제 적용되는지·누가 하는지)",
    "detail": "근거에 있는데 요약하며 생략 — 세부 수치·시각·절차 단계",
    "transcript_only": "트랜스크립트 청크만 인용 (문서 청크 인용 없음)",
    "other": "기타",
}
FAITH_TYPES = {
    "inference": "상황 가정·추론 — 사용자 상황을 가정해 규칙을 적용한 결론을 덧붙임",
    "common_sense": "상식·조언 덧붙이기 — 근거에 없는 행동 지시",
    "judge_edge": "채점 경계 — 근거에 사실상 있음(표현 확장), 채점 오탐 가능",
}
TRIGGER = re.compile(r"(때|하면|경우|사람이|퇴근자가|박스마다|들어오면|뜨면)")

# (실행 번호, 문항, 사실) → (유형, 메모): 규칙 결과를 읽고 보정한 항목
MANUAL: dict[tuple[int, str, str], tuple[str, str]] = {
    (1, "T05", "L05"): (
        "transcript_only",
        "도구 근거로 받은 청크가 트랜스크립트 하나뿐이고 인용도 그것뿐. 03:00 휴식도 생략",
    ),
    (2, "T02", "B04"): (
        "detail",
        "'20:30부터'(시작 시각)를 생략. 답변은 스티커 작업은 정확히 말했으므로 채점 경계 가능",
    ),
    (1, "T04", "G04"): ("detail", "07:00 수건 입고는 말했지만 수량 확인·납품서 서명을 생략"),
    (1, "F19", "C10"): ("premise", "'마지막 퇴근자가 경비를 설정한다'(주체) 조각 생략. 카드키·30초는 답함"),
}
FAITH_MANUAL: dict[str, str] = {
    "F02": "inference",
    "F05": "inference",
    "F13": "common_sense",
    "F16": "common_sense",
    "F12": "judge_edge",
}


def bigrams(text: str) -> set[str]:
    t = "".join(c for c in text if c.isalnum())
    return {t[i : i + 2] for i in range(len(t) - 1)}


def classify(run: int, qid: str, fid: str, fc: dict, rec: dict) -> tuple[str, str]:
    if (run, qid, fid) in MANUAL:
        return MANUAL[(run, qid, fid)]
    unc = [p for p in fc["parts"] if not p["covered"]]
    cov = [p for p in fc["parts"] if p["covered"]]
    if all(not p["relevant_to_question"] for p in unc):
        return "irrelevant", "빠진 조각이 질문이 묻는 내용과 무관 — 정답을 해도 주 지표에서는 누락으로 셈"
    cited = {c["source_type"] for c in rec["citations"]}
    if cited == {"transcript"}:
        return "transcript_only", "문서 청크 인용 없음"
    if cov and any(TRIGGER.search(p["part"]) for p in unc if p["relevant_to_question"]):
        return "premise", "질문에 이미 나온 상황이라도 규칙의 적용 조건·주체 조각을 답변이 다시 밝히지 않음"
    if cov:
        return "detail", "주제는 답했지만 근거의 세부(수치·시각·절차)를 생략"
    return "other", "답변에 관련 조각이 전혀 없음"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    d = json.loads(BASELINE.read_text(encoding="utf-8"))
    gold = {
        q["id"]: q
        for q in (
            json.loads(x) for x in (ROOT / "eval" / "golden.jsonl").read_text(encoding="utf-8").splitlines()
        )
    }
    rows, faith = [], []
    for run in (0, 1):
        for r in d["runs"][run]:
            qid, ev, rec = r["id"], r["eval"], r["record"]
            q = gold[qid]
            if q["type"] in ("fact", "time"):
                hit = ev.get("retrieval_final") if q["type"] == "fact" else ev.get("tool_evidence_hit")
                for fid, covered in ev["fact_covered"].items():
                    if covered or not hit.get(fid):
                        continue
                    fc = next(x for x in ev["accuracy_detail"]["facts"] if x["fact_id"] == fid)
                    typ, note = classify(run + 1, qid, fid, fc, rec)
                    rows.append(
                        {
                            "run": run + 1,
                            "id": qid,
                            "kind": q["type"],
                            "fact": fid,
                            "type": typ,
                            "note": note,
                            "uncovered": [p["part"] for p in fc["parts"] if not p["covered"]],
                            "covered": [p["part"] for p in fc["parts"] if p["covered"]],
                            "uncovered_relevant": [
                                p["part"]
                                for p in fc["parts"]
                                if not p["covered"] and p["relevant_to_question"]
                            ],
                            "judge_quote_nonempty": any(
                                p["answer_quote"] and not p["covered"] for p in fc["parts"]
                            ),
                        }
                    )
            if ev.get("unfaithful"):
                for claim in ev["unsupported_claims"]:
                    faith.append(
                        {"run": run + 1, "id": qid, "claim": claim, "type": FAITH_MANUAL.get(qid, "other")}
                    )

    by_type = Counter(r["type"] for r in rows)
    relevant_only = [r for r in rows if r["type"] != "irrelevant"]
    result = {
        "missed_with_retrieval_hit": rows,
        "by_type": dict(by_type),
        "faithfulness_violations": faith,
        "faithfulness_by_type": dict(Counter(f["type"] for f in faith)),
    }
    (ROOT / "eval" / "results" / "2026-10-01-miss-analysis.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    L = [
        "# 답변 누락·근거 충실도 위반 분석 (기준선 2회, API 0회)",
        "",
        "- 대상: **검색은 적중(사실 문항: Recall 적중, 시각 문항: 도구 근거 적중)했는데 답변에서 빠진** 정답 사실. 정의는 골든셋 정의(정답 사실 전체 포함)",
        "- 1차 분류는 규칙(빠진 조각이 질문과 무관한가 / 문서 인용 없는가 / 다른 조각은 답했는가 + 전제 조각 표현), 4건은 읽고 보정",
        "- 이 분석은 유형(일반 원칙)만 다음 단계(답변 프롬프트)로 넘긴다. 골든셋 문항·문구는 프롬프트에 쓰지 않는다",
        "",
        f"## 누락 {len(rows)}건 (2회 합산) — 유형별",
        "",
        "| 유형 | 건수 |",
        "|---|---|",
    ]
    L += [f"| {TYPES[k]} | {by_type.get(k, 0)} |" for k in TYPES]
    L += [
        "",
        f"- 질문과 무관한 조각만 빠진 {by_type.get('irrelevant', 0)}건은 답변 결함이 아니라 엄격한 정의의 산물이다. 실제로 답변이 놓친 것은 {len(relevant_only)}건.",
        "",
        "## 누락 목록",
        "",
        "| 실행 | 문항 | 사실 | 유형 | 빠진 조각(질문 관련 여부 표시) | 메모 |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        miss = "; ".join(("★" if p in r["uncovered_relevant"] else "") + p[:40] for p in r["uncovered"])
        L.append(
            f"| {r['run']} | {r['id']} | {r['fact']} | {TYPES[r['type']].split(' — ')[0]} | {miss} | {r['note']} |"
        )
    L += [
        "",
        "★ = 질문이 묻는 내용에 필요한 조각",
        "",
        "## 근거 충실도 위반 문장 유형",
        "",
        "| 실행 | 문항 | 문장 | 유형 |",
        "|---|---|---|---|",
    ]
    L += [
        f"| {f['run']} | {f['id']} | {f['claim']} | {FAITH_TYPES.get(f['type'], f['type']).split(' — ')[0]} |"
        for f in faith
    ]
    L += ["", "| 유형 | 건수 |", "|---|---|"] + [
        f"| {FAITH_TYPES[k]} | {v} |" for k, v in result["faithfulness_by_type"].items()
    ]
    L += [
        "",
        "## 다음 단계로 넘기는 일반 원칙 (실험 D' 프롬프트 방향)",
        "",
        "1. 요약 생략(세부 수치·시각·절차 단계) — 근거에 있는 시각·수량·장소·보고 대상은 줄이지 말고 그대로 적는다.",
        "2. 전제·주체 조각 — 규칙이 '언제 적용되는지·누가 하는지'를 정하고 있으면 그 조건·주체를 한 문장으로 먼저 밝힌다(질문에 이미 나온 상황이라도).",
        "3. 근거에 없는 조언·상식·상황 가정 추가 금지 — 근거의 규칙을 사용자 상황에 적용한 결론을 새로 만들지 않는다(적용 판단이 필요하면 근거 문장을 그대로 인용하고 판단은 사용자에게 맡긴다).",
        "4. 질문과 무관한 세부는 굳이 덧붙이지 않는다 — 무관 조각이 빠져서 생기는 누락은 프롬프트로 고치지 않는다(오히려 답변이 산만해짐).",
        "5. 문서 청크를 먼저 확인하고, 트랜스크립트만 근거일 때도 그 사실이 문서에 있는지 다른 근거를 확인한다.",
    ]
    (ROOT / "eval" / "results" / "2026-10-01-miss-analysis.md").write_text(
        "\n".join(L) + "\n", encoding="utf-8"
    )
    print("\n".join(L[:22]))


if __name__ == "__main__":
    main()
