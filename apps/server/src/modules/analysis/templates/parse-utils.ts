/**
 * Strategy template helpers.
 *
 * Shared utilities used by every template (`parseOutput`).
 */

/**
 * Best-effort extraction of a JSON object from a model response.
 *
 * The model is instructed to return strict JSON, but real-world
 * outputs are often wrapped in markdown fences or prefixed with
 * short explanations. This function tries three strategies, in
 * order, before giving up:
 *
 *   1. `JSON.parse` the trimmed content verbatim.
 *   2. Strip ```json ... ``` fences and try again.
 *   3. Scan for the first balanced `{ ... }` block and try again.
 *
 * Returns the parsed object on success, or `null` when no JSON
 * object can be recovered. The caller is expected to fall back
 * to a degraded response (raw content + empty structured object).
 */
export function tryParseStructured(content: string): Record<string, unknown> | null {
  if (typeof content !== 'string' || content.length === 0) {
    return null;
  }

  const trimmed = content.trim();

  // 1) Direct parse.
  const direct = tryParseObject(trimmed);
  if (direct) return direct;

  // 2) Strip ```json ... ``` fences.
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (fenceStripped !== trimmed) {
    const fenced = tryParseObject(fenceStripped);
    if (fenced) return fenced;
  }

  // 3) First balanced { ... } block.
  const start = fenceStripped.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < fenceStripped.length; i++) {
    const ch = fenceStripped[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = fenceStripped.slice(start, i + 1);
        const obj = tryParseObject(candidate);
        if (obj) return obj;
        return null;
      }
    }
  }
  return null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}
