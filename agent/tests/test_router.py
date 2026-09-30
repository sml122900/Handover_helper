import pytest

from graph.prompts import ANSWER_SYSTEM, ANSWER_SYSTEM_V2, answer_system, tasks_answer_system
from llm.client import AUX_NODES, HAIKU, CostTracker, RoutedLLM, make_llm


class Stub:
    def __init__(self, model):
        self.model = model
        self.calls = []

    def structured(self, **kw):
        self.calls.append(("structured", kw["tag"]))
        return self.model

    def text(self, **kw):
        self.calls.append(("text", kw["tag"]))
        return self.model


def test_routed_llm_picks_model_by_node_tag():
    son, hai = Stub("sonnet"), Stub("haiku")
    r = RoutedLLM(son, {t: hai for t in AUX_NODES})
    assert r.structured(tag="classify", system="", user="", schema=None, tool_name="") == "haiku"
    assert r.structured(tag="sufficiency", system="", user="", schema=None, tool_name="") == "haiku"
    assert r.structured(tag="rewrite", system="", user="", schema=None, tool_name="") == "haiku"
    assert r.text(tag="answer", system="", user="") == "sonnet"  # 답변 노드는 Sonnet


@pytest.mark.parametrize(
    ("preset", "aux", "answer"),
    [("sonnet", "sonnet", "sonnet"), ("aux-haiku", "haiku", "sonnet"), ("haiku", "haiku", "haiku")],
)
def test_presets_define_experiment_c_conditions(preset, aux, answer):
    r = make_llm(preset, "sk-test", "claude-sonnet-4-6", CostTracker(None, "anthropic", None))
    models = {"sonnet": "claude-sonnet-4-6", "haiku": HAIKU}
    for tag in AUX_NODES:
        assert r._pick(tag).model == models[aux]
    assert r._pick("answer").model == models[answer]


def test_unknown_preset_rejected():
    with pytest.raises(ValueError):
        make_llm("gpt", "k", "m", CostTracker(None, "anthropic", None))


def test_answer_prompt_versions_are_switchable_and_keep_v1_rules():
    assert answer_system("v1") == ANSWER_SYSTEM and answer_system("v2") == ANSWER_SYSTEM_V2
    assert ANSWER_SYSTEM in ANSWER_SYSTEM_V2  # v2는 v1 규칙을 그대로 포함하고 규칙만 추가
    assert "근거에 없는 조언" in ANSWER_SYSTEM_V2 and "근거에 없는 조언" not in ANSWER_SYSTEM
    assert "시각 기반" in tasks_answer_system("v2") and "시각 기반" in tasks_answer_system("v1")


def test_v2_prompt_has_no_golden_wording():
    """골든셋 문항·문구를 프롬프트 예시로 쓰지 않는다 (평가 누수 방지)."""
    import json
    from pathlib import Path

    gold = [
        json.loads(x)
        for x in (Path(__file__).resolve().parents[2] / "eval" / "golden.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    for q in gold:
        assert q["question"] not in ANSWER_SYSTEM_V2
        for chunk in (q["question"][:12],):  # 문항 앞부분 12자가 프롬프트에 그대로 들어가지 않아야 한다
            assert chunk not in ANSWER_SYSTEM_V2
