export type View = 'landing' | 'building';
export type AppStatus = 'idle' | 'clarifying' | 'rectifying' | 'prompt-review' | 'building';
export type Tab = 'workspace' | 'codebase' | 'preview';

export type ClarificationQuestion = {
  id: string;
  question: string;
  type: 'yesno' | 'choice' | 'text';
  options?: string[];
  answer: string | null;
};

export type QueuedInstruction = {
  id: string;
  instruction: string;
  queuedAt: number;
  status: 'queued' | 'processing' | 'done' | 'failed';
};

export interface Session {
  id: string;
  name: string;
  created_at: number;
  last_modified: number;
  model_config: any;
}

export interface TerminalEntry {
  id: string;
  source: 'ai' | 'user';
  command: string;
  output: string;
  status: 'pending' | 'running' | 'success' | 'error';
  timestamp: number;
}

export interface CommandQueueItem {
  id: string;
  command: string;
  workdir: string;
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';
export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

export interface ChatMessage {
  role: 'user' | 'ai' | 'system' | 'warning' | 'tool';
  content: string;
}

export interface CheckpointState {
  phase: string;
  files: Record<string, string>;
  chatHistory: ChatMessage[];
  updated_at: number;
}

// TaskConfig is a flexible type for TaskRouter entries
export type TaskConfig = { provider: string; model: string; fallback?: { provider: string; model: string } };
