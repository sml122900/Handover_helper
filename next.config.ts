import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static은 바이너리 경로를 반환하는 패키지 — webpack 번들에 포함되면
  // 경로가 "#ROOT/..." 플레이스홀더로 치환되어 spawn ENOENT 발생
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
