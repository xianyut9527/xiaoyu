import { Global, Module } from '@nestjs/common';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { KimiProvider } from './providers/kimi.provider';
import { GLMProvider } from './providers/glm.provider';
import { MockProvider } from './providers/mock.provider';
import { LLMProviderRegistry, LLM_PROVIDERS } from './services/provider.registry';
import { RoutingService } from './services/routing.service';
import { ParallelLLMService } from './services/parallel-llm.service';
import { JudgeService } from './services/judge.service';

/**
 * LLMModule is registered as a global module so that downstream units
 * (U5 orchestrator, U6 controllers, U7 jobs) can inject
 * LLMProviderRegistry without re-importing LLMModule everywhere.
 *
 * The real LLM providers (DeepSeek / Kimi / GLM) will throw in their
 * constructors when their API key env var is missing, which is the
 * intended fail-fast behavior during local development.
 *
 * U5 services (Routing / Parallel / Judge) are registered as ordinary
 * providers and are also exported so U6/U7 can import them through
 * the module without re-providing them.
 */
@Global()
@Module({
  providers: [
    DeepSeekProvider,
    KimiProvider,
    GLMProvider,
    MockProvider,
    {
      provide: LLM_PROVIDERS,
      useFactory: (
        deepseek: DeepSeekProvider,
        kimi: KimiProvider,
        glm: GLMProvider,
        mock: MockProvider,
      ): Array<DeepSeekProvider | KimiProvider | GLMProvider | MockProvider> => [
        deepseek,
        kimi,
        glm,
        mock,
      ],
      inject: [DeepSeekProvider, KimiProvider, GLMProvider, MockProvider],
    },
    LLMProviderRegistry,
    RoutingService,
    ParallelLLMService,
    JudgeService,
  ],
  exports: [
    LLMProviderRegistry,
    LLM_PROVIDERS,
    RoutingService,
    ParallelLLMService,
    JudgeService,
  ],
})
export class LLMModule {}
