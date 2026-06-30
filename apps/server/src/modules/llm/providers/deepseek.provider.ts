import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChatCompletionParams,
  ChatCompletionResult,
  LLMChunk,
  LLMError,
  LLMErrorCode,
  LLMProvider,
} from '../interfaces/llm-provider.interface';

/**
 * DeepSeekProvider is a placeholder implementation of the LLMProvider
 * contract. It validates that DEEPSEEK_API_KEY is present at boot time and
 * otherwise returns deterministic mock content. Replacing the body of
 * `chat` / `chatStream` with a real HTTP client (e.g. fetch against the
 * DeepSeek API) is the only change required once a real key is wired in.
 */
@Injectable()
export class DeepSeekProvider implements LLMProvider {
  public readonly name = 'deepseek';
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('DEEPSEEK_API_KEY');
    if (!key || key.trim().length === 0) {
      throw new LLMError(
        LLMErrorCode.SERVICE_ERROR,
        this.name,
        'DEEPSEEK_API_KEY is missing. Set it in the environment before starting the server.',
      );
    }
    this.apiKey = key;
  }

  async chat(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    // Intentionally not making any network call in U4. This branch is where
    // the real HTTP call will live in a later unit.
    void this.apiKey;
    const lastUser = [...params.messages].reverse().find((m) => m.role === 'user');
    const lastContent = lastUser?.content ?? '';
    return {
      content: `[${this.name}] mock response for: ${lastContent}`,
    };
  }

  async *chatStream(params: ChatCompletionParams): AsyncIterable<LLMChunk> {
    const result = await this.chat(params);
    const text = result.content;
    const chunkSize = 8;
    for (let i = 0; i < text.length; i += chunkSize) {
      yield { content: text.slice(i, i + chunkSize) };
    }
  }
}
