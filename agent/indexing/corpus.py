from dataclasses import dataclass
from pathlib import Path

from indexing.chunkers import chunk_document, chunk_transcript
from indexing.types import STRATEGIES, RawChunk
from settings import ROOT

STORES = ("s1", "s2", "s3", "s4", "s5")


@dataclass(frozen=True)
class SourceFile:
    store_id: str
    source_type: str
    file: str  # fact-spans.json 과 같은 저장소 상대 경로
    text: str


def load_sources(root: Path = ROOT) -> list[SourceFile]:
    out = []
    for s in STORES:
        for ext, kind in (("md", "document"), ("txt", "transcript")):
            rel = f"data/virtual/{s}.{ext}"
            text = (root / rel).read_bytes().decode("utf-8")
            assert "\r" not in text, f"{rel}: LF 줄바꿈이어야 fact-spans 위치와 맞는다"
            out.append(SourceFile(s, kind, rel, text))
    return out


def build_chunks(sources: list[SourceFile], model: str) -> list[RawChunk]:
    """문서 3조건 + 트랜스크립트(조건 공통 1벌) 청크 전체."""
    chunks: list[RawChunk] = []
    for src in sources:
        if src.source_type == "transcript":
            chunks += chunk_transcript(src.store_id, src.file, src.text, model)
        else:
            for strategy in STRATEGIES:
                chunks += chunk_document(src.store_id, src.file, src.text, strategy, model)
    return chunks
