#!/usr/bin/env bash
# 보완된 채점 기준(2026-10-01)으로 재채점 — 응답 재생성 없음(--no-generate), 정확도·충실도만 새 기준으로 안정화 재채점.
# Groq API에 접근할 수 있을 때 저장소 루트에서 실행: bash eval/rejudge_all.sh
# 이후: uv run --directory agent python ../eval/rejudge_compare.py, uv run --directory agent python ../eval/human_sample_v2.py --model
export PATH="$PATH:$HOME/AppData/Roaming/Python/Python312/Scripts"
run() { uv run --directory agent python ../eval/run.py --criteria-v2 --no-generate --judge-budget-usd 0.3 "$@" > "/tmp/rejudge_$2_$3.log" 2>&1; }
(run --runs 3 --label baseline) &
for i in 1 2 3; do (run --runs 1 --label expD-v2-$i) & done
wait
for i in 1 2 3; do (run --runs 1 --label expG-int-$i) & done
for i in 1 2 3; do (run --runs 1 --label expC-auxhaiku-$i --preset aux-haiku) & done
for i in 1 2 3; do (run --runs 1 --label expC-haiku-$i --preset haiku) & done
wait
