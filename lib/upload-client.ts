// 클라이언트 업로드 공용 헬퍼 (VideoUploader · ScreenRecorder 공유)

// 영상/오디오 길이를 메타데이터로 추출 (초). .txt는 0.
export function probeDuration(file: File): Promise<number> {
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
export function uploadWithProgress(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
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
