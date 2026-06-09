import type { Transcript, TranscriptSegment } from "./types.js";

// 트랜스크립트 .txt 파일 파서 (STT 건너뛰고 구조화 테스트용)
// 지원 형식:
//   [mm:ss] 텍스트          → start 타임스탬프
//   [hh:mm:ss] 텍스트       → start 타임스탬프
//   타임스탬프 없는 줄       → start/end null
// 각 세그먼트의 end는 다음 세그먼트의 start로 채움 (마지막은 null)

const TS_LINE = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/;

function toSeconds(a: string, b: string, c?: string): number {
  if (c !== undefined) return Number(a) * 3600 + Number(b) * 60 + Number(c);
  return Number(a) * 60 + Number(b);
}

export function parseTranscriptText(raw: string): Transcript {
  const segments: TranscriptSegment[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m = trimmed.match(TS_LINE);
    if (m) {
      segments.push({ start: toSeconds(m[1], m[2], m[3]), end: null, text: m[4] });
    } else if (segments.length > 0 && segments[segments.length - 1].start === null) {
      // 연속된 무타임스탬프 줄은 하나로 합침
      segments[segments.length - 1].text += " " + trimmed;
    } else {
      segments.push({ start: null, end: null, text: trimmed });
    }
  }

  // end 채우기
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].start !== null && segments[i + 1].start !== null) {
      segments[i].end = segments[i + 1].start;
    }
  }

  return { segments, language: "ko", source: "text-file" };
}

export function transcriptToPromptText(t: Transcript): string {
  return t.segments
    .map((s) => (s.start !== null ? `[${formatTs(s.start)}] ${s.text}` : s.text))
    .join("\n");
}

function formatTs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
