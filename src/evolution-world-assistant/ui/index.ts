import { createScriptIdDiv, teleportStyle } from '@util/script';
import App from './App.vue';
import { patchSettings } from '../runtime/settings';

let app: ReturnType<typeof createApp> | null = null;
let destroyStyle: (() => void) | null = null;
let $root: JQuery<HTMLDivElement> | null = null;
let buttonEventStop: EventOnReturn | null = null;

const BUTTON_NAME = 'Evolution 世界助手';

function installToolbarButton() {
  replaceScriptButtons([{ name: BUTTON_NAME, visible: true }]);
  buttonEventStop?.stop();
  buttonEventStop = eventOn(getButtonEvent(BUTTON_NAME), () => {
    patchSettings({ ui_open: true });
  });
}

function uninstallToolbarButton() {
  buttonEventStop?.stop();
  buttonEventStop = null;
  replaceScriptButtons([]);
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

  installToolbarButton();
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
