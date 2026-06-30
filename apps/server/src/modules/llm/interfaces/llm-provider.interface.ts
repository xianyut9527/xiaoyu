/**
 * LLM Provider abstraction layer (U4).
 *
 * This file defines the public contract every LLM provider implementation
 * must satisfy. Concrete providers (DeepSeek / Kimi / GLM / Mock) live in
 * `../providers`. The contract is intentionally small and stream-friendly so
 * that swapping a Mock provider for a real HTTP-backed provider does not
 * require changes to the call sites.
 */

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

/**
 * Parameters accepted by both `chat` and `chatStream`.
 * `options` is an escape hatch for provider-specific features
 * (e.g. response_format, tools, safety_settings). Implementations are free
 * to ignore keys they do not understand.
 */
export interface ChatCompletionParams {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  options?: Record<string, unknown>;
}

export interface LLMChunk {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ChatCompletionResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export enum LLMErrorCode {
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  CONTENT_FILTER = 'CONTENT_FILTER',
  SERVICE_ERROR = 'SERVICE_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class LLMError extends Error {
  constructor(
    public readonly code: LLMErrorCode,
    public readonly provider: string,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface LLMProvider {
  readonly name: string;
  chatStream(params: ChatCompletionParams): AsyncIterable<LLMChunk>;
  chat(params: ChatCompletionParams): Promise<ChatCompletionResult>;
}
