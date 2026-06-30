import { Inject, Injectable } from '@nestjs/common';
import { LLMError, LLMErrorCode, LLMProvider } from '../interfaces/llm-provider.interface';

/**
 * Token used by LLMModule to expose the ordered array of all available
 * LLMProvider instances to consumers that want the full list (e.g. for
 * multi-model orchestration in U5).
 */
export const LLM_PROVIDERS = 'LLM_PROVIDERS';

/**
 * LLMProviderRegistry looks up a provider by its `name` property. Names
 * are matched case-sensitively. Throws an LLMError(UNKNOWN) when a
 * requested provider is not registered; that is the signal for callers to
 * fail fast instead of silently using a wrong model.
 */
@Injectable()
export class LLMProviderRegistry {
  private readonly byName: Map<string, LLMProvider>;

  constructor(@Inject(LLM_PROVIDERS) providers: LLMProvider[]) {
    this.byName = new Map(providers.map((p) => [p.name, p]));
  }

  get(name: string): LLMProvider {
    const provider = this.byName.get(name);
    if (!provider) {
      throw new LLMError(
        LLMErrorCode.UNKNOWN,
        'registry',
        `Provider ${name} not found`,
      );
    }
    return provider;
  }

  getAll(names?: string[]): LLMProvider[] {
    if (!names) {
      return [...this.byName.values()];
    }
    return names.map((n) => this.get(n));
  }

  list(): string[] {
    return [...this.byName.keys()];
  }
}
