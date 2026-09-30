import json

import pytest

from indexing.chunkers import FIXED_TOKENS, TRANSCRIPT_STRATEGY
from indexing.corpus import build_chunks, load_sources
from indexing.tokens import count_tokens, utf16_index
from indexing.types import STRATEGIES, MaskedChunk, RawChunk
from privacy.mask import mask_text
from settings import ROOT

MODEL = "voyage-4"


@pytest.fixture(scope="module")
def sources():
    return {s.file: s for s in load_sources()}


@pytest.fixture(scope="module")
def chunks(sources):
    return build_chunks(list(sources.values()), MODEL)


def u16_slice(text: str, start: int, end: int) -> str:
    b = text.encode("utf-16-le")
    return b[start * 2 : end * 2].decode("utf-16-le")


def test_offsets_are_utf16_and_match_body(chunks, sources):
    for c in chunks:
        assert u16_slice(sources[c.source_file].text, c.char_start, c.char_end) == c.body


def test_astral_char_shifts_offsets():
    text = "가🙂나다"
    assert utf16_index(text, 3) == 4  # 이모지는 UTF-16에서 2단위


def test_fact_spans_previews_match_source(sources):
    """읽어 온 원문이 fact-spans.json 위치와 같은 기준(UTF-16, LF)인지 확인 — 어긋나면 적중 판정이 무의미하다."""
    facts = json.loads((ROOT / "eval" / "fact-spans.json").read_text(encoding="utf-8"))["facts"]
    checked = 0
    for f in facts.values():
        for kind in ("transcript", "document"):
            sp = f[kind]
            if sp["status"] != "full":
                continue
            got = u16_slice(sources[sp["file"]].text, sp["char_start"], sp["char_end"])
            assert got[:8] == sp["preview"][:8], (sp["file"], sp["char_start"])
            checked += 1
    assert checked > 60


def test_fixed_windows_size(chunks):
    doc = [c for c in chunks if c.chunking_strategy == "fixed150"]
    assert all(count_tokens(c.body, MODEL) <= FIXED_TOKENS + 30 for c in doc)


def test_procedure_chunks_are_items(chunks):
    for c in chunks:
        if c.chunking_strategy == "procedure":
            assert c.body.startswith(("- ", "1. ", "2. ", "3. ", "4. ", "5. ", "6. ", "7. ", "8. ", "9. "))
            assert c.section and c.item_id


def test_heading_only_changes_embed_text(chunks):
    a = {(c.store_id, c.char_start): c for c in chunks if c.chunking_strategy == "procedure"}
    b = {(c.store_id, c.char_start): c for c in chunks if c.chunking_strategy == "procedure_heading"}
    assert a.keys() == b.keys()
    for k, c in b.items():
        assert (c.char_start, c.char_end, c.body) == (a[k].char_start, a[k].char_end, a[k].body)
        assert c.embed_prefix and not a[k].embed_prefix


def test_transcript_same_for_all_conditions(chunks):
    tr = [c for c in chunks if c.source_type == "transcript"]
    assert {c.chunking_strategy for c in tr} == {TRANSCRIPT_STRATEGY}
    assert all(c.video_ts_start is not None for c in tr)


def test_every_strategy_present(chunks):
    assert {c.chunking_strategy for c in chunks if c.source_type == "document"} == set(STRATEGIES)


def test_masked_chunk_rejects_raw_text():
    raw = RawChunk("s1", "document", "f", None, None, 0, 1, None, None, "high", False, "procedure", "x")
    with pytest.raises(TypeError):
        MaskedChunk(raw=raw, body="raw", embed_text="raw")  # type: ignore[arg-type]
    ok = raw.to_masked()
    assert ok.body == "x" and ok.embed_text == mask_text("x")
