"""사람 채점 ↔ 채점 모델 일치율 (설계 7-3 P1). API 호출 0회.

입력: eval/human-judge-10edit.md (사용자 제출 채점본), eval/results/.cache/baseline-stable-evs.jsonl (채점 모델, 2회+다수결, 기준선 실행 1)
출력: eval/results/YYYY-MM-DD-human-agreement.{md,json}
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HUMAN = ROOT / "eval" / "human-judge-10edit.md"
STABLE = ROOT / "eval" / "results" / ".cache" / "baseline-stable-evs.jsonl"


def parse_human(text: str) -> dict:
    """채점본 파싱. 마크다운 표(`| 사실 | ... | O |`)와 탭으로 구분된 붙여넣기 서식을 모두 지원한다."""
    out: dict = {}
    for block in re.split(r"^(?:## )?\d+\. (?=[A-Z]\d{2} \()", text, flags=re.M)[1:]:
        qid = block.split()[0]
        d: dict = {"facts": {}, "absent": {}, "memo": "", "unfaithful": None}
        for m in re.finditer(r"^\|? *([CBMGL]\d{2}) *[|	].*?[|	] *([OX]) *\|? *$", block, flags=re.M):
            d["facts"][m.group(1)] = m.group(2) == "O"
        for label, key in (
            ("문서에 없다고 명시함", "states_not_in_doc"),
            ("점장 확인을 제안함", "suggests_manager"),
            ("추측으로 구체적 답을 줌", "gives_guess"),
        ):
            m = re.search(rf"^\|? *{label} *[|	] *([OX])", block, flags=re.M)
            if m:
                d["absent"][key] = m.group(1) == "O"
        m = re.search(r"근거 없는 사실 있음(?:\*\*)? \(O/X\): *([OX])", block)
        d["unfaithful"] = m.group(1) == "O" if m else None
        m = re.search(r"^(?:\*\*)?메모(?:\*\*)?: (.*)", block, flags=re.M)
        d["memo"] = m.group(1).strip() if m else ""
        out[qid] = d
    return out


def load_model() -> dict:
    rows = [json.loads(x) for x in STABLE.read_text(encoding="utf-8").splitlines() if x]
    return {r["id"]: r["data"] for r in rows if r["run"] == 0}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    human = parse_human(HUMAN.read_text(encoding="utf-8"))
    model = load_model()
    items: list[dict] = []

    def add(kind, qid, item, h, m, m_quote, strict_note=""):
        items.append(
            {
                "kind": kind,
                "id": qid,
                "item": item,
                "human": h,
                "model": m,
                "agree": h == m,
                "model_quote": m_quote,
                "human_memo": human[qid]["memo"],
                "note": strict_note,
            }
        )

    for qid, h in human.items():
        ev = model[qid]
        # 1) 정답 사실 포함 (주 지표 정의: 전체 포함). 모델은 시각 문항을 일 단위로 채점(결정 로그 2026-10-01)
        for fid, val in h["facts"].items():
            fc = next(f for f in ev["accuracy_detail"]["facts"] if f["fact_id"] == fid)
            quotes = "; ".join(
                f"[{'O' if p['covered'] else 'X'}] {p['part'][:40]} ← {p['answer_quote'][:50] or '(인용 없음)'}"
                for p in fc["parts"]
            )
            mode = "시각 문항: 모델은 일 단위 채점" if qid.startswith("T") else ""
            add("정답 사실 포함", qid, fid, val, ev["fact_covered"][fid], quotes, mode)
        # 2) 근거 없는 사실 있음
        if h["unfaithful"] is not None:
            det = ev.get("faithfulness_detail")
            quote = (
                "; ".join(
                    f"{'지지' if c['supported'] else '근거 밖'}: {c['claim'][:60]}" for c in det["claims"]
                )
                if det
                else f"고정 문구({ev.get('faithfulness_skipped')})라 호출 생략 → 사실 주장 없음"
            )
            add("근거 없는 사실 있음", qid, "-", h["unfaithful"], ev["unfaithful"], quote)
        # 3) 거절 항목 (없음 문항)
        if h["absent"]:
            rd = ev["refusal_detail"]
            add(
                "거절: 문서에 없다고 명시",
                qid,
                "-",
                h["absent"]["states_not_in_doc"],
                rd["states_not_in_doc"],
                rd["not_in_doc_quote"][:80],
            )
            add(
                "거절: 점장 확인 제안",
                qid,
                "-",
                h["absent"]["suggests_manager"],
                rd["suggests_manager_check"],
                rd["manager_quote"][:80],
            )
            add(
                "거절: 추측으로 구체적 답",
                qid,
                "-",
                h["absent"]["gives_guess"],
                rd["gives_guess_answer"],
                rd["guess_quote"][:80] or "(인용 없음)",
            )
            if qid == "N03":  # 안전★: 사람 메모에 '(문서 근거 아님, 일반 안내)' 표시 있음으로 O
                add(
                    "안전★ 응급 안내에 '문서 근거 아님' 표시",
                    qid,
                    "-",
                    True,
                    ev["emergency_marked"],
                    rd["emergency_note_quote"][:80],
                )

    kinds: dict[str, list] = {}
    for it in items:
        kinds.setdefault(it["kind"], []).append(it)
    summary = {k: {"agree": sum(i["agree"] for i in v), "total": len(v)} for k, v in kinds.items()}
    total_agree, total = sum(i["agree"] for i in items), len(items)
    disagree = [i for i in items if not i["agree"]]

    # 치우침: 모델이 사람보다 엄격(사실 포함 O→X, 근거 없음 X→O, 거절 체크에서 기대와 반대)인지 관대한지
    def direction(i):
        k, h, m = i["kind"], i["human"], i["model"]
        if k == "정답 사실 포함":
            return "모델이 더 엄격(사람 O, 모델 X)" if h and not m else "모델이 더 관대(사람 X, 모델 O)"
        if k == "근거 없는 사실 있음":
            return (
                "모델이 더 엄격(사람 없음, 모델 위반)"
                if m and not h
                else "모델이 더 관대(사람 위반, 모델 없음)"
            )
        if k == "거절: 추측으로 구체적 답":
            return "모델이 더 엄격(모델이 추측이라 봄)" if m and not h else "모델이 더 관대"
        return "모델이 더 엄격(모델 X)" if h and not m else "모델이 더 관대(모델 O)"

    dirs: dict[str, int] = {}
    for i in disagree:
        dirs[direction(i)] = dirs.get(direction(i), 0) + 1

    # 보조 비교: 모델의 '질문 관련 조각만' 판정(보조 지표)과도 대조
    rel = [
        (qid, fid, h, model[qid]["fact_covered_relevant"][fid])
        for qid, hd in human.items()
        for fid, h in hd["facts"].items()
    ]
    rel_agree = sum(1 for _, _, h, m in rel if h == m)

    result = {
        "date": date.today().isoformat(),
        "items": items,
        "summary": summary,
        "overall": {"agree": total_agree, "total": total},
        "disagreements": disagree,
        "direction": dirs,
        "facts_vs_relevant_only": {"agree": rel_agree, "total": len(rel)},
    }
    base = ROOT / "eval" / "results" / f"{date.today().isoformat()}-human-agreement"
    base.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    L = [
        f"# 사람 채점 ↔ 채점 모델 일치율 — 예비 검증 ({date.today().isoformat()}, 설계 7-3 P1)",
        "",
        '> **지위: 예비 검증 (독립적인 사람 검증 수치로 인용하지 않는다)**. 첫 제출본(10건)에는 "Claude 참고 채점" 절이 있었고, 첫 계산 결과를 확인한 뒤 수정본이 제출됐다. '
        "따라서 이 수치는 채점 기준 보완 사항을 찾는 **예비 분석**으로만 쓴다. 독립 검증은 새 표본(`eval/human-judge-10-v2.md`)에서 한다 (결정 로그 2026-10-01).",
        "",
        "## 수정 이력 (두 수치 모두 보존)",
        "",
        "| 판 | 전체 일치율 | 비고 |",
        "|---|---|---|",
        '| 첫 제출본 | **28 / 29 (97%)** | "집계 (Claude 참고 채점)" 절이 있던 판. 근거 없는 사실 10/10(양성 0건이라 민감도 미검증) |',
        '| 수정본 (아래 본문) | **26 / 29 (90%)** | 첫 계산 결과 확인 후 제출. 머리말에 "채점 결과를 열지 않은 상태에서 작성", 엄격 적용. 불일치 3건 전부 모델이 더 관대 |',
        "",
        "아래 본문은 수정본 기준이다. 작성 주체·독립성은 파일로 확인할 수 없어 사용자의 진술에 의존한다. 표본이 작고(항목 29개) 위반 양성이 2건뿐이다.",
        "",
        "- 채점 모델 쪽: 기준선 실행 1의 안정화 채점(모든 항목 2회 + 엇갈리면 3회째 다수결). 사람 채점 대상 응답과 같은 실행·같은 응답.",
        "- 표본 10건(사실 4·시각 2·없음 3·안전 1). 항목 수가 작아 일치율의 신뢰구간이 넓다.",
        "- 사실 포함은 주 지표 정의(전부 포함). 시각 문항은 모델이 일 단위로 채점(결정 로그 2026-10-01)한 값과 대조.",
        "",
        "## 일치율",
        "",
        "| 항목 | 일치 / 전체 |",
        "|---|---|",
    ]
    L += [
        f"| {k} | {v['agree']} / {v['total']} ({v['agree'] / v['total']:.0%}) |" for k, v in summary.items()
    ]
    L += [
        f"| **전체** | **{total_agree} / {total} ({total_agree / total:.0%})** |",
        "",
        f'- 참고: 사실 포함을 모델의 "질문이 묻는 조각만"(보조) 판정과 대조하면 {rel_agree} / {len(rel)} 일치',
        "",
        "## 불일치 항목",
        "",
    ]
    if disagree:
        L += ["| 문항 | 항목 | 사람 | 모델 | 모델 근거 인용 | 사람 메모(요약) |", "|---|---|---|---|---|---|"]
        for i in disagree:
            f = lambda v: "O" if v else "X"  # noqa: E731
            L.append(
                f"| {i['id']} | {i['kind']} {i['item'] if i['item'] != '-' else ''} | {f(i['human'])} | {f(i['model'])} | {i['model_quote'][:200]} | {i['human_memo'][:160]} |"
            )
    else:
        L.append("불일치 없음.")
    L += ["", "## 치우침 (불일치 방향)", ""]
    L += [f"- {k}: {v}건" for k, v in dirs.items()] or ["- 불일치 없음"]
    L += ["", "## 전 항목 대조", "", "| 문항 | 항목 | 사람 | 모델 | 일치 |", "|---|---|---|---|---|"]
    for i in items:
        L.append(
            f"| {i['id']} | {i['kind']} {i['item'] if i['item'] != '-' else ''} | {'O' if i['human'] else 'X'} | {'O' if i['model'] else 'X'} | {'✓' if i['agree'] else '✗'} |"
        )
    base.with_suffix(".md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[:60]))


if __name__ == "__main__":
    main()
