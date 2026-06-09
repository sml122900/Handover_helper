import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handover — 인수인계 영상을 문서로",
  description: "퇴사 전 30분 녹화로, 한 달치 인수인계를 끝내세요.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
