"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // 하이드레이션 불일치 방지
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;

  const isDark = resolvedTheme === "dark";
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      className="rounded-md border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-base leading-none hover:border-[var(--card-border-hover)] transition-colors"
      title={isDark ? "라이트 모드" : "다크 모드"}
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
