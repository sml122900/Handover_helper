import json
from pathlib import Path

import pytest

from privacy.mask import MaskedText, mask_deep, mask_sensitive, mask_text

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "mask-cases.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(case):
    assert mask_sensitive(case["input"]) == case["expected"]


def test_mask_deep_only_strings():
    doc = {
        "overview": {"summary": "주민번호 900101-1234567 확인", "sourceTimestamp": {"start": 1, "end": 2}},
        "equipment": [{"name": "포스기", "notes": "비밀번호 4829"}],
    }
    assert mask_deep(doc) == {
        "overview": {"summary": "주민번호 [주민번호] 확인", "sourceTimestamp": {"start": 1, "end": 2}},
        "equipment": [{"name": "포스기", "notes": "비밀번호 4829"}],
    }


def test_mask_text_returns_masked_type():
    t = mask_text("카드 4111 1111 1111 1111")
    assert isinstance(t, MaskedText) and t == "카드 [카드번호]"
