"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareUpload, completeUpload } from "./upload-actions";
import { probeDuration, uploadWithProgress } from "@/lib/upload-client";

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

      await uploadWithProgress(prep.signedUrl, file, file.type, setProgress);

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
