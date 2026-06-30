export type SSEEventType = 'message_start' | 'message_delta' | 'message_end' | 'error';

export interface SSEChunk<T = unknown> {
  event: SSEEventType;
  data: T;
}

export interface ChatSSEData {
  messageId?: string;
  content?: string;
  role?: 'assistant';
  modelUsed?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface StrategySSEData {
  requestId?: string;
  content?: string;
  analysis?: string;
  structured?: Record<string, unknown>;
  type?: 'swot' | 'decision_tree' | 'pros_cons';
  modelUsed?: string;
  error?: {
    code: string;
    message: string;
  };
}
