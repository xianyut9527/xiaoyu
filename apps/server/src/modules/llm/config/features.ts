/**
 * Feature flags for LLM orchestration (U5).
 *
 * All flags are read from environment variables at module load time.
 * The defaults below are deliberately conservative: complex routing and
 * the Judge step are *enabled* by default in dev because they are the
 * primary value of U5, but they can be turned off in production by
 * setting the env var to "false".
 *
 * The hard ceiling of 3 parallel models is enforced here as a defence in
 * depth: even if a caller passes more names, `FeatureFlags` caps the
 * final value before any network call is issued.
 */

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || value < min) return min;
  if (value > max) return max;
  return value;
}

function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw !== 'false' && raw !== '0' && raw !== '';
}

/**
 * Read a positive integer env var and clamp it to [min, max].
 * Returns `defaultValue` when the env var is missing or unparsable.
 */
function readIntEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return clamp(parsed, min, max);
}

export interface FeatureFlagsShape {
  COMPLEX_ROUTE_ENABLED: boolean;
  COMPLEX_ROUTE_PARALLEL_MODELS: number;
  JUDGE_ENABLED: boolean;
}

/**
 * Feature flags for LLM orchestration. Read from env vars at module
 * load time (see top of file). Intentionally not frozen so that unit
 * tests can override individual flags with `Object.defineProperty`.
 * Production code should treat this object as immutable.
 */
export const FeatureFlags: FeatureFlagsShape = {
  COMPLEX_ROUTE_ENABLED: readBoolEnv('COMPLEX_ROUTE_ENABLED', true),
  COMPLEX_ROUTE_PARALLEL_MODELS: readIntEnv(
    'COMPLEX_ROUTE_PARALLEL_MODELS',
    3,
    1,
    3,
  ),
  JUDGE_ENABLED: readBoolEnv('JUDGE_ENABLED', true),
};

/**
 * Maximum number of models that can be queried in parallel.
 * Kept as a separate constant so tests and the registry can import
 * the same number without reading env vars directly.
 */
export const MAX_PARALLEL_MODELS = 3;

/**
 * Default timeout (ms) for a single parallel LLM call.
 */
export const DEFAULT_PARALLEL_TIMEOUT_MS = 30_000;

/**
 * Hard ceiling for a single parallel LLM call. The orchestrator
 * clamps its request to `min(DEFAULT_PARALLEL_TIMEOUT_MS,
 * MAX_PARALLEL_TIMEOUT_MS)` so a future change to the default
 * cannot accidentally allow multi-minute waits if the env-driven
 * default is ever bumped.
 */
export const MAX_PARALLEL_TIMEOUT_MS = 30_000;

/**
 * Default timeout (ms) for the Judge call. Slightly tighter than the
 * parallel call because the Judge is the *last* leg of the pipeline
 * and we want to fail fast into the degradation path.
 */
export const DEFAULT_JUDGE_TIMEOUT_MS = 25_000;
