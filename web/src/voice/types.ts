export interface VadConfig {
  startSensitivity: "START_SENSITIVITY_HIGH" | "START_SENSITIVITY_LOW";
  endSensitivity: "END_SENSITIVITY_HIGH" | "END_SENSITIVITY_LOW";
  prefixPaddingMs: number;
  silenceDurationMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  startSensitivity: "START_SENSITIVITY_HIGH",
  endSensitivity: "END_SENSITIVITY_HIGH",
  prefixPaddingMs: 200,
  silenceDurationMs: 600,
};

export interface TranscriptLine {
  role: "user" | "assistant" | "system";
  text: string;
  final: boolean;
}

export interface ToolCallEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
