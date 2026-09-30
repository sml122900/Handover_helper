"""임베딩 모델 토크나이저 (로컬, API 호출 없음). 청크 크기를 토큰 단위로 맞추는 데만 쓴다."""

import os
from functools import lru_cache

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


@lru_cache(maxsize=4)
def _tokenizer(model: str):
    from tokenizers import Tokenizer

    repo = model if "/" in model else f"voyageai/{model}"
    return Tokenizer.from_pretrained(repo)


def encode_offsets(text: str, model: str) -> list[tuple[int, int]]:
    """토큰별 (시작, 끝) 문자 위치 (파이썬 str 인덱스, 특수 토큰 제외)."""
    enc = _tokenizer(model).encode(text, add_special_tokens=False)
    return [tuple(o) for o in enc.offsets]


def count_tokens(text: str, model: str) -> int:
    return len(_tokenizer(model).encode(text, add_special_tokens=False).ids)


def utf16_index(text: str, i: int) -> int:
    """str 인덱스(코드포인트) → UTF-16 코드 단위 인덱스. 이모지 등 BMP 밖 문자가 앞에 있으면 달라진다."""
    return i + sum(1 for c in text[:i] if ord(c) > 0xFFFF)
