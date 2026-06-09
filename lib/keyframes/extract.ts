import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// ffmpeg 장면 전환 감지로 후보 키프레임(jpg + 타임스탬프) 추출.
// 바이너리: ffmpeg-static (npm 의존성, 전역 설치 X)
// TODO(배포): Vercel 서버리스 용량/시간 한계 → 별도 작업 큐(Inngest 등)로 이전 검토

const SCENE_THRESHOLD = 0.3;
const MAX_KEYFRAMES = 30;

export interface ExtractedFrame {
  timestampSeconds: number;
  jpeg: Buffer;
}

async function ffmpegPath(): Promise<string> {
  const mod = await import("ffmpeg-static");
  const p = mod.default as unknown as string | null;
  if (!p) throw new Error("ffmpeg 바이너리를 찾을 수 없습니다 (ffmpeg-static).");
  return p;
}

export async function extractKeyframes(videoData: Buffer, ext: string): Promise<ExtractedFrame[]> {
  const dir = await mkdtemp(join(tmpdir(), "handover-kf-"));
  try {
    const inputPath = join(dir, `input.${ext}`);
    await writeFile(inputPath, videoData);

    const ffmpeg = await ffmpegPath();
    // select=gt(scene,T): 장면 전환 프레임만 통과, showinfo: pts_time 로그
    const { stderr } = await execFileAsync(
      ffmpeg,
      [
        "-i", inputPath,
        "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
        "-vsync", "vfr",
        "-frames:v", String(MAX_KEYFRAMES),
        "-q:v", "4",
        join(dir, "frame_%03d.jpg"),
      ],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true }
    );

    // showinfo 출력에서 통과한 프레임의 pts_time 추출 (출력 순서 = 파일 번호 순서)
    const timestamps = [...stderr.matchAll(/Parsed_showinfo.*?pts_time:([\d.]+)/g)].map((m) =>
      parseFloat(m[1])
    );

    const files = (await readdir(dir)).filter((f) => f.startsWith("frame_")).sort();
    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < files.length; i++) {
      frames.push({
        timestampSeconds: timestamps[i] ?? 0,
        jpeg: await readFile(join(dir, files[i])),
      });
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
