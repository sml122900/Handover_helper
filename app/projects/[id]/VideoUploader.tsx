"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareUpload, completeUpload } from "./upload-actions";

// 영상/오디오 길이를 메타데이터로 추출 (초). .txt는 0.
function probeDuration(file: File): Promise<number> {
  if (file.name.toLowerCase().endsWith(".txt")) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const el = document.createElement(file.type.startsWith("audio") ? "audio" : "video");
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(el.duration);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("파일 메타데이터를 읽을 수 없습니다."));
    };
    el.src = url;
  });
}

// XHR 업로드 (fetch는 업로드 진행률 미지원)
function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("네트워크 오류로 업로드에 실패했습니다."));
    xhr.send(file);
  });
}

export function VideoUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    try {
      const durationSeconds = await probeDuration(file);
      const prep = await prepareUpload({ projectId, fileName: file.name, durationSeconds });
      if (!prep.ok) throw new Error(prep.error);

      await uploadWithProgress(prep.signedUrl, file, setProgress);

      const done = await completeUpload(prep.videoId);
      if (!done.ok) throw new Error(done.error ?? "처리 시작에 실패했습니다.");

      setProgress(null);
      router.refresh();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "업로드에 실패했습니다.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-zinc-700 px-4 py-6 text-center">
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.webm,.m4a,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      {progress === null ? (
        <>
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-md bg-white px-4 py-2 font-medium text-zinc-900 hover:bg-zinc-200"
          >
            영상/트랜스크립트 업로드
          </button>
          <p className="mt-2 text-xs text-zinc-500">
            mp4 · webm · m4a (영상/오디오) 또는 txt (트랜스크립트) — Free 플랜 총 20분
          </p>
        </>
      ) : (
        <div>
          <div className="mx-auto mb-2 h-2 w-full max-w-sm overflow-hidden rounded bg-zinc-800">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-zinc-400">업로드 중… {progress}%</p>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
