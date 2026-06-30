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
 * KimiProvider is a placeholder implementation of the LLMProvider contract.
 * It validates that KIMI_API_KEY is present at boot time. The body of
 * `chat` / `chatStream` returns deterministic mock content shaped exactly
 * like the eventual real response so call sites do not need to change.
 */
@Injectable()
export class KimiProvider implements LLMProvider {
  public readonly name = 'kimi';
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('KIMI_API_KEY');
    if (!key || key.trim().length === 0) {
      throw new LLMError(
        LLMErrorCode.SERVICE_ERROR,
        this.name,
        'KIMI_API_KEY is missing. Set it in the environment before starting the server.',
      );
    }
    this.apiKey = key;
  }

  async chat(params: ChatCompletionParams): Promise<ChatCompletionResult> {
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
