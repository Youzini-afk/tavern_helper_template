/**
 * EJS Bridge – thin wrapper around ST-Prompt-Template's globalThis.EjsTemplate.
 *
 * Provides safe EJS rendering for the Evolution World workflow pipeline:
 *  - `renderEjsContent`  – full render (side-effects allowed, for prompt assembly)
 *  - `renderEjsReadOnly` – read-only render (side-effects suppressed, for worldbook snapshots)
 *  - `checkEjsSyntax`    – syntax-only validation (for AI-generated EJS)
 *
 * All functions gracefully degrade when ST-Prompt-Template is not installed.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EjsTemplateApi {
  evalTemplate: (code: string, context: Record<string, unknown> | null, options?: Record<string, unknown>) => Promise<string>;
  prepareContext: (context?: Record<string, unknown>, end?: number) => Promise<Record<string, unknown>>;
  getSyntaxErrorInfo: (code: string, maxLines?: number) => string | null;
}

function getEjsApi(): EjsTemplateApi | null {
  const api = (globalThis as any).EjsTemplate;
  if (api && typeof api.evalTemplate === 'function') return api as EjsTemplateApi;
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Whether the ST-Prompt-Template extension is loaded and its API is available. */
export function isEjsAvailable(): boolean {
  return getEjsApi() !== null;
}

/**
 * Render EJS content with full capabilities (side-effects allowed).
 *
 * Use this for **prompt assembly** where EJS tags in user-defined prompts
 * should behave exactly as they would in the main ST generation pipeline.
 *
 * If ST-Prompt-Template is not loaded or the content contains no EJS tags,
 * returns the original content unchanged.
 */
export async function renderEjsContent(content: string): Promise<string> {
  const api = getEjsApi();
  if (!api || !content.includes('<%')) return content;
  try {
    const ctx = await api.prepareContext();
    return await api.evalTemplate(content, ctx, { logging: false });
  } catch (e) {
    console.warn('[Evolution World] EJS render failed, returning raw content:', e);
    return content;
  }
}

/**
 * Render EJS content in **read-only mode** (all write side-effects suppressed).
 *
 * Use this for **worldbook snapshots** where we want to evaluate controller
 * logic (getvar, getwi) to see the *rendered* persona, but must NOT mutate
 * any variables or activate any world-info entries.
 *
 * Suppressed functions: setvar, incvar, decvar, delvar, insvar,
 * setLocalVar, setGlobalVar, setMessageVar, incLocalVar, incGlobalVar,
 * incMessageVar, decLocalVar, decGlobalVar, decMessageVar,
 * patchVariables, activewi.
 */
export async function renderEjsReadOnly(content: string): Promise<string> {
  const api = getEjsApi();
  if (!api || !content.includes('<%')) return content;

  const ctx = await api.prepareContext();

  // Replace all write-capable functions with no-ops.
  const noop = () => undefined;
  const asyncNoop = async () => null;

  // Variable writes
  ctx.setvar = noop;
  ctx.incvar = noop;
  ctx.decvar = noop;
  ctx.delvar = noop;
  ctx.insvar = noop;
  ctx.setLocalVar = noop;
  ctx.setGlobalVar = noop;
  ctx.setMessageVar = noop;
  ctx.incLocalVar = noop;
  ctx.incGlobalVar = noop;
  ctx.incMessageVar = noop;
  ctx.decLocalVar = noop;
  ctx.decGlobalVar = noop;
  ctx.decMessageVar = noop;
  ctx.patchVariables = noop;

  // World-info activation
  ctx.activewi = asyncNoop;

  try {
    return await api.evalTemplate(content, ctx, { logging: false });
  } catch (e) {
    console.warn('[Evolution World] EJS read-only render failed, returning raw content:', e);
    return content;
  }
}

/**
 * Check EJS syntax without executing.
 *
 * @returns A human-readable error string if syntax is invalid, or `null` if valid.
 */
export function checkEjsSyntax(content: string): string | null {
  const api = getEjsApi();
  if (!api || !content.includes('<%')) return null;
  return api.getSyntaxErrorInfo(content);
}
