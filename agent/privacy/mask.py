"""개인식별정보 마스킹 — lib/privacy/mask.ts 의 Python 포팅 (같은 동작, 공유 케이스로 검증).

대상: 주민·외국인등록번호 → [주민번호], 카드번호 → [카드번호]
보존: 전화번호·업무 비밀번호/PIN·사업자번호·계좌번호·일련번호·금액·타임스탬프
"""

import calendar
import re
from typing import Any

# re.ASCII: JS의 \d 와 같게 (Python 기본은 유니코드 숫자까지 매칭)
_RRN = re.compile(r"(?<!\d)(\d{2})(\d{2})(\d{2})[- ]?([1-8])\d{6}(?!\d)", re.ASCII)
_CARD = re.compile(
    r"(?<!\d)(?:\d{15,16}|\d{4}([ -])\d{4}\1\d{4}\1\d{4}|\d{4}([ -])\d{6}\2\d{5})(?!\d)", re.ASCII
)


def _valid_birth_date(yy: str, mm: str, dd: str, gender: str) -> bool:
    year = (1900 if gender in "1256" else 2000) + int(yy)
    month, day = int(mm), int(dd)
    if month < 1 or month > 12 or day < 1:
        return False
    return day <= calendar.monthrange(year, month)[1]


def _ean_valid(d: str) -> bool:
    total = sum(int(d[i]) * (3 if i % 2 else 1) for i in range(12))
    return (10 - total % 10) % 10 == int(d[12])


def _rrn_checksum_valid(d: str) -> bool:
    w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5]
    total = sum(x * int(d[i]) for i, x in enumerate(w))
    return (11 - total % 11) % 10 == int(d[12])


def _looks_like_barcode(match: str) -> bool:
    # 구분자 없는 13자리: EAN 체크섬 통과 + 주민번호 체크섬 실패면 바코드로 보고 보존
    return (
        bool(re.fullmatch(r"\d{13}", match, re.ASCII))
        and _ean_valid(match)
        and not _rrn_checksum_valid(match)
    )


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _issuer_prefix(digits: str) -> bool:
    # 발급사 범위: 3·4·5·6·9 시작, 2는 MasterCard 2221~2720만
    if digits[0] in "34569":
        return True
    return 2221 <= int(digits[:4]) <= 2720


def mask_sensitive(text: str) -> str:
    def rrn(m: re.Match[str]) -> str:
        yy, mm, dd, g = m.group(1), m.group(2), m.group(3), m.group(4)
        ok = _valid_birth_date(yy, mm, dd, g) and not _looks_like_barcode(m.group(0))
        return "[주민번호]" if ok else m.group(0)

    def card(m: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", m.group(0), flags=re.ASCII)
        return "[카드번호]" if _issuer_prefix(digits) and _luhn(digits) else m.group(0)

    return _CARD.sub(card, _RRN.sub(rrn, text))


def mask_deep(value: Any) -> Any:
    """JSON 직렬화 가능한 값 전체에 적용 (문자열 값만 바뀜)."""
    if isinstance(value, str):
        return mask_sensitive(value)
    if isinstance(value, list):
        return [mask_deep(v) for v in value]
    if isinstance(value, dict):
        return {k: mask_deep(v) for k, v in value.items()}
    return value


class MaskedText(str):
    """mask_text()를 거친 텍스트. 색인·임베딩 코드는 이 타입만 받는다 (런타임 isinstance 검사)."""

    __slots__ = ()


def mask_text(text: str) -> MaskedText:
    return MaskedText(mask_sensitive(text))
