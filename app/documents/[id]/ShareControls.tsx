"use client";

import { useState } from "react";
import { createShareLink, revokeShareLink, type ShareLink } from "./share-actions";

// 공유 링크 관리 (읽기 전용 뷰 + 만료일)
export function ShareControls({
  documentId,
  initialLinks,
}: {
  documentId: string;
  initialLinks: ShareLink[];
}) {
  const [links, setLinks] = useState(initialLinks);
  const [expiry, setExpiry] = useState<string>("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const result = await createShareLink({
      documentId,
      expiresInDays: expiry === "none" ? null : Number(expiry),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLinks((ls) => [result.link, ...ls]);
  }

  async function revoke(id: string) {
    setLinks((ls) => ls.filter((l) => l.id !== id));
    await revokeShareLink(id, documentId);
  }

  function shareUrl(token: string): string {
    return `${window.location.origin}/share/${token}`;
  }

  async function copy(link: ShareLink) {
    await navigator.clipboard.writeText(shareUrl(link.token));
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 text-sm font-semibold text-[var(--text)]">공유</h2>
      <p className="mb-3 text-xs text-[var(--text-sub)]">읽기 전용 링크를 만들어 후임자에게 보내세요.</p>

      <div className="flex gap-2">
        <select
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="rounded-md border border-[var(--card-border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]"
        >
          <option value="7">7일 후 만료</option>
          <option value="30">30일 후 만료</option>
          <option value="90">90일 후 만료</option>
          <option value="none">만료 없음</option>
        </select>
        <button
          onClick={() => void create()}
          disabled={busy}
          className="rounded-md bg-[var(--text)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-80 disabled:opacity-50"
        >
          {busy ? "생성 중…" : "링크 만들기"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {links.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {links.map((l) => {
            const expired = l.expires_at !== null && new Date(l.expires_at) < new Date();
            return (
              <li key={l.id} className="rounded-md border border-[var(--card-border)] p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className={expired ? "text-red-400" : "text-[var(--text-sub)]"}>
                    {expired
                      ? "만료됨"
                      : l.expires_at
                        ? `~${new Date(l.expires_at).toLocaleDateString("ko-KR")}`
                        : "만료 없음"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void copy(l)}
                      className="text-[var(--text-sub)] underline hover:text-[var(--text)]"
                    >
                      {copiedId === l.id ? "복사됨!" : "링크 복사"}
                    </button>
                    <button
                      onClick={() => void revoke(l.id)}
                      className="text-red-400 underline hover:text-red-300"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
