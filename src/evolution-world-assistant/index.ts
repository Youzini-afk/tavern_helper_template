import { initRuntime, disposeRuntime } from './runtime/main';
import { mountUi, unmountUi } from './ui';
import { showEwNotice } from './ui/notice';

const BOOTSTRAP_TIMEOUT_MS = 12_000;
const BOOTSTRAP_POLL_MS = 100;

const REQUIRED_GLOBALS = [
  'getScriptId',
  'getVariables',
  'eventOn',
  'tavern_events',
] as const;

function getMissingGlobals(): string[] {
  const runtime = globalThis as Record<string, unknown>;
  return REQUIRED_GLOBALS.filter(key => runtime[key] === undefined);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function waitForRuntimeGlobals() {
  const startedAt = Date.now();

  while (true) {
    const missing = getMissingGlobals();
    if (missing.length === 0) {
      return;
    }

    if (Date.now() - startedAt >= BOOTSTRAP_TIMEOUT_MS) {
      throw new Error(`runtime globals not ready: ${missing.join(', ')}`);
    }

    await new Promise(resolve => setTimeout(resolve, BOOTSTRAP_POLL_MS));
  }
}

function reportBootstrapError(error: unknown) {
  const reason = formatError(error);
  console.error('[Evolution World] bootstrap failed:', error);
  showEwNotice({
    title: '脚本加载失败',
    message: reason,
    level: 'error',
    duration_ms: 5200,
  });
  toastr.error(`插件加载失败: ${reason}`, 'Evolution World');
}

async function bootstrap() {
  await waitForRuntimeGlobals();
  initRuntime();
  mountUi();
  showEwNotice({
    title: '脚本已加载',
    message: 'Evolution World Assistant 已就绪。',
    level: 'success',
    duration_ms: 3200,
  });
}

$(() => {
  void bootstrap().catch(reportBootstrapError);
});

$(window).on('pagehide', () => {
  try {
    unmountUi();
    disposeRuntime();
  } catch (error) {
    console.error('[Evolution World] dispose failed:', error);
  }
});
