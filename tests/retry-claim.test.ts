import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimAndEnqueueRetry } from "../lib/pipeline/retry";

// videos 행 1개를 가진 가짜 DB — update().eq().eq().select() 조건부 갱신을 원자적으로 흉내
function fakeDb(initialStatus: string) {
  const row = { id: "v1", status: initialStatus, error_message: "사유" as string | null, stage: "structuring" as string | null };
  const db = {
    from: () => ({
      update: (patch: Partial<typeof row>) => {
        const filters: [string, string][] = [];
        const q = {
          eq(col: string, val: string) {
            filters.push([col, val]);
            return q;
          },
          async select() {
            await Promise.resolve(); // 동시 호출 경합 재현 (두 호출이 같은 틱에 도착)
            const match = filters.every(([c, v]) => (row as Record<string, unknown>)[c] === v);
            if (!match) return { data: [], error: null };
            Object.assign(row, patch);
            return { data: [{ id: row.id }], error: null };
          },
          then(resolve: (v: { error: null }) => void) {
            // select 없이 await되는 stage 초기화 update
            if (filters.every(([c, v]) => (row as Record<string, unknown>)[c] === v)) Object.assign(row, patch);
            resolve({ error: null });
          },
        };
        return q;
      },
    }),
  };
  return { db: db as unknown as SupabaseClient, row };
}

describe("claimAndEnqueueRetry", () => {
  it("failed → uploaded 전환 후 재시도 키로 1회 enqueue, 사유·stage 초기화", async () => {
    const { db, row } = fakeDb("failed");
    const enqueue = vi.fn(async () => {});
    expect(await claimAndEnqueueRetry(db, "v1", enqueue, () => 123)).toBe(true);
    expect(row).toMatchObject({ status: "uploaded", error_message: null, stage: null });
    expect(enqueue).toHaveBeenCalledExactlyOnceWith("v1:retry-123");
  });

  it("재시도 버튼 중복 클릭(동시 2회) → 조건부 update로 1건만 통과, 이벤트 1개", async () => {
    const { db } = fakeDb("failed");
    const enqueue = vi.fn(async () => {});
    const results = await Promise.all([
      claimAndEnqueueRetry(db, "v1", enqueue),
      claimAndEnqueueRetry(db, "v1", enqueue),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("failed가 아닌 영상(처리 중·완료)은 재시도 불가", async () => {
    for (const status of ["uploaded", "transcribing", "done"]) {
      const { db } = fakeDb(status);
      const enqueue = vi.fn(async () => {});
      expect(await claimAndEnqueueRetry(db, "v1", enqueue)).toBe(false);
      expect(enqueue).not.toHaveBeenCalled();
    }
  });
});
