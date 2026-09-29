"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareUpload, completeUpload } from "./upload-actions";
import { uploadWithProgress } from "@/lib/upload-client";
import { oversizeMessage } from "@/lib/upload-validate";

type Phase = "idle" | "recording" | "paused" | "uploading";

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// 브라우저 화면+마이크 녹화 (설치 없음, MediaRecorder API)
export function ScreenRecorder({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const elapsedRef = useRef(0);

  // 경과 시간 타이머 (일시정지 중엔 멈춤)
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  function cleanupStreams() {
    for (const s of streamsRef.current) {
      for (const t of s.getTracks()) t.stop();
    }
    streamsRef.current = [];
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
      setError("이 브라우저는 화면 녹화를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용하세요.");
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false, // 내레이션은 마이크로 — 시스템 오디오 믹싱은 후속
      });
      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        cleanupStreams();
        for (const t of screen.getTracks()) t.stop();
        setError("마이크 권한이 거부되었습니다. 브라우저 주소창의 권한 설정에서 마이크를 허용한 뒤 다시 시도하세요.");
        return;
      }

      const combined = new MediaStream([...screen.getVideoTracks(), ...mic.getAudioTracks()]);
      streamsRef.current = [screen, mic, combined];

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
      const recorder = new MediaRecorder(combined, { mimeType });
      chunksRef.current = [];
      elapsedRef.current = 0;
      setElapsed(0);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void finishAndUpload();
      };
      // 사용자가 브라우저 UI의 "공유 중지"를 누른 경우도 처리
      screen.getVideoTracks()[0].onended = () => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      };

      recorderRef.current = recorder;
      recorder.start(1000); // 1초 단위 청크
      setPhase("recording");
    } catch {
      cleanupStreams();
      setError("화면 공유 권한이 거부되었습니다. 다시 시도하고 공유할 화면을 선택하세요.");
    }
  }

  function pause() {
    recorderRef.current?.pause();
    setPhase("paused");
  }
  function resume() {
    recorderRef.current?.resume();
    setPhase("recording");
  }
  function stop() {
    recorderRef.current?.stop(); // onstop → finishAndUpload
  }

  async function finishAndUpload() {
    cleanupStreams();
    setPhase("uploading");
    setProgress(0);
    try {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      chunksRef.current = [];
      if (blob.size === 0) throw new Error("녹화된 내용이 없습니다.");
      const oversize = oversizeMessage("webm", blob.size);
      if (oversize) throw new Error(oversize);

      // MediaRecorder webm은 duration 메타데이터가 없는 경우가 많아 측정된 경과 시간 사용
      const prep = await prepareUpload({
        projectId,
        fileName: `recording-${Date.now()}.webm`,
        durationSeconds: elapsedRef.current,
      });
      if (!prep.ok) throw new Error(prep.error);

      await uploadWithProgress(prep.signedUrl, blob, "video/webm", setProgress);

      const done = await completeUpload(prep.videoId);
      if (!done.ok) throw new Error(done.error ?? "처리 시작에 실패했습니다.");

      setPhase("idle");
      router.refresh();
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "녹화 업로드에 실패했습니다.");
    }
  }

  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-y-3">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">브라우저 화면 녹화</p>
          <p className="text-xs text-[var(--text-sub)]">설치 없이 화면 + 마이크를 녹화해 바로 변환합니다.</p>
        </div>

        {phase === "idle" && (
          <button
            onClick={start}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            ● 녹화 시작
          </button>
        )}

        {(phase === "recording" || phase === "paused") && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-[var(--text)]">
              {phase === "paused" ? "⏸" : "⏺"} {fmtElapsed(elapsed)}
            </span>
            {phase === "recording" ? (
              <button
                onClick={pause}
                className="rounded-md border border-[var(--card-border)] px-3 py-2 text-sm text-[var(--text)] hover:border-[var(--card-border-hover)]"
              >
                일시정지
              </button>
            ) : (
              <button
                onClick={resume}
                className="rounded-md border border-[var(--card-border)] px-3 py-2 text-sm text-[var(--text)] hover:border-[var(--card-border-hover)]"
              >
                재개
              </button>
            )}
            <button
              onClick={stop}
              className="rounded-md bg-[var(--text)] px-3 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-80"
            >
              종료·업로드
            </button>
          </div>
        )}

        {phase === "uploading" && (
          <span className="text-sm text-[var(--text-sub)]">업로드 중… {progress}%</span>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
