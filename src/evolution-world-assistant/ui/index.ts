import { createScriptIdDiv, teleportStyle } from '@util/script';
import App from './App.vue';
import { patchSettings } from '../runtime/settings';

type ScriptButton = {
  name: string;
  visible: boolean;
};

let app: ReturnType<typeof createApp> | null = null;
let destroyStyle: (() => void) | null = null;
let $root: JQuery<HTMLDivElement> | null = null;
let buttonEventStop: EventOnReturn | null = null;

const BUTTON_NAME = 'Evolution 世界助手';

function getGlobalFn<T extends (...args: any[]) => any>(name: string): T | null {
  const runtime = globalThis as Record<string, unknown>;
  const value = runtime[name];
  return _.isFunction(value) ? (value as T) : null;
}

function upsertButtonByUpdate() {
  const update = getGlobalFn<(updater: (buttons: ScriptButton[]) => ScriptButton[]) => ScriptButton[]>('updateScriptButtonsWith');
  if (!update) {
    return false;
  }

  update(buttons => {
    const deduped = buttons.filter(button => button.name !== BUTTON_NAME);
    deduped.push({ name: BUTTON_NAME, visible: true });
    return deduped;
  });
  return true;
}

function upsertButtonByReplace() {
  const replace = getGlobalFn<(buttons: ScriptButton[]) => void>('replaceScriptButtons');
  if (!replace) {
    return false;
  }

  const getButtons = getGlobalFn<() => ScriptButton[]>('getScriptButtons');
  const current = getButtons?.() ?? [];
  const deduped = current.filter(button => button.name !== BUTTON_NAME);
  deduped.push({ name: BUTTON_NAME, visible: true });
  replace(deduped);
  return true;
}

function installToolbarButton() {
  const append = getGlobalFn<(buttons: ScriptButton[]) => void>('appendInexistentScriptButtons');
  if (append) {
    append([{ name: BUTTON_NAME, visible: true }]);
  } else if (!upsertButtonByUpdate() && !upsertButtonByReplace()) {
    throw new Error('script button API unavailable');
  }

  const getEvent = getGlobalFn<(buttonName: string) => string>('getButtonEvent');
  const onEvent = getGlobalFn<(eventType: string, listener: () => void) => EventOnReturn>('eventOn');
  if (!getEvent || !onEvent) {
    throw new Error('button event API unavailable');
  }

  buttonEventStop?.stop();
  buttonEventStop = onEvent(getEvent(BUTTON_NAME), () => {
    patchSettings({ ui_open: true });
  });
}

function uninstallToolbarButton() {
  buttonEventStop?.stop();
  buttonEventStop = null;

  const update = getGlobalFn<(updater: (buttons: ScriptButton[]) => ScriptButton[]) => ScriptButton[]>('updateScriptButtonsWith');
  if (update) {
    update(buttons => buttons.filter(button => button.name !== BUTTON_NAME));
    return;
  }

  const replace = getGlobalFn<(buttons: ScriptButton[]) => void>('replaceScriptButtons');
  const getButtons = getGlobalFn<() => ScriptButton[]>('getScriptButtons');
  if (replace && getButtons) {
    replace(getButtons().filter(button => button.name !== BUTTON_NAME));
  }
}

export function mountUi() {
  if (app) {
    return;
  }

  app = createApp(App).use(createPinia());
  $root = createScriptIdDiv().appendTo('body');
  app.mount($root[0]);

  const style = teleportStyle();
  destroyStyle = style.destroy;

  try {
    installToolbarButton();
  } catch (error) {
    console.error('[Evolution World] toolbar setup failed:', error);
    toastr.error(`工具栏按钮注册失败: ${error instanceof Error ? error.message : String(error)}`, 'Evolution World');
  }
}

export function unmountUi() {
  uninstallToolbarButton();

  app?.unmount();
  app = null;
  $root?.remove();
  $root = null;
  destroyStyle?.();
  destroyStyle = null;
}
