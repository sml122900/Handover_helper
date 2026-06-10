// 구조화 프롬프트 버전 레지스트리
// 새 버전 추가: structure-v1.ts 복제 → structure-v2.ts 작성 → 아래에 등록
// 비교: npm run compare -- structure-v1 structure-v2

import * as v1 from "./structure-v1";

export interface StructurePrompt {
  version: string;
  system: string;
  buildUserPrompt(transcriptText: string): string;
}

const REGISTRY: Record<string, StructurePrompt> = {
  [v1.PROMPT_VERSION]: {
    version: v1.PROMPT_VERSION,
    system: v1.STRUCTURE_SYSTEM_PROMPT,
    buildUserPrompt: v1.buildUserPrompt,
  },
};

/** 운영 기본 버전 — 새 버전이 비교에서 이기면 여기를 올린다 */
export const DEFAULT_PROMPT_VERSION = "structure-v1";

export function getStructurePrompt(version = DEFAULT_PROMPT_VERSION): StructurePrompt {
  const p = REGISTRY[version];
  if (!p) {
    throw new Error(
      `등록되지 않은 프롬프트 버전: ${version} (등록됨: ${Object.keys(REGISTRY).join(", ")})`
    );
  }
  return p;
}

export function listPromptVersions(): string[] {
  return Object.keys(REGISTRY);
}
