import { disposeGlobalApi, initGlobalApi } from './api';
import { disposeRuntimeEvents, initRuntimeEvents } from './events';
import { hydrateSharedSettings, loadLastIo, loadLastRun, loadSettings } from './settings';

let initialized = false;
let initPromise: Promise<void> | null = null;

export async function initRuntime() {
  if (initialized) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    loadSettings();
    loadLastRun();
    loadLastIo();
    await hydrateSharedSettings();
    initGlobalApi();
    initRuntimeEvents();

    if (_.isFunction(initializeGlobal)) {
      initializeGlobal('EvolutionWorldAPI', window.EvolutionWorldAPI ?? {});
    }

    initialized = true;
    console.info('[Evolution World] runtime initialized');
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export function disposeRuntime() {
  if (!initialized) {
    return;
  }

  disposeRuntimeEvents();
  disposeGlobalApi();

  initialized = false;
  console.info('[Evolution World] runtime disposed');
}
