import {
  ChatCompletionParams,
  ChatCompletionResult,
  LLMChunk,
  LLMError,
  LLMErrorCode,
  LLMProvider,
} from '../interfaces/llm-provider.interface';

/**
 * MockProvider is a deterministic, dependency-free LLM provider used for
 * unit tests (U5) and the prompt prototype script. It does not consume any
 * API key. The `chat` response echoes the last user message in a stable,
 * machine-parseable JSON envelope so downstream code can be exercised
 * without touching the network.
 */
export class MockProvider implements LLMProvider {
  public readonly name = 'mock';

  async chat(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const lastUser = [...params.messages].reverse().find((m) => m.role === 'user');
    const lastContent = lastUser?.content ?? '';
    const body = {
      provider: this.name,
      echo: lastContent,
      temperature: params.temperature ?? null,
      maxTokens: params.maxTokens ?? null,
      analysis: `[mock] mock response for: ${lastContent}`,
    };
    return {
      content: JSON.stringify(body),
      usage: {
        promptTokens: estimateTokens(params.messages.map((m) => m.content).join('\n')),
        completionTokens: estimateTokens(body.analysis),
      },
    };
  }

  async *chatStream(params: ChatCompletionParams): AsyncIterable<LLMChunk> {
    const result = await this.chat(params);
    const tokens = result.content.split(/(\s+)/);
    let index = 0;
    for (const token of tokens) {
      if (token.length === 0) {
        continue;
      }
      yield {
        content: token,
        metadata: { index: index++, provider: this.name },
      };
    }
  }
}

function estimateTokens(text: string): number {
  // Rough heuristic: ~4 characters per token. Good enough for mock bookkeeping.
  return Math.max(1, Math.ceil(text.length / 4));
}

// Re-export so consumers can grab the symbol from a single import location.
export { LLMError, LLMErrorCode, LLMProvider };
