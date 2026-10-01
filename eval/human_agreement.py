"""사람 채점 ↔ 채점 모델 일치율 (설계 7-3 P1). API 호출 0회.

v1(예비 검증): eval/human-judge-10edit.md ↔ eval/results/.cache/baseline-stable-evs.jsonl (2회+다수결, 기준선 실행 1)
  → eval/results/YYYY-MM-DD-human-agreement.{md,json}
v2(독립 검증, --v2): eval/human-judge-10-v2.md ↔ eval/results/.cache/human-judge-10-v2.model.json
  (보완 기준 criteria v2, 2회+다수결, 기준선 실행 1 — human_sample_v2.py --model) → ...-human-agreement-v2.{md,json}
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HUMAN = ROOT / "eval" / "human-judge-10edit.md"
STABLE = ROOT / "eval" / "results" / ".cache" / "baseline-stable-evs.jsonl"
HUMAN_V2 = ROOT / "eval" / "human-judge-10-v2.md"
MODEL_V2 = ROOT / "eval" / "results" / ".cache" / "human-judge-10-v2.model.json"


def parse_human(text: str, x_means_ok: bool = False) -> dict:
    """채점본 파싱. 마크다운 표(`| 사실 | ... | 포함 |`)와 탭으로 구분된 붙여넣기 서식을 모두 지원한다.

    칸 표기: 단어(포함/미포함, 있음/없음 — 2026-10-02 이후 양식) 또는 이전 양식의 O/X(대소문자 구분 없음).
    x_means_ok: 제출자가 x를 "고칠 부분 없음(문제없음)"으로 쓴 경우의 읽는 규칙(v2 제출본, 확정 2026-10-02).
    x → 그 항목의 문제없는 값(사실 포함=예, 근거 없는 사실=아니오, 문서에 없다고 명시=예, 점장 확인 제안=예, 추측 답=아니오), o → 반대.
    단어 표기에는 적용하지 않는다(단어는 뜻이 하나).
    """
    words = {"포함": True, "미포함": False, "있음": True, "없음": False}
    mark = r"(O|X|미포함|포함|있음|없음)"

    def yes(m: str, ok_value: bool) -> bool:
        if m in words:
            return words[m]
        if not x_means_ok:
            return m.upper() == "O"
        return ok_value if m.upper() == "X" else not ok_value

    out: dict = {}
    for block in re.split(r"^(?:## )?\d+\. (?=[A-Z]\d{2} \()", text, flags=re.M)[1:]:
        qid = block.split()[0]
        d: dict = {"facts": {}, "absent": {}, "memo": "", "unfaithful": None}
        for m in re.finditer(
            rf"^\|? *([CBMGL]\d{{2}}) *[|	].*?[|	] *{mark} *\|? *$", block, flags=re.M | re.I
        ):
            d["facts"][m.group(1)] = yes(m.group(2), True)
        for label, key, ok_value in (  # (이전 양식 | 단어 양식) 항목 이름
            ("문서에 없다고 명시함|문서에 없다는 명시", "states_not_in_doc", True),
            ("점장 확인을 제안함|점장 확인 제안", "suggests_manager", True),
            ("추측으로 구체적 답을 줌|추측으로 준 구체적 답", "gives_guess", False),
        ):
            m = re.search(rf"^\|? *(?:{label}) *[|	] *{mark}", block, flags=re.M | re.I)
            if m:
                d["absent"][key] = yes(m.group(1), ok_value)
        m = re.search(rf"근거 없는 사실(?: 있음)?(?:\*\*)? \((?:O/X|있음/없음)\): *{mark}", block, flags=re.I)
        d["unfaithful"] = yes(m.group(1), False) if m else None
        m = re.search(r"^(?:\*\*)?메모(?:\*\*)?: (.*)", block, flags=re.M)
        d["memo"] = m.group(1).strip() if m else ""
        out[qid] = d
    return out


def load_model(v2: bool = False) -> dict:
    if v2:
        return json.loads(MODEL_V2.read_text(encoding="utf-8"))["model_verdicts"]
    rows = [json.loads(x) for x in STABLE.read_text(encoding="utf-8").splitlines() if x]
    return {r["id"]: r["data"] for r in rows if r["run"] == 0}


def sens_spec(items: list[dict]) -> dict:
    """근거 없는 사실: 사람 판정을 기준으로 채점 모델의 민감도(사람 양성 중 모델 양성)·특이도(사람 음성 중 모델 음성)."""
    u = [i for i in items if i["kind"] == "근거 없는 사실 있음"]
    pos = [i for i in u if i["human"]]
    neg = [i for i in u if not i["human"]]
    return {
        "positives": len(pos),
        "negatives": len(neg),
        "sensitivity": [sum(i["model"] for i in pos), len(pos)],
        "specificity": [sum(not i["model"] for i in neg), len(neg)],
    }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--v2", action="store_true", help="독립 검증 표본 v2 (보완 기준 채점 모델 결과와 대조)")
    ap.add_argument(
        "--x-means-ok",
        action="store_true",
        help='제출본의 x를 "고칠 부분 없음(문제없음)"으로 읽는다 (v2, 사용자 확인)',
    )
    args = ap.parse_args()
    text = (HUMAN_V2 if args.v2 else HUMAN).read_text(encoding="utf-8")
    human = parse_human(text, args.x_means_ok)
    model = load_model(args.v2)
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

    ss = sens_spec(items)
    result = {
        "date": date.today().isoformat(),
        "sample": "v2" if args.v2 else "v1",
        "reading_rule": "x = 고칠 부분 없음(문제없음)"
        if args.x_means_ok
        else "적힌 그대로 (O = 예, X = 아니오)",
        "sensitivity_specificity_unfaithful": ss,
        "items": items,
        "summary": summary,
        "overall": {"agree": total_agree, "total": total},
        "disagreements": disagree,
        "direction": dirs,
        "facts_vs_relevant_only": {"agree": rel_agree, "total": len(rel)},
    }
    base = (
        ROOT
        / "eval"
        / "results"
        / f"{date.today().isoformat()}-human-agreement{'-v2' if args.v2 else ''}{'-literal' if args.v2 and not args.x_means_ok else ''}"
    )
    base.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    L = (
        v2_header(ss, total, human, args.x_means_ok)
        if args.v2
        else [
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
    )
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


def v2_header(ss: dict, total: int, human: dict, x_means_ok: bool) -> list[str]:
    def frac(x: list[int]) -> str:
        return f"{x[0]} / {x[1]} ({x[0] / x[1]:.0%})" if x[1] else "해당 없음 (0건)"

    facts = sum(len(h["facts"]) for h in human.values())
    return [
        f"# 사람 채점 ↔ 채점 모델 일치율 — v2 독립 검증 ({date.today().isoformat()}, 설계 7-3 P1)",
        "",
        "- 사람: `eval/human-judge-10-v2.md` (사용자 본인 작성·확정, 채점 결과 미열람·AI 도움 없음은 사용자 진술). 기존 예비 검증(v1) 10건과 겹치지 않는 새 표본(시드 20261002, 사실 4·시각 2·없음 3·안전 1)",
        "- 채점 모델: openai/gpt-oss-120b, 보완 기준(criteria v2), 정확도·근거 충실도는 2회 + 엇갈리면 3회째 다수결(거절 항목은 안정화 채점 재사용, 기준 변경 없음). 기준선 실행 1의 같은 응답",
        "- 사실 포함은 주 지표 정의(전부 포함, 조건·주체 요소 포함). 시각 문항은 일 단위 + 조건·주체 요소",
        *(
            [
                '- **읽는 규칙 (확정: 이성민, 2026-10-02)**: 제출본은 칸 대부분이 소문자 x이고 섹션 머리에 o가 있다. 사용자가 채점 시 **x를 모든 칸에서 일관되게 "문제없음(고칠 부분 없음)"의 의미로 사용했음을 확인** → x를 각 항목의 문제없는 값으로 읽는다(정답 사실 = 포함, 근거 없는 사실 = 없음, 문서에 없다는 명시 = 있음, 점장 확인 제안 = 있음, 추측으로 준 구체적 답 = 없음). 제출본 파일은 수정하지 않았다',
                '- **경위**: 이 의미 확인은 **일치율 계산 이후**에 이루어졌다(적힌 그대로 계산한 18/31을 본 뒤 사용자에게 확인). 원인은 **양식 설계 결함** — 칸마다 O/X의 뜻이 반대였다(정답 사실 포함 칸의 X = 빠짐, 근거 없는 사실 칸의 X = 없음). 문자 그대로 읽은 18/31은 참고용으로 `…-human-agreement-v2-literal.md`에 보존한다. 이후 사람 채점 양식은 O/X 대신 "포함/미포함", "있음/없음" 단어로 표기한다',
            ]
            if x_means_ok
            else [
                "- **읽는 규칙: 적힌 그대로(O = 예, X = 아니오) — 참고용.** 공식 계산은 x = 고칠 부분 없음(문제없음) 규칙(`--x-means-ok`, `…-human-agreement-v2.md`)을 쓴다"
            ]
        ),
        f"- **표본 한계**: 항목 {total}개(정답 사실 {facts} · 근거 없는 사실 {ss['positives'] + ss['negatives']} · 거절 체크), 근거 없는 사실 **사람 양성 {ss['positives']}건** — 신뢰구간이 넓고, 양성이 적으면 민감도는 사실상 검증되지 않는다",
        *(
            [
                "- **해석 한계**: 근거 없는 사실 탐지 **민감도는 검증되지 않았다**(v2 사람 지적 양성 0건, v1 0/2). 정답 사실 포함에서는 **모델이 사람보다 엄격**하다(불일치 4건 모두) → 이 채점 모델로 보고한 답변 정확도는 **하한 추정**일 가능성이 있다"
            ]
            if x_means_ok
            else []
        ),
        "",
        "## 근거 없는 사실: 민감도·특이도 (사람 판정 기준)",
        "",
        f"- 민감도(사람 양성 중 모델도 양성): {frac(ss['sensitivity'])}",
        f"- 특이도(사람 음성 중 모델도 음성): {frac(ss['specificity'])}",
        "",
        "## 일치율",
        "",
        "| 항목 | 일치 / 전체 |",
        "|---|---|",
    ]


if __name__ == "__main__":
    main()
