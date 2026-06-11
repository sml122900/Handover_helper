"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareUpload, completeUpload } from "./upload-actions";
import { probeDuration, uploadWithProgress } from "@/lib/upload-client";

export function VideoUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    try {
      const durationSeconds = await probeDuration(file);
      const prep = await prepareUpload({ projectId, fileName: file.name, durationSeconds });
      if (!prep.ok) throw new Error(prep.error);

      await uploadWithProgress(prep.signedUrl, file, file.type, setProgress);

      const done = await completeUpload(prep.videoId);
      if (!done.ok) throw new Error(done.error ?? "처리 시작에 실패했습니다.");

      setProgress(null);
      router.refresh();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "업로드에 실패했습니다.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  const inputHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  return (
    <div className="rounded-lg border border-dashed border-[var(--card-border)] px-4 py-6 text-center">
      {/* 파일 선택 (데스크톱 + 모바일 갤러리) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.mov,.webm,.m4a,.txt"
        className="hidden"
        onChange={inputHandler}
      />
      {/* 카메라 직접 촬영 (모바일 — capture 속성이 데스크톱에서 무시됨) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={inputHandler}
      />

      {progress === null ? (
        <>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md bg-[var(--text)] px-4 py-2 font-medium text-[var(--bg)] hover:opacity-80"
            >
              파일 선택
            </button>
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="rounded-md border border-[var(--card-border)] px-4 py-2 font-medium text-[var(--text)] hover:border-[var(--card-border-hover)]"
              title="모바일에서 카메라 바로 열기"
            >
              📷 촬영
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--text-sub)]">
            mp4 · mov · webm · m4a (영상/오디오) 또는 txt (트랜스크립트) — Free 플랜 총 20분
          </p>
        </>
      ) : (
        <div>
          <div className="mx-auto mb-2 h-2 w-full max-w-sm overflow-hidden rounded bg-[var(--card-border)]">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-[var(--text-sub)]">업로드 중… {progress}%</p>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
