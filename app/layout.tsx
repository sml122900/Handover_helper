import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { ThemeToggle } from "./components/ThemeToggle";

export const metadata: Metadata = {
  title: "Handover — 인수인계 영상을 문서로",
  description: "퇴사 전 30분 녹화로, 한 달치 인수인계를 끝내세요.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <header className="sticky top-0 z-50 flex items-center justify-end border-b border-[var(--card-border)] bg-[var(--bg)] px-6 py-2">
            <ThemeToggle />
          </header>
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
