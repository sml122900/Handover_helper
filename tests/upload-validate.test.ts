import { describe, it, expect } from "vitest";
import { validateUploadedObject, oversizeMessage, MAX_UPLOAD_BYTES } from "../lib/upload-validate";
import { parseFfmpegDuration } from "../lib/audio/processor";

const bytes = (...xs: number[]) => new Uint8Array([...xs, ...new Array(16 - xs.length).fill(0x20)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const MP4 = bytes(0, 0, 0, 0x20, ...ascii("ftypisom"));
const MOV = bytes(0, 0, 0, 0x14, ...ascii("ftypqt  ")); // iPhone/QuickTime 브랜드
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3);
const TXT = new TextEncoder().encode("[00:00] 안녕하세요").slice(0, 16);

describe("validateUploadedObject", () => {
  it.each([
    ["mp4", MP4],
    ["mov", MP4],
    ["mov", MOV],
    ["m4a", MP4],
    ["webm", WEBM],
    ["txt", TXT],
  ])("정상 %s", (ext, head) => {
    expect(validateUploadedObject({ ext, sizeBytes: 1000, head })).toEqual({ ok: true });
  });

  it("확장자 위장 (exe를 mp4로)", () => {
    const r = validateUploadedObject({ ext: "mp4", sizeBytes: 1000, head: bytes(...ascii("MZ")) });
    expect(r.ok).toBe(false);
  });

  it("webm 확장자에 mp4 내용", () => {
    expect(validateUploadedObject({ ext: "webm", sizeBytes: 1000, head: MP4 }).ok).toBe(false);
  });

  it("txt에 바이너리 (NUL 포함)", () => {
    expect(validateUploadedObject({ ext: "txt", sizeBytes: 1000, head: WEBM.map((b, i) => (i === 5 ? 0 : b)) }).ok).toBe(false);
  });

  it("허용되지 않은 확장자", () => {
    expect(validateUploadedObject({ ext: "exe", sizeBytes: 1000, head: MP4 }).ok).toBe(false);
  });

  it("용량 초과 (txt 2MB)", () => {
    expect(validateUploadedObject({ ext: "txt", sizeBytes: 2 * 1024 ** 2 + 1, head: TXT }).ok).toBe(false);
  });

  it("영상 500MB 경계: 정확히 500MB 통과, 초과 거부 + 사유 문구", () => {
    expect(validateUploadedObject({ ext: "mov", sizeBytes: MAX_UPLOAD_BYTES, head: MOV }).ok).toBe(true);
    const r = validateUploadedObject({ ext: "mov", sizeBytes: MAX_UPLOAD_BYTES + 1, head: MOV });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/최대 500MB/);
  });

  it("oversizeMessage: 통과 시 null, 초과 시 MB 표기", () => {
    expect(oversizeMessage("mp4", 100 * 1024 ** 2)).toBeNull();
    expect(oversizeMessage("mp4", 900 * 1024 ** 2)).toMatch(/900MB/);
  });

  it.each(["mp4", "mov", "webm", "m4a"])("500MB 초과 %s: 서버 검사·클라이언트 가드(oversizeMessage) 양쪽 거부", (ext) => {
    const size = MAX_UPLOAD_BYTES + 1;
    expect(oversizeMessage(ext, size)).toMatch(/최대 500MB/);
    expect(validateUploadedObject({ ext, sizeBytes: size, head: MP4 }).ok).toBe(false);
  });

  it("빈 파일", () => {
    expect(validateUploadedObject({ ext: "mp4", sizeBytes: 0, head: MP4 }).ok).toBe(false);
  });
});

describe("parseFfmpegDuration", () => {
  it("hh:mm:ss.xx 파싱", () => {
    expect(parseFfmpegDuration("  Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s")).toBe(3723.5);
  });
  it("N/A면 null (MediaRecorder webm)", () => {
    expect(parseFfmpegDuration("  Duration: N/A, start: 0.000000, bitrate: N/A")).toBeNull();
  });
});
