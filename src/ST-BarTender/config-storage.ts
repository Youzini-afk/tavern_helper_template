/**
 * File-based config storage via ST's /api/files endpoint.
 *
 * Stores per-preset widgetConfig + chatHistory as JSON files,
 * with a mapping table (preset name → UUID) for persistence.
 *
 * File naming: bt__mapping.json, bt__config__{uuid}.json
 * (flat layout — ST file API doesn't support subdirectories)
 */

import type { WidgetConfig, ChatMessage } from './schema';

// ── Types ────────────────────────────────────────────────────

export type PresetMapping = Record<string, string>; // presetName → uuid

export type PresetConfigData = {
  version: 1;
  preset_name: string;
  updated_at: string;
  widget_config: WidgetConfig;
  chat_history: ChatMessage[];
};

// ── Helpers ──────────────────────────────────────────────────

const MAPPING_FILE = 'bt__mapping.json';

function configFileName(uuid: string): string {
  return `bt__config__${uuid}.json`;
}

/** 获取父窗口 (iframe 场景) */
function getParentWindow(): Window {
  try {
    return (window.parent && window.parent !== window) ? window.parent : window;
  } catch { return window; }
}

/** 获取 ST 请求头 (含 CSRF) */
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const parentWin = getParentWindow();
  const stApi = (
    typeof SillyTavern !== 'undefined'
      ? SillyTavern
      : (parentWin as any).SillyTavern
  ) as typeof SillyTavern | undefined;

  if (stApi?.getRequestHeaders) {
    Object.assign(headers, stApi.getRequestHeaders());
  }
  return headers;
}

/** 获取 parentWin 的 fetch (避免 iframe CORS 问题) */
function getFetch(): typeof fetch {
  const parentWin = getParentWindow();
  return parentWin.fetch.bind(parentWin);
}

// ── Low-level File I/O ───────────────────────────────────────

async function writeFile(fileName: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  const base64 = btoa(unescape(encodeURIComponent(json)));

  const resp = await getFetch()('/api/files/upload', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ name: fileName, data: base64 }),
  });

  if (!resp.ok) {
    throw new Error(`[BarTender] Failed to write file "${fileName}": ${resp.status}`);
  }
  console.debug(`[BarTender] File written: ${fileName}`);
}

async function readFile<T>(fileName: string): Promise<T | null> {
  try {
    const resp = await getFetch()(`/user/files/${fileName}`);
    if (!resp.ok) return null;
    return await resp.json() as T;
  } catch (e) {
    console.warn(`[BarTender] Failed to read file "${fileName}":`, e);
    return null;
  }
}

async function deleteFile(fileName: string): Promise<void> {
  try {
    await getFetch()('/api/files/delete', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ path: `user/files/${fileName}` }),
    });
    console.debug(`[BarTender] File deleted: ${fileName}`);
  } catch (e) {
    console.warn(`[BarTender] Failed to delete file "${fileName}":`, e);
  }
}

// ── Mapping ──────────────────────────────────────────────────

export async function loadMapping(): Promise<PresetMapping> {
  return (await readFile<PresetMapping>(MAPPING_FILE)) ?? {};
}

export async function saveMapping(mapping: PresetMapping): Promise<void> {
  await writeFile(MAPPING_FILE, mapping);
}

// ── Config CRUD ──────────────────────────────────────────────

export async function savePresetConfig(
  presetName: string,
  mapping: PresetMapping,
  widgetConfig: WidgetConfig,
  chatHistory: ChatMessage[],
): Promise<PresetMapping> {
  // 获取或创建 UUID
  let uuid = mapping[presetName];
  if (!uuid) {
    uuid = crypto.randomUUID?.() ?? generateFallbackUUID();
    mapping[presetName] = uuid;
  }

  const data: PresetConfigData = {
    version: 1,
    preset_name: presetName,
    updated_at: new Date().toISOString(),
    widget_config: widgetConfig,
    chat_history: chatHistory,
  };

  await Promise.all([
    writeFile(configFileName(uuid), data),
    saveMapping(mapping),
  ]);

  return mapping;
}

export async function loadPresetConfig(
  presetName: string,
  mapping: PresetMapping,
): Promise<PresetConfigData | null> {
  const uuid = mapping[presetName];
  if (!uuid) return null;

  return readFile<PresetConfigData>(configFileName(uuid));
}

export async function deletePresetConfig(
  presetName: string,
  mapping: PresetMapping,
): Promise<PresetMapping> {
  const uuid = mapping[presetName];
  if (uuid) {
    await deleteFile(configFileName(uuid));
    delete mapping[presetName];
    await saveMapping(mapping);
  }
  return mapping;
}

// ── Rename Detection ─────────────────────────────────────────

/**
 * 检测预设改名：比较映射表中的名字与当前所有预设名。
 * 如果映射中有名字不在预设列表中，且列表中恰好有一个新名字不在映射中，
 * 则认为发生了重命名，自动迁移映射。
 */
export async function detectAndFixRenames(
  mapping: PresetMapping,
): Promise<{ mapping: PresetMapping; renamed: Array<{ from: string; to: string }> }> {
  let allNames: string[];
  try {
    allNames = getPresetNames();
  } catch {
    return { mapping, renamed: [] };
  }

  const allNamesSet = new Set(allNames);
  const mappedNames = Object.keys(mapping);

  // 找出映射中缺失的名字 (可能被重命名了)
  const missing = mappedNames.filter(n => !allNamesSet.has(n));
  // 找出预设列表中没有映射的新名字
  const unmapped = allNames.filter(n => !(n in mapping));

  const renamed: Array<{ from: string; to: string }> = [];

  if (missing.length === 1 && unmapped.length === 1) {
    // 单一候选，几乎确定是改名
    const [oldName] = missing;
    const [newName] = unmapped;
    mapping[newName] = mapping[oldName];
    delete mapping[oldName];
    renamed.push({ from: oldName, to: newName });

    // 更新配置文件中的 preset_name
    const uuid = mapping[newName];
    const config = await readFile<PresetConfigData>(configFileName(uuid));
    if (config) {
      config.preset_name = newName;
      await writeFile(configFileName(uuid), config);
    }

    await saveMapping(mapping);
    console.info(`[BarTender] Preset renamed: "${oldName}" → "${newName}"`);
  } else if (missing.length > 0) {
    // 多个缺失，无法确定对应关系，暂不处理
    console.warn(`[BarTender] ${missing.length} mapped presets not found, cannot auto-rename:`, missing);
  }

  return { mapping, renamed };
}

// ── Fallback UUID ────────────────────────────────────────────

function generateFallbackUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
