import type { Env as NudgeEnv } from "../types";

export interface WorkersAiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface Env extends NudgeEnv {
  MEMORY_DB: D1Database;
  MEMORY_VECTORIZE: VectorizeIndex;
  MEMORY_CONFIG_KV: KVNamespace;
  AI: WorkersAiBinding;
  MEMORY_VECTORIZE_GRACE_MS?: string;
}

export const SB_VERSION = "2.3.1-nudge.1";
