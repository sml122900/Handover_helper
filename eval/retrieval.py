"""벡터 검색 기준선 — 골든셋 fact·time 25문항의 Recall@5 (청킹 3종 × 매장 필터 켬/끔 = 6조건).

실행: npm run agent:retrieval   (= uv run --project agent python eval/retrieval.py)
적중 판정은 청크 ID가 아니라 fact-spans.json 의 정답 사실 원문 구간과 상위 5개 청크의 원문 위치가 겹치는지로 한다.
결과: eval/results/YYYY-MM-DD-retrieval.json + .md (임베딩은 agent/.cache 디스크 캐시 재사용)
"""

import argparse
import json
import sys
from collections import Counter
from datetime import date
from itertools import combinations
from math import comb
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))

from embedding import get_embedder  # noqa: E402
from embedding.base import BudgetExceeded  # noqa: E402
from indexing.chunkers import TRANSCRIPT_STRATEGY  # noqa: E402
from indexing.corpus import STORES, build_chunks, load_sources  # noqa: E402
from indexing.store import MemoryStore  # noqa: E402
from indexing.types import STRATEGIES  # noqa: E402
from privacy.mask import mask_text  # noqa: E402
from settings import get_settings  # noqa: E402

K = 5


def load_golden() -> list[dict]:
    rows = [
        json.loads(line) for line in (ROOT / "eval" / "golden.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    return [q for q in rows if q["type"] in ("fact", "time")]


def load_spans() -> dict[str, list[tuple[str, int, int]]]:
    """사실 ID → 정답 원문 구간 목록 (문서 구간 + 트랜스크립트의 재언급 포함 모든 구간)."""
    facts = json.loads((ROOT / "eval" / "fact-spans.json").read_text(encoding="utf-8"))["facts"]
    out: dict[str, list[tuple[str, int, int]]] = {}
    for fid, f in facts.items():
        spans = []
        doc, tr = f["document"], f["transcript"]
        if doc.get("char_start") is not None:
            spans.append((doc["file"], doc["char_start"], doc["char_end"]))
        if tr.get("char_start") is not None:
            spans.append((tr["file"], tr["char_start"], tr["char_end"]))
        spans += [(tr["file"], s["char_start"], s["char_end"]) for s in tr.get("spans", [])]
        out[fid] = spans
    return out


def overlaps(chunk, spans: list[tuple[str, int, int]]) -> bool:
    r = chunk.raw
    return any(r.source_file == f and r.char_start < e and s < r.char_end for f, s, e in spans)


def p_miss_all(n_pool: int, n_bad: int) -> float:
    """무작위 5개(비복원)가 n_bad개의 특정 청크를 하나도 못 뽑을 확률."""
    return comb(n_pool - n_bad, K) / comb(n_pool, K) if n_pool - n_bad >= K else 0.0


def random_baseline(pool_hit_sets: list[set[int]], n_pool: int) -> tuple[float, float]:
    """(사실 적중 기대값 — 사실별 확률, 문항 완전 적중 확률 — 포함·배제 정확 계산). 시드·반복 없이 해석적으로 구한다."""
    per_fact = [1 - p_miss_all(n_pool, len(h)) for h in pool_hit_sets]
    full = 0.0
    for r in range(len(pool_hit_sets) + 1):
        for sub in combinations(pool_hit_sets, r):
            union = set().union(*sub) if sub else set()
            full += (-1) ** r * p_miss_all(n_pool, len(union))
    # r=0 항은 P(아무 제약 없음)=1, 나머지는 '해당 사실들이 모두 미적중'인 확률의 포함·배제
    return sum(per_fact), full


def run(out_path: Path | None = None) -> dict:
    settings = get_settings()
    embedder = get_embedder(settings)
    sources = load_sources()
    chunks = build_chunks(sources, embedder.model)
    masked = [c.to_masked() for c in chunks]  # 색인은 마스킹 후 청크만 받는다
    vectors = embedder.embed([m.embed_text for m in masked], "document")
    store = MemoryStore()
    store.add(masked, vectors)

    golden = load_golden()
    qvecs = embedder.embed([mask_text(q["question"]) for q in golden], "query")
    spans = load_spans()

    counts = {
        s: {
            st: sum(1 for c in chunks if c.store_id == st and c.chunking_strategy in (s, TRANSCRIPT_STRATEGY))
            for st in STORES
        }
        for s in STRATEGIES
    }

    conditions = []
    for strategy in STRATEGIES:
        for use_filter in (True, False):
            n_facts = hit_facts = full_hits = 0
            rnd_facts = rnd_full = 0.0
            other_store = q_other = q_confusable = 0
            per_q = []
            for q, qv in zip(golden, qvecs, strict=True):
                store_id = q["store"].lower()
                hits = store.search(qv, K, strategy, store_id if use_filter else None)
                pool = store.pool(strategy, store_id if use_filter else None)
                fact_hit = {f: any(overlaps(h.chunk, spans[f]) for h in hits) for f in q["expected_facts"]}
                n_facts += len(fact_hit)
                hit_facts += sum(fact_hit.values())
                full_hits += all(fact_hit.values())
                pool_sets = [
                    {i for i in pool if overlaps(store.chunks[i], spans[f])} for f in q["expected_facts"]
                ]
                rf, rq = random_baseline(pool_sets, len(pool))
                rnd_facts += rf
                rnd_full += rq
                row = {
                    "id": q["id"],
                    "facts": fact_hit,
                    "full": all(fact_hit.values()),
                    "type": q["type"],
                    "random_facts": rf,
                    "random_full": rq,
                    "pool": len(pool),
                    "top5": [
                        {
                            "file": h.chunk.raw.source_file,
                            "start": h.chunk.raw.char_start,
                            "end": h.chunk.raw.char_end,
                            "strategy": h.chunk.raw.chunking_strategy,
                            "store": h.chunk.raw.store_id,
                            "score": round(h.score, 5),
                        }
                        for h in hits
                    ],
                }
                if not use_filter:
                    n_other = sum(h.chunk.raw.store_id != store_id for h in hits)
                    conf = any(overlaps(h.chunk, spans[f]) for f in q["confusable_facts"] for h in hits)
                    other_store += n_other
                    q_other += n_other > 0
                    q_confusable += conf
                    row |= {"other_store_chunks": n_other, "confusable_in_top5": conf}
                per_q.append(row)
            n_q = len(golden)
            groups = {}
            for kind in ("fact", "time"):
                rows_k = [r for r in per_q if r["type"] == kind]
                nf = sum(len(r["facts"]) for r in rows_k)
                hf = sum(sum(r["facts"].values()) for r in rows_k)
                groups[kind] = {
                    "questions": len(rows_k),
                    "facts": nf,
                    "hit_facts": hf,
                    "recall_at_5_fact": round(hf / nf, 4),
                    "full_hits": sum(r["full"] for r in rows_k),
                    "full_hit_rate": round(sum(r["full"] for r in rows_k) / len(rows_k), 4),
                    "random_recall_fact": round(sum(r["random_facts"] for r in rows_k) / nf, 4),
                    "random_full_hit_rate": round(sum(r["random_full"] for r in rows_k) / len(rows_k), 4),
                }
                if not use_filter:
                    groups[kind] |= {
                        "other_store_chunks_in_top5": sum(r["other_store_chunks"] for r in rows_k),
                        "questions_with_other_store": sum(r["other_store_chunks"] > 0 for r in rows_k),
                        "questions_with_confusable_in_top5": sum(r["confusable_in_top5"] for r in rows_k),
                    }
            conditions.append(
                {
                    "strategy": strategy,
                    "store_filter": use_filter,
                    "questions": n_q,
                    "facts": n_facts,
                    "recall_at_5_fact": round(hit_facts / n_facts, 4),
                    "hit_facts": hit_facts,
                    "full_hit_rate": round(full_hits / n_q, 4),
                    "full_hits": full_hits,
                    "random_recall_fact": round(rnd_facts / n_facts, 4),
                    "random_full_hit_rate": round(rnd_full / n_q, 4),
                    "mean_pool": round(sum(r["pool"] for r in per_q) / n_q, 1),
                    "groups": groups,
                    **(
                        {}
                        if use_filter
                        else {
                            "other_store_chunks_in_top5": other_store,
                            "questions_with_other_store": q_other,
                            "questions_with_confusable_in_top5": q_confusable,
                        }
                    ),
                    "per_question": per_q,
                }
            )

    result = {
        "date": date.today().isoformat(),
        "embedding": {"provider": embedder.provider, "model": embedder.model},
        "k": K,
        "questions": len(golden),
        "chunk_counts_per_store_filter_on": counts,
        "random_baseline_method": "해석적 계산(시드 없음): 문항별 검색 풀에서 상위 5개를 무작위 비복원 추출할 때, "
        "사실별 적중 확률 = 1 - C(N-m,5)/C(N,5) (m=사실 구간과 겹치는 풀 내 청크 수), 문항 완전 적중 확률은 포함·배제로 정확 계산",
        "conditions": conditions,
        "run": {"api_batches": embedder.api_calls, "embedding_tokens_total_used": embedder.tokens_used()},
    }
    if out_path:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        out_path.with_suffix(".md").write_text(to_markdown(result), encoding="utf-8")
    return result


def to_markdown(r: dict) -> str:
    lines = [
        f"# 벡터 검색 기준선 ({r['date']})",
        "",
        f"- 임베딩: {r['embedding']['provider']} / {r['embedding']['model']}, 검색: 벡터 코사인 상위 {r['k']}, 대상 {r['questions']}문항(fact 20 + time 5)",
        "- 적중 = 상위 5개 청크의 원문 위치가 정답 사실 구간(문서·트랜스크립트 모든 구간)과 겹침",
        f"- 무작위 기준선: {r['random_baseline_method']}",
        "- 트랜스크립트는 세 조건 모두 같은 고정 창(약 150토큰), 문서만 조건별로 다르다",
        "",
        "## 조건·매장별 청크 수 (매장 필터 켠 검색 풀 = 문서 + 트랜스크립트)",
        "",
        "| 조건 | " + " | ".join(s.upper() for s in STORES) + " |",
        "|---|" + "---|" * len(STORES),
    ]
    for s, per in r["chunk_counts_per_store_filter_on"].items():
        lines.append(f"| {s} | " + " | ".join(str(per[st]) for st in STORES) + " |")
    lines += [
        "",
        "## Recall@5 — 사실 20문항 (검색 점수. 시각 문항과 분리 보고)",
        "",
        "| 청킹 | 매장 필터 | 사실 Recall@5 | (무작위) | 문항 완전 적중 | (무작위) | 평균 검색 풀 |",
        "|---|---|---|---|---|---|---|",
    ]
    for c in r["conditions"]:
        g = c["groups"]["fact"]
        lines.append(
            f"| {c['strategy']} | {'켬' if c['store_filter'] else '끔'} | {g['hit_facts']}/{g['facts']} = {g['recall_at_5_fact']:.1%}"
            f" | {g['random_recall_fact']:.1%} | {g['full_hits']}/{g['questions']} = {g['full_hit_rate']:.0%}"
            f" | {g['random_full_hit_rate']:.0%} | {c['mean_pool']} |"
        )
    lines += [
        "",
        "## 참고: 시각 5문항 (get_current_tasks 도구 경로 대상 — 검색 점수로 해석하지 않음)",
        "",
        "| 청킹 | 매장 필터 | 사실 Recall@5 | (무작위) | 문항 완전 적중 | (무작위) |",
        "|---|---|---|---|---|---|",
    ]
    for c in r["conditions"]:
        g = c["groups"]["time"]
        lines.append(
            f"| {c['strategy']} | {'켬' if c['store_filter'] else '끔'} | {g['hit_facts']}/{g['facts']} = {g['recall_at_5_fact']:.1%}"
            f" | {g['random_recall_fact']:.1%} | {g['full_hits']}/{g['questions']} = {g['full_hit_rate']:.0%}"
            f" | {g['random_full_hit_rate']:.0%} |"
        )
    lines += [
        "",
        "## 매장 필터 끔 — 매장 혼동 (사실 20문항 / 시각 5문항)",
        "",
        "| 청킹 | 문항군 | 상위5 중 다른 매장 청크 | 다른 매장 청크가 든 문항 | confusable 구간이 든 문항 |",
        "|---|---|---|---|---|",
    ]
    for c in r["conditions"]:
        if not c["store_filter"]:
            for kind, label in (("fact", "사실"), ("time", "시각")):
                g = c["groups"][kind]
                lines.append(
                    f"| {c['strategy']} | {label} | {g['other_store_chunks_in_top5']}/{g['questions'] * r['k']} "
                    f"| {g['questions_with_other_store']}/{g['questions']} | {g['questions_with_confusable_in_top5']}/{g['questions']} |"
                )
    run = r["run"]
    lines += [
        "",
        f"- 이 실행의 임베딩 API 배치 호출: {run['api_batches']}회 (캐시 적중 시 0), 누적 임베딩 토큰: {run['embedding_tokens_total_used']:,}",
        "- 임베딩은 D1 첫 실행(13배치, 51,475토큰)에서 만들었고, 사실/시각 분리 표는 D2에서 캐시로 재집계했다(API 0회).",
    ]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out", type=Path, default=ROOT / "eval" / "results" / f"{date.today().isoformat()}-retrieval.json"
    )
    ap.add_argument("--counts-only", action="store_true", help="청크 수만 출력하고 임베딩·측정은 하지 않는다")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if args.counts_only:
        chunks = build_chunks(load_sources(), get_settings().embedding_model or "voyage-4")
        for s in STRATEGIES:
            print(
                s,
                {
                    st: sum(
                        1
                        for c in chunks
                        if c.store_id == st and c.chunking_strategy in (s, TRANSCRIPT_STRATEGY)
                    )
                    for st in STORES
                },
            )
        print(Counter(c.chunking_strategy for c in chunks))
    else:
        try:
            res = run(args.out)
        except BudgetExceeded as e:
            print(f"[중단] {e}")
            sys.exit(2)
        print(to_markdown(res))
