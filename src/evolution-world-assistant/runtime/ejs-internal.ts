/**
 * EJS Internal Engine – self-contained EJS rendering for Evolution World.
 *
 * Unlike ejs-bridge.ts (which depends on ST-Prompt-Template's globalThis.EjsTemplate API),
 * this module bundles the EJS engine directly, providing full control over when and how
 * EJS templates are rendered. Used exclusively for workflow prompt assembly where we need
 * to execute worldbook EJS (e.g., Controller getwi calls) independently from ST's pipeline.
 */

// The EJS library is a UMD bundle that self-registers on globalThis.
// We side-import it so webpack bundles it, then access the global it creates.
import '../libs/ejs';

const ejs = (globalThis as any).ejs as {
  compile(template: string, opts?: Record<string, any>): (...args: any[]) => any;
  render(template: string, data?: Record<string, any>, opts?: Record<string, any>): string;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EjsRenderContext {
  /** All worldbook entries across all lorebooks: key = entry name/comment, value = { content, worldbook } */
  allEntries: Map<string, { content: string; worldbook: string }>;
  /** Already-rendered entries to prevent infinite recursion */
  renderStack: Set<string>;
  /** Maximum recursion depth for getwi calls */
  maxRecursion: number;
}

// ---------------------------------------------------------------------------
// ST Runtime Accessors
// ---------------------------------------------------------------------------

declare const SillyTavern: { getContext(): Record<string, any> } | undefined;

function getStContext(): Record<string, any> {
  try {
    return SillyTavern?.getContext?.() ?? {};
  } catch {
    return {};
  }
}

function getChatMetadataVariables(): Record<string, any> {
  try {
    const ctx = getStContext();
    return ctx.chatMetadata?.variables ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Variable Access (simplified ST-compatible implementation)
// ---------------------------------------------------------------------------

function getVariable(path: string, opts: Record<string, any> = {}): any {
  const vars = getChatMetadataVariables();
  const scope = opts.scope;

  if (scope === 'global') {
    try {
      const ctx = getStContext();
      return _.get(ctx.extensionSettings?.variables?.global ?? {}, path, opts.defaults);
    } catch {
      return opts.defaults;
    }
  }

  if (scope === 'message') {
    // Message-scoped variables are stored per-message; simplified fallback
    return opts.defaults;
  }

  // Default: local (chat) variables
  return _.get(vars, path, opts.defaults);
}

function setVariable(path: string, _value: unknown, _opts: Record<string, any> = {}): void {
  // Write operations are intentionally no-ops during workflow prompt assembly.
  // We only need read access to render the current state.
  console.debug(`[EW EJS Internal] setvar('${path}') suppressed during workflow render`);
}

// ---------------------------------------------------------------------------
// getwi implementation
// ---------------------------------------------------------------------------

async function getwi(
  ctx: EjsRenderContext,
  worldbookOrEntry: string | null,
  entryNameOrData?: string | Record<string, unknown>,
): Promise<string> {
  let entryName: string;

  if (typeof entryNameOrData === 'string') {
    // getwi(worldbook, entryName) form
    entryName = entryNameOrData;
  } else {
    // getwi(entryName) form – worldbookOrEntry is actually the entry name
    entryName = worldbookOrEntry ?? '';
  }

  if (!entryName) return '';

  const entry = ctx.allEntries.get(entryName);
  if (!entry) {
    console.debug(`[EW EJS Internal] getwi: entry '${entryName}' not found`);
    return '';
  }

  // Recursion guard
  if (ctx.renderStack.has(entryName)) {
    console.warn(`[EW EJS Internal] getwi: circular reference detected for '${entryName}'`);
    return entry.content;
  }

  if (ctx.renderStack.size >= ctx.maxRecursion) {
    console.warn(`[EW EJS Internal] getwi: max recursion depth (${ctx.maxRecursion}) reached`);
    return entry.content;
  }

  // If content contains EJS, render it recursively
  if (entry.content.includes('<%')) {
    ctx.renderStack.add(entryName);
    try {
      const rendered = await evalEjsTemplate(entry.content, ctx);
      return rendered;
    } finally {
      ctx.renderStack.delete(entryName);
    }
  }

  return entry.content;
}

// ---------------------------------------------------------------------------
// EJS Template Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate an EJS template with the workflow-specific context.
 *
 * Provides a subset of ST-Prompt-Template's context functions sufficient
 * for rendering worldbook entries including Controller EJS.
 */
export async function evalEjsTemplate(
  content: string,
  renderCtx: EjsRenderContext,
): Promise<string> {
  if (!content.includes('<%')) return content;

  const stCtx = getStContext();

  // Build the evaluation context
  const context: Record<string, any> = {
    // Lodash
    _,

    // Console
    console,

    // Character info
    userName: stCtx.name1 ?? '',
    charName: stCtx.name2 ?? '',
    assistantName: stCtx.name2 ?? '',
    characterId: stCtx.characterId,

    get chatId() {
      return stCtx.chatId ?? '';
    },

    get variables() {
      return getChatMetadataVariables();
    },

    // World info functions
    getwi: (worldbookOrEntry: string | null, entryNameOrData?: string | Record<string, unknown>) =>
      getwi(renderCtx, worldbookOrEntry, entryNameOrData),
    getWorldInfo: (worldbookOrEntry: string | null, entryNameOrData?: string | Record<string, unknown>) =>
      getwi(renderCtx, worldbookOrEntry, entryNameOrData),

    // Variable functions (read-only for workflow assembly)
    getvar: (path: string, opts?: Record<string, any>) => getVariable(path, opts),
    getLocalVar: (path: string, opts: Record<string, any> = {}) => getVariable(path, { ...opts, scope: 'local' }),
    getGlobalVar: (path: string, opts: Record<string, any> = {}) => getVariable(path, { ...opts, scope: 'global' }),
    getMessageVar: (path: string, opts: Record<string, any> = {}) => getVariable(path, { ...opts, scope: 'message' }),

    // Write functions (suppressed)
    setvar: (path: string, value: unknown) => setVariable(path, value),
    setLocalVar: (path: string, value: unknown) => setVariable(path, value),
    setGlobalVar: (path: string, value: unknown) => setVariable(path, value),
    setMessageVar: (path: string, value: unknown) => setVariable(path, value),
    incvar: () => undefined,
    decvar: () => undefined,
    delvar: () => undefined,
    insvar: () => undefined,
    incLocalVar: () => undefined,
    incGlobalVar: () => undefined,
    incMessageVar: () => undefined,
    decLocalVar: () => undefined,
    decGlobalVar: () => undefined,
    decMessageVar: () => undefined,
    patchVariables: () => undefined,

    // World info activation (no-op in this context)
    activewi: async () => null,

    // Print function for EJS
    print: (...args: any[]) => args.filter(x => x !== undefined && x !== null).join(''),
  };

  try {
    const compiled = ejs.compile(content, {
      async: true,
      outputFunctionName: 'print',
      _with: true,
      localsName: 'locals',
      client: true,
    });
    const result = await compiled.call(context, context, (s: string) => s, () => ({ filename: '', template: '' }), rethrow);
    return result ?? '';
  } catch (e) {
    console.warn('[EW EJS Internal] Template render failed:', e);
    // Return raw content on failure rather than breaking the pipeline
    return content;
  }
}

function rethrow(err: Error, str: string, _flnm: string, lineno: number) {
  const lines = str.split('\n');
  const start = Math.max(lineno - 3, 0);
  const end = Math.min(lines.length, lineno + 3);
  const context = lines.slice(start, end).map((line, i) => {
    const curr = i + start + 1;
    return (curr === lineno ? ' >> ' : '    ') + curr + '| ' + line;
  }).join('\n');
  err.message = 'ejs:' + lineno + '\n' + context + '\n\n' + err.message;
  throw err;
}

/**
 * Create a render context from a flat list of worldbook entries.
 */
export function createRenderContext(
  entries: Array<{ name: string; content: string; worldbook: string }>,
  maxRecursion = 10,
): EjsRenderContext {
  const allEntries = new Map<string, { content: string; worldbook: string }>();
  for (const entry of entries) {
    // Use entry name (comment) as key; last-write-wins for duplicates
    allEntries.set(entry.name, { content: entry.content, worldbook: entry.worldbook });
  }
  return {
    allEntries,
    renderStack: new Set(),
    maxRecursion,
  };
}
