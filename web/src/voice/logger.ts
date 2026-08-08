const ENABLED = import.meta.env.DEV;

function tag(label: string): string {
  return `[voice:${label}]`;
}

export const voiceLog = {
  speechStart: (source: "local" | "gemini") => {
    if (ENABLED) console.log(tag("speech"), `${source} speech started`);
  },
  speechEnd: (source: "local" | "gemini") => {
    if (ENABLED) console.log(tag("speech"), `${source} speech ended`);
  },
  interrupted: () => {
    if (ENABLED) console.log(tag("interrupt"), "barge-in — clearing playback");
  },
  queueSize: (ms: number) => {
    if (ENABLED) console.log(tag("queue"), `${ms.toFixed(0)}ms buffered`);
  },
  wsStatus: (status: string) => {
    if (ENABLED) console.log(tag("ws"), status);
  },
  turnComplete: () => {
    if (ENABLED) console.log(tag("turn"), "complete");
  },
  reconnectAttempt: (attempt: number) => {
    if (ENABLED) console.log(tag("reconnect"), `attempt ${attempt}`);
  },
  toolCall: (name: string, args: unknown) => {
    if (ENABLED) console.log(tag("tool"), name, args);
  },
  event: (label: string, data?: unknown) => {
    if (ENABLED) console.log(tag(label), data ?? "");
  },
};
