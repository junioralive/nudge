export type VoiceState =
  | "disconnected"
  | "connecting"
  | "listening"
  | "user-speaking"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "reconnecting"
  | "error";

// Explicit transition table rather than an isSpeaking boolean — every state
// change is a deliberate, named edge, so "what states can follow X" is
// answerable by reading this object instead of tracing boolean logic.
const TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  disconnected: ["connecting"],
  connecting: ["listening", "error", "disconnected"],
  listening: ["user-speaking", "speaking", "reconnecting", "error", "disconnected"],
  "user-speaking": ["thinking", "listening", "reconnecting", "error", "disconnected"],
  thinking: ["speaking", "listening", "reconnecting", "error", "disconnected"],
  speaking: ["interrupted", "listening", "thinking", "reconnecting", "error", "disconnected"],
  interrupted: ["user-speaking", "listening", "reconnecting", "error", "disconnected"],
  reconnecting: ["listening", "error", "disconnected"],
  error: ["connecting", "disconnected"],
};

export type StateListener = (next: VoiceState, prev: VoiceState) => void;

export class VoiceStateMachine {
  private state: VoiceState = "disconnected";
  private listeners = new Set<StateListener>();

  get current(): VoiceState {
    return this.state;
  }

  canTransition(next: VoiceState): boolean {
    return TRANSITIONS[this.state].includes(next);
  }

  transition(next: VoiceState): boolean {
    if (next === this.state) return true;
    if (!this.canTransition(next)) {
      console.warn(`[voice-state] rejected ${this.state} -> ${next}`);
      return false;
    }
    const prev = this.state;
    this.state = next;
    for (const listener of this.listeners) listener(next, prev);
    return true;
  }

  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.state = "disconnected";
  }
}
