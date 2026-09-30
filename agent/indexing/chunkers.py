"""청킹 3종. 문서: fixed150 / procedure / procedure_heading, 트랜스크립트: 세 조건 모두 같은 고정 창.

정답 판정은 원문 위치(char_start/char_end)로 하므로, 청킹 방식이 달라도 같은 기준으로 비교된다.
"""

import re

from indexing.tokens import count_tokens, encode_offsets, utf16_index
from indexing.types import RawChunk

FIXED_TOKENS = 150
TRANSCRIPT_STRATEGY = "transcript_fixed150"
_TAIL_MIN_TOKENS = 30  # 마지막 창이 이보다 짧으면 앞 창에 붙인다
_HEADING = re.compile(r"^## (\d+)\. (.+)$", re.M)
_ITEM_START = re.compile(r"^(?:- |\d+\. )")
_VIDEO_TS = re.compile(r"_\(영상 (\d+):(\d{2})(?:~(\d+):(\d{2}))?\)_")
_TRANSCRIPT_LINE = re.compile(r"^\[(\d+):(\d{2})\]")


def _sec(m: str, s: str) -> float:
    return int(m) * 60 + int(s)


def _doc_meta(body: str) -> tuple[float | None, float | None, str, bool]:
    ts = [
        (
            _sec(m.group(1), m.group(2)),
            _sec(m.group(3), m.group(4)) if m.group(3) else _sec(m.group(1), m.group(2)),
        )
        for m in _VIDEO_TS.finditer(body)
    ]
    start = min((t[0] for t in ts), default=None)
    end = max((t[1] for t in ts), default=None)
    confidence = "needs_review" if "[확인 필요]" in body or "[AI 보완" in body else "high"
    return start, end, confidence, "[AI 보완" in body


def _windows(text: str, model: str, size: int) -> list[tuple[int, int]]:
    """토큰 size개씩 끊은 (str 시작, str 끝) 구간. 마지막이 짧으면 앞 창에 합친다."""
    offs = encode_offsets(text, model)
    spans = [
        (offs[i][0], offs[min(i + size, len(offs)) - 1][1], min(size, len(offs) - i))
        for i in range(0, len(offs), size)
    ]
    if len(spans) > 1 and spans[-1][2] < _TAIL_MIN_TOKENS:
        last = spans.pop()
        spans[-1] = (spans[-1][0], last[1], spans[-1][2] + last[2])
    return [(s, e) for s, e, _ in spans]


def _section_at(text: str, pos: int) -> tuple[str | None, str | None]:
    """pos가 속한 '## N. 제목' 섹션 (번호, 제목)."""
    found = (None, None)
    for m in _HEADING.finditer(text):
        if m.start() <= pos:
            found = (m.group(1), m.group(2))
    return found


def chunk_document(store_id: str, file: str, text: str, strategy: str, model: str) -> list[RawChunk]:
    def make(start: int, end: int, section_no, section_title, item_id) -> RawChunk:
        body = text[start:end]
        ts0, ts1, conf, inferred = _doc_meta(body)
        prefix = f"{section_title}\n" if strategy == "procedure_heading" and section_title else ""
        return RawChunk(
            store_id=store_id,
            source_type="document",
            source_file=file,
            section=f"{section_no}. {section_title}" if section_title else None,
            item_id=item_id,
            char_start=utf16_index(text, start),
            char_end=utf16_index(text, end),
            video_ts_start=ts0,
            video_ts_end=ts1,
            confidence=conf,
            inferred=inferred,
            chunking_strategy=strategy,
            body=body,
            embed_prefix=prefix,
        )

    if strategy == "fixed150":
        chunks = []
        for i, (s, e) in enumerate(_windows(text, model, FIXED_TOKENS)):
            no, title = _section_at(text, s)
            chunks.append(make(s, e, no, title, f"w{i}"))
        return chunks

    if strategy not in ("procedure", "procedure_heading"):
        raise ValueError(f"알 수 없는 문서 청킹 전략: {strategy}")

    # 절차 단위 = '## N. 섹션' 아래 최상위 목록 항목(들여쓴 하위 줄 포함) 하나
    chunks: list[RawChunk] = []
    per_section: dict = {}
    starts: list[int] = []
    pos = 0
    for line in text.split("\n"):
        if _ITEM_START.match(line):
            starts.append(pos)
        pos += len(line) + 1
    heads = [m.start() for m in _HEADING.finditer(text)]
    for s in starts:
        nxt = min([x for x in starts + heads if x > s], default=len(text))
        e = s + len(text[s:nxt].rstrip())
        no, title = _section_at(text, s)
        per_section[no] = per_section.get(no, 0) + 1
        chunks.append(make(s, e, no, title, f"{no}.{per_section[no]}"))
    return chunks


def chunk_transcript(store_id: str, file: str, text: str, model: str) -> list[RawChunk]:
    """[mm:ss] 줄 경계를 유지하며 약 150토큰이 되도록 줄을 묶는다 (모든 청킹 조건 공통)."""
    lines, pos = [], 0
    for line in text.split("\n"):
        m = _TRANSCRIPT_LINE.match(line)
        if line.strip():
            lines.append(
                (pos, pos + len(line), _sec(m.group(1), m.group(2)) if m else None, count_tokens(line, model))
            )
        pos += len(line) + 1

    groups: list[list[tuple]] = []
    cur, cur_tokens = [], 0
    for ln in lines:
        if cur and cur_tokens + ln[3] > FIXED_TOKENS:
            groups.append(cur)
            cur, cur_tokens = [], 0
        cur.append(ln)
        cur_tokens += ln[3]
    if cur:
        groups.append(cur)

    chunks = []
    for i, g in enumerate(groups):
        s, e = g[0][0], g[-1][1]
        nxt_ts = groups[i + 1][0][2] if i + 1 < len(groups) else None
        last_ts = g[-1][2]
        chunks.append(
            RawChunk(
                store_id=store_id,
                source_type="transcript",
                source_file=file,
                section=None,
                item_id=f"t{i}",
                char_start=utf16_index(text, s),
                char_end=utf16_index(text, e),
                video_ts_start=g[0][2],
                video_ts_end=nxt_ts if nxt_ts is not None else last_ts,
                confidence="high",
                inferred=False,
                chunking_strategy=TRANSCRIPT_STRATEGY,
                body=text[s:e],
            )
        )
    return chunks
