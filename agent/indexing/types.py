from dataclasses import dataclass

from privacy.mask import MaskedText, mask_text

STRATEGIES = ("fixed150", "procedure", "procedure_heading")


@dataclass(frozen=True)
class RawChunk:
    """마스킹 전 청크. 색인·임베딩에는 넘길 수 없다 (to_masked()를 거쳐 MaskedChunk로 변환해야 함).

    char_start/char_end: 원문 파일 기준 위치, UTF-16 코드 단위 (fact-spans.json과 같은 기준)
    """

    store_id: str
    source_type: str  # document | transcript
    source_file: str
    section: str | None
    item_id: str | None
    char_start: int
    char_end: int
    video_ts_start: float | None
    video_ts_end: float | None
    confidence: str  # high | needs_review
    inferred: bool
    chunking_strategy: str
    body: str  # 원문 구간 (위치 판정 기준)
    embed_prefix: str = ""  # 임베딩 입력 앞에만 붙는 문맥 (예: 상위 섹션 제목). 위치·본문에는 영향 없음

    def to_masked(self) -> "MaskedChunk":
        return MaskedChunk(
            raw=self, body=mask_text(self.body), embed_text=mask_text(self.embed_prefix + self.body)
        )


@dataclass(frozen=True)
class MaskedChunk:
    raw: RawChunk
    body: MaskedText
    embed_text: MaskedText

    def __post_init__(self) -> None:
        if not isinstance(self.body, MaskedText) or not isinstance(self.embed_text, MaskedText):
            raise TypeError("MaskedChunk에는 mask_text()를 거친 MaskedText만 넣을 수 있습니다")
