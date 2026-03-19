import { buildMessageVersionKey, getMessageVersionInfo, resolveControllerSnapshotEntryName } from './helpers';
import {
  buildFileName,
  cleanupSnapshotFiles,
  deleteSnapshot,
  readSnapshotStore,
  writeSnapshot,
  writeSnapshotStore,
  type SnapshotData,
  type SnapshotVersionStore,
} from './snapshot-storage';
import { ControllerEntrySnapshot, EwSettings } from './types';
import { ensureDefaultEntry, resolveTargetWorldbook } from './worldbook-runtime';

const EW_FLOOR_DATA_KEY = 'ew_entries';
const EW_CONTROLLER_DATA_KEY = 'ew_controller';
const EW_CONTROLLERS_DATA_KEY = 'ew_controllers';
const EW_DYN_SNAPSHOTS_KEY = 'ew_dyn_snapshots';
const EW_SNAPSHOT_FILE_KEY = 'ew_snapshot_file';
const EW_SWIPE_ID_KEY = 'ew_snapshot_swipe_id';
const EW_CONTENT_HASH_KEY = 'ew_snapshot_content_hash';
const EW_INLINE_SNAPSHOT_VERSIONS_KEY = 'ew_snapshot_versions';

export type FloorSnapshotReadResolution =
  | 'exact'
  | 'single_fallback'
  | 'same_swipe_fallback'
  | 'latest_fallback'
  | 'missing';

type SnapshotReadMode = 'strict' | 'history';

type SnapshotVersionSource = {
  source: 'file' | 'inline';
  versions: Record<string, SnapshotData>;
  fileName?: string;
};

type SnapshotReadResult = {
  snapshot: SnapshotData | null;
  resolution: FloorSnapshotReadResolution;
  available_version_count: number;
  source: 'file' | 'inline' | 'none';
  matched_version_key?: string;
  file_name?: string;
};

export type DynSnapshot = { name: string; content: string; enabled: boolean };

function normalizeDynSnapshot(snapshot: DynSnapshot): DynSnapshot {
  return {
    ...snapshot,
    enabled: false,
  };
}

function normalizeControllerSnapshot(snapshot: ControllerEntrySnapshot): ControllerEntrySnapshot {
  return {
    entry_name: String(snapshot.entry_name ?? '').trim(),
    content: String(snapshot.content ?? ''),
    flow_id: snapshot.flow_id ? String(snapshot.flow_id) : undefined,
    flow_name: snapshot.flow_name ? String(snapshot.flow_name) : undefined,
    legacy: Boolean(snapshot.legacy),
  };
}

function controllerSnapshotKey(snapshot: ControllerEntrySnapshot): string {
  return String(snapshot.flow_id ?? snapshot.entry_name ?? snapshot.flow_name ?? 'legacy');
}

const floorBindingListenerStops: EventOnReturn[] = [];
const observedMessageVersionKeys = new Map<number, string>();
let floorBindingRestoreTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFloorBindingRestore(getSettings: () => EwSettings, delayMs: number): void {
  if (floorBindingRestoreTimer) {
    clearTimeout(floorBindingRestoreTimer);
  }

  floorBindingRestoreTimer = setTimeout(() => {
    floorBindingRestoreTimer = null;

    const freshSettings = getSettings();
    if (!freshSettings.enabled || !freshSettings.floor_binding_enabled) {
      return;
    }

    void onChatChanged(freshSettings);
  }, delayMs);
}

function clearInlineSnapshotFields(data: Record<string, unknown>) {
  delete data[EW_CONTROLLER_DATA_KEY];
  delete data[EW_CONTROLLERS_DATA_KEY];
  delete data[EW_DYN_SNAPSHOTS_KEY];
  delete data[EW_SWIPE_ID_KEY];
  delete data[EW_CONTENT_HASH_KEY];
  delete data[EW_INLINE_SNAPSHOT_VERSIONS_KEY];
}

function clearFloorSnapshotFields(data: Record<string, unknown>) {
  delete data[EW_FLOOR_DATA_KEY];
  clearInlineSnapshotFields(data);
  delete data[EW_SNAPSHOT_FILE_KEY];
}

// ── Context Helpers ──────────────────────────────────────────

function getCharName(): string {
  return getCurrentCharacterName() ?? 'unknown';
}

function getChatId(): string {
  return String(SillyTavern.getCurrentChatId?.() ?? SillyTavern.chatId ?? 'unknown');
}

function refreshObservedMessageVersions(): void {
  observedMessageVersionKeys.clear();
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return;
  }

  const allMessages = getChatMessages(`0-${lastId}`);
  for (const msg of allMessages) {
    observedMessageVersionKeys.set(msg.message_id, getMessageVersionInfo(msg).version_key);
  }
}

function shouldReactToVisibleVersionMutation(messageId: number): boolean {
  const msg = getChatMessages(messageId)[0];
  if (!msg) {
    return false;
  }

  const nextVersionKey = getMessageVersionInfo(msg).version_key;
  const prevVersionKey = observedMessageVersionKeys.get(messageId);
  observedMessageVersionKeys.set(messageId, nextVersionKey);
  return prevVersionKey !== nextVersionKey;
}

function getMessageSnapshotFileCandidates(msg: any): string[] {
  const candidates: string[] = [];
  const explicit = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
  if (typeof explicit === 'string' && explicit.trim()) {
    candidates.push(explicit.trim());
  }

  const messageId = Number(msg?.message_id);
  if (Number.isFinite(messageId) && messageId >= 0) {
    const inferred = buildFileName(getCharName(), getChatId(), messageId);
    if (inferred && !candidates.includes(inferred)) {
      candidates.push(inferred);
    }
  }

  return candidates;
}

function buildSnapshotReadResult(
  source: SnapshotVersionSource | null,
  resolution: FloorSnapshotReadResolution,
  snapshot: SnapshotData | null,
  matchedVersionKey?: string,
): SnapshotReadResult {
  const availableVersionCount = source ? Object.keys(source.versions).length : 0;
  return {
    snapshot,
    resolution,
    available_version_count: availableVersionCount,
    source: source?.source ?? 'none',
    matched_version_key: matchedVersionKey,
    file_name: source?.fileName,
  };
}

function getVersionEntries(versions: Record<string, SnapshotData>): Array<[string, SnapshotData]> {
  return Object.entries(versions) as Array<[string, SnapshotData]>;
}

function selectSnapshotFromSources(
  sources: SnapshotVersionSource[],
  versionInfo: ReturnType<typeof getMessageVersionInfo>,
  mode: SnapshotReadMode,
): SnapshotReadResult {
  for (const source of sources) {
    const exact = source.versions[versionInfo.version_key];
    if (exact) {
      return buildSnapshotReadResult(source, 'exact', exact, versionInfo.version_key);
    }
  }

  for (const source of sources) {
    const entries = getVersionEntries(source.versions);
    if (entries.length === 1) {
      const [matchedVersionKey, snapshot] = entries[0];
      return buildSnapshotReadResult(source, 'single_fallback', snapshot, matchedVersionKey);
    }
  }

  if (mode === 'strict') {
    return buildSnapshotReadResult(null, 'missing', null);
  }

  for (const source of sources) {
    const entries = getVersionEntries(source.versions);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [matchedVersionKey, snapshot] = entries[i];
      if (Number(snapshot?.swipe_id ?? -1) === versionInfo.swipe_id) {
        return buildSnapshotReadResult(source, 'same_swipe_fallback', snapshot, matchedVersionKey);
      }
    }
  }

  for (const source of sources) {
    const entries = getVersionEntries(source.versions);
    if (entries.length > 0) {
      const [matchedVersionKey, snapshot] = entries[entries.length - 1];
      return buildSnapshotReadResult(source, 'latest_fallback', snapshot, matchedVersionKey);
    }
  }

  return buildSnapshotReadResult(null, 'missing', null);
}

async function loadSnapshotVersionSources(msg: any): Promise<SnapshotVersionSource[]> {
  const sources: SnapshotVersionSource[] = [];

  for (const fileName of getMessageSnapshotFileCandidates(msg)) {
    const store = await readSnapshotStore(fileName);
    if (!store || Object.keys(store.versions).length === 0) {
      continue;
    }

    sources.push({
      source: 'file',
      versions: store.versions,
      fileName,
    });
  }

  const inlineVersions = readInlineSnapshotVersions(msg.data ?? {});
  if (Object.keys(inlineVersions).length > 0) {
    sources.push({
      source: 'inline',
      versions: inlineVersions,
    });
  }

  return sources;
}

async function readSnapshotForMessageDetailed(msg: any, mode: SnapshotReadMode): Promise<SnapshotReadResult> {
  const sources = await loadSnapshotVersionSources(msg);
  if (sources.length === 0) {
    return buildSnapshotReadResult(null, 'missing', null);
  }

  return selectSnapshotFromSources(sources, getMessageVersionInfo(msg), mode);
}

async function readSnapshotForMessage(msg: any): Promise<SnapshotData | null> {
  return (await readSnapshotForMessageDetailed(msg, 'strict')).snapshot;
}

export async function pinMessageSnapshotToCurrentVersion(messageId: number): Promise<boolean> {
  const msg = getChatMessages(messageId)[0];
  if (!msg) {
    return false;
  }

  const versionInfo = getMessageVersionInfo(msg);
  const currentVersionKey = versionInfo.version_key;
  const readResult = await readSnapshotForMessageDetailed(msg, 'history');
  if (!readResult.snapshot || readResult.source === 'none') {
    return false;
  }

  const nextData: Record<string, unknown> = {
    ...(msg.data ?? {}),
  };
  let mutated = false;

  const syncVisibleVersionMetadata = () => {
    if (Number(nextData[EW_SWIPE_ID_KEY] ?? -1) !== versionInfo.swipe_id) {
      nextData[EW_SWIPE_ID_KEY] = versionInfo.swipe_id;
      mutated = true;
    }

    const currentHash = typeof nextData[EW_CONTENT_HASH_KEY] === 'string' ? String(nextData[EW_CONTENT_HASH_KEY]) : '';
    const targetHash = String(versionInfo.content_hash ?? '').trim();
    if (currentHash !== targetHash) {
      if (targetHash) {
        nextData[EW_CONTENT_HASH_KEY] = targetHash;
      } else {
        delete nextData[EW_CONTENT_HASH_KEY];
      }
      mutated = true;
    }
  };

  if (readResult.source === 'file' && readResult.file_name) {
    const currentFileRef =
      typeof nextData[EW_SNAPSHOT_FILE_KEY] === 'string' ? String(nextData[EW_SNAPSHOT_FILE_KEY]).trim() : '';
    const store = await readSnapshotStore(readResult.file_name);
    if (!store) {
      return false;
    }

    if (readResult.resolution !== 'exact') {
      store.versions[currentVersionKey] = {
        ...readResult.snapshot,
        swipe_id: versionInfo.swipe_id,
        content_hash: versionInfo.content_hash,
      };
      await writeSnapshotStore(readResult.file_name, store);
      mutated = true;
    }

    if (currentFileRef !== readResult.file_name) {
      nextData[EW_SNAPSHOT_FILE_KEY] = readResult.file_name;
      mutated = true;
    }

    syncVisibleVersionMetadata();
  } else if (readResult.source === 'inline') {
    const inlineVersions = readInlineSnapshotVersions(msg.data ?? {});
    if (!inlineVersions[currentVersionKey]) {
      inlineVersions[currentVersionKey] = {
        ...readResult.snapshot,
        swipe_id: versionInfo.swipe_id,
        content_hash: versionInfo.content_hash,
      };
      writeInlineSnapshotVersions(nextData, inlineVersions);
      mutated = true;
    }

    syncVisibleVersionMetadata();
  }

  if (!mutated) {
    return false;
  }

  observedMessageVersionKeys.set(messageId, currentVersionKey);
  await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
  return true;
}

// ── Legacy upgrade helpers ───────────────────────────────────

/**
 * Read inline snapshot fields from message data, handling both legacy (single
 * controller string) and new (controllers record) formats.
 */
function readLegacyInlineSnapshot(data: Record<string, unknown>): SnapshotData | null {
  const snapshots = _.get(data, EW_DYN_SNAPSHOTS_KEY) as DynSnapshot[] | undefined;

  const controllersArray = _.get(data, EW_CONTROLLERS_DATA_KEY) as ControllerEntrySnapshot[] | undefined;
  const inlineSwipeId = typeof data[EW_SWIPE_ID_KEY] === 'number' ? (data[EW_SWIPE_ID_KEY] as number) : undefined;
  const inlineContentHash =
    typeof data[EW_CONTENT_HASH_KEY] === 'string' ? (data[EW_CONTENT_HASH_KEY] as string) : undefined;
  if (Array.isArray(controllersArray)) {
    return {
      controllers: controllersArray.map(normalizeControllerSnapshot).filter(entry => entry.content),
      dyn_entries: Array.isArray(snapshots) ? snapshots : [],
      swipe_id: inlineSwipeId,
      content_hash: inlineContentHash,
    };
  }

  const controllersRaw = _.get(data, EW_CONTROLLERS_DATA_KEY) as Record<string, string> | undefined;
  if (controllersRaw && typeof controllersRaw === 'object' && !Array.isArray(controllersRaw)) {
    return {
      controllers: Object.entries(controllersRaw).map(([key, value]) =>
        normalizeControllerSnapshot({
          entry_name: key.startsWith('EW/Controller/') ? key : '',
          flow_name: key.startsWith('EW/Controller/') ? undefined : key,
          content: String(value ?? ''),
          legacy: key === 'legacy',
        }),
      ),
      dyn_entries: Array.isArray(snapshots) ? snapshots : [],
      swipe_id: inlineSwipeId,
      content_hash: inlineContentHash,
    };
  }

  const ctrlSnap = _.get(data, EW_CONTROLLER_DATA_KEY) as string | undefined;
  if ((Array.isArray(snapshots) && snapshots.length > 0) || (typeof ctrlSnap === 'string' && ctrlSnap.length > 0)) {
    return {
      controllers: ctrlSnap
        ? [
            normalizeControllerSnapshot({
              entry_name: '',
              flow_name: 'Legacy Controller',
              content: ctrlSnap,
              legacy: true,
            }),
          ]
        : [],
      dyn_entries: Array.isArray(snapshots) ? snapshots : [],
      swipe_id: inlineSwipeId,
      content_hash: inlineContentHash,
    };
  }

  return null;
}

function normalizeInlineSnapshotVersions(raw: unknown): Record<string, SnapshotData> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const versions: Record<string, SnapshotData> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const upgraded = value as SnapshotData;
    versions[String(key)] = {
      controllers: Array.isArray(upgraded.controllers)
        ? upgraded.controllers.map(normalizeControllerSnapshot).filter(entry => entry.content)
        : [],
      dyn_entries: Array.isArray(upgraded.dyn_entries) ? upgraded.dyn_entries : [],
      swipe_id: typeof upgraded.swipe_id === 'number' ? upgraded.swipe_id : undefined,
      content_hash: typeof upgraded.content_hash === 'string' ? upgraded.content_hash : undefined,
    };
  }
  return versions;
}

function readInlineSnapshotVersions(data: Record<string, unknown>): Record<string, SnapshotData> {
  const rawVersions = data[EW_INLINE_SNAPSHOT_VERSIONS_KEY];
  const normalized = normalizeInlineSnapshotVersions(rawVersions);
  if (Object.keys(normalized).length > 0) {
    return normalized;
  }

  const legacy = readLegacyInlineSnapshot(data);
  if (!legacy) {
    return {};
  }

  return {
    [buildMessageVersionKey(Number(legacy.swipe_id ?? 0), String(legacy.content_hash ?? '').trim())]: legacy,
  };
}

function readInlineSnapshot(data: Record<string, unknown>, versionKey?: string): SnapshotData | null {
  const versions = readInlineSnapshotVersions(data);
  if (versionKey) {
    return versions[versionKey] ?? null;
  }

  const values = Object.values(versions);
  return values.length === 1 ? values[0] : null;
}

function writeInlineSnapshotVersions(nextData: Record<string, unknown>, versions: Record<string, SnapshotData>) {
  nextData[EW_INLINE_SNAPSHOT_VERSIONS_KEY] = versions;
}

function buildSnapshotStoreFromVersions(versions: Record<string, SnapshotData>): SnapshotVersionStore {
  return {
    version: 'ew-snapshot/v2',
    updated_at: Date.now(),
    versions: { ...versions },
  };
}

// ── Floor Marking ────────────────────────────────────────────

/**
 * Mark floor entries: write snapshot data to the appropriate storage backend.
 *
 * - message_data mode: snapshots stored directly in msg.data
 * - file mode: snapshots written to ST server file, msg.data stores filename reference
 */
export async function markFloorEntries(
  settings: EwSettings,
  messageId: number,
  entryNames: string[],
  controllerSnapshots?: ControllerEntrySnapshot[],
  dynSnapshots?: DynSnapshot[],
  swipeId?: number,
  contentHash?: string,
): Promise<void> {
  const messages = getChatMessages(messageId);
  if (messages.length === 0) {
    console.warn(`[Evolution World] markFloorEntries: message #${messageId} not found, snapshot DROPPED`);
    return;
  }

  const msg = messages[0];
  const previousSnapshotFile = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
  const versionKey = buildMessageVersionKey(Number(swipeId ?? 0), String(contentHash ?? '').trim());
  const normalizedEntryNames = _.uniq(entryNames.filter(name => typeof name === 'string' && name.trim()));
  const normalizedDynSnapshots = (dynSnapshots ?? [])
    .filter(snap => snap.name && typeof snap.content === 'string')
    .map(normalizeDynSnapshot);
  const normalizedControllerSnapshots = (controllerSnapshots ?? [])
    .map(snapshot =>
      normalizeControllerSnapshot({
        entry_name: snapshot.entry_name,
        content: snapshot.content,
        flow_id: snapshot.flow_id,
        flow_name: snapshot.flow_name,
      }),
    )
    .filter(snapshot => snapshot.content);
  const hasSnapshotPayload = Boolean(
    normalizedControllerSnapshots.length > 0 || normalizedDynSnapshots.length > 0 || normalizedEntryNames.length > 0,
  );

  const nextData: Record<string, unknown> = {
    ...msg.data,
  };
  clearFloorSnapshotFields(nextData);

  if (!hasSnapshotPayload) {
    if (typeof previousSnapshotFile === 'string' && previousSnapshotFile) {
      const existingStore = await readSnapshotStore(previousSnapshotFile);
      if (existingStore) {
        delete existingStore.versions[versionKey];
        if (Object.keys(existingStore.versions).length > 0) {
          await writeSnapshotStore(previousSnapshotFile, existingStore);
          nextData[EW_SNAPSHOT_FILE_KEY] = previousSnapshotFile;
        } else {
          await deleteSnapshot(previousSnapshotFile);
        }
      } else {
        await deleteSnapshot(previousSnapshotFile);
      }
    }

    const inlineVersions = readInlineSnapshotVersions(msg.data ?? {});
    if (Object.keys(inlineVersions).length > 0) {
      delete inlineVersions[versionKey];
      if (Object.keys(inlineVersions).length > 0) {
        writeInlineSnapshotVersions(nextData, inlineVersions);
      }
    }

    observedMessageVersionKeys.set(messageId, versionKey);
    await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
    return;
  }

  if (normalizedEntryNames.length > 0) {
    nextData[EW_FLOOR_DATA_KEY] = normalizedEntryNames;
  }

  if (settings.snapshot_storage === 'file') {
    // File mode: rewrite the per-message snapshot store and pin current version in msg.data.
    const snapshotData: SnapshotData = {
      controllers: normalizedControllerSnapshots,
      dyn_entries: normalizedDynSnapshots,
      swipe_id: swipeId ?? 0,
      content_hash: contentHash,
    };
    try {
      const fileName = await writeSnapshot(getCharName(), getChatId(), messageId, snapshotData);
      nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
      nextData[EW_SWIPE_ID_KEY] = swipeId ?? 0;
      if (contentHash) nextData[EW_CONTENT_HASH_KEY] = contentHash;
    } catch (e) {
      console.warn('[Evolution World] File snapshot write failed, falling back to message data:', e);
      const inlineVersions = readInlineSnapshotVersions(msg.data ?? {});
      inlineVersions[versionKey] = {
        controllers: normalizedControllerSnapshots,
        dyn_entries: normalizedDynSnapshots,
        swipe_id: swipeId ?? 0,
        content_hash: contentHash,
      };
      writeInlineSnapshotVersions(nextData, inlineVersions);
      nextData[EW_SWIPE_ID_KEY] = swipeId ?? 0;
      if (contentHash) nextData[EW_CONTENT_HASH_KEY] = contentHash;
    }
  } else {
    // Message data mode: persist all known versions inline and pin current version in msg.data.
    const inlineVersions = readInlineSnapshotVersions(msg.data ?? {});
    inlineVersions[versionKey] = {
      controllers: normalizedControllerSnapshots,
      dyn_entries: normalizedDynSnapshots,
      swipe_id: swipeId ?? 0,
      content_hash: contentHash,
    };
    writeInlineSnapshotVersions(nextData, inlineVersions);
    nextData[EW_SWIPE_ID_KEY] = swipeId ?? 0;
    if (contentHash) nextData[EW_CONTENT_HASH_KEY] = contentHash;
    if (typeof previousSnapshotFile === 'string' && previousSnapshotFile) {
      await deleteSnapshot(previousSnapshotFile);
    }
  }

  observedMessageVersionKeys.set(messageId, versionKey);
  await setChatMessages([{ message_id: messageId, data: nextData }], { refresh: 'none' });
}

function hasAnySnapshotReferences(messages: any[]): boolean {
  return messages.some(msg => {
    const data = (msg?.data ?? {}) as Record<string, unknown>;
    return Boolean(
      data[EW_SNAPSHOT_FILE_KEY] ||
      data[EW_INLINE_SNAPSHOT_VERSIONS_KEY] ||
      data[EW_CONTROLLER_DATA_KEY] ||
      data[EW_CONTROLLERS_DATA_KEY] ||
      data[EW_DYN_SNAPSHOTS_KEY],
    );
  });
}

// ── Floor Query ──────────────────────────────────────────────

/**
 * Get the EW/Dyn/ entry names bound to a specific floor.
 */
export function getFloorEntryNames(messageId: number): string[] {
  const messages = getChatMessages(messageId);
  if (messages.length === 0) {
    return [];
  }
  return _.get(messages[0].data, EW_FLOOR_DATA_KEY, []);
}

// ── Unified Snapshot Collection ──────────────────────────────

/**
 * Scan all surviving messages and return the latest snapshots.
 *
 * Checks BOTH storage backends (message data and file) so that
 * mixed-mode chats work correctly (e.g. user switched mode mid-chat).
 * The latest snapshot (by message position) wins.
 */
export async function collectLatestSnapshots(): Promise<{
  controllers: ControllerEntrySnapshot[];
  dyn: Map<string, DynSnapshot>;
}> {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return { controllers: [], dyn: new Map() };
  }

  const allMessages = getChatMessages(`0-${lastId}`);

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    const snapshot = await readSnapshotForMessage(msg);
    if (!snapshot) {
      continue;
    }

    const dynMap = new Map<string, DynSnapshot>();
    for (const snap of snapshot.dyn_entries) {
      if (snap.name && typeof snap.content === 'string') {
        dynMap.set(snap.name, snap);
      }
    }
    return {
      controllers: snapshot.controllers.map(normalizeControllerSnapshot).filter(e => e.content),
      dyn: dynMap,
    };
  }

  return { controllers: [], dyn: new Map() };
}

// ── Unified Purge + Restore ─────────────────────────────────

/**
 * Purge all EW-generated entries from worldbook, then restore from the
 * current chat's latest surviving snapshots.
 *
 * Unified handler for all CHAT_CHANGED events:
 *   Delete floor  → deleted message's snapshot gone → restores previous state (rollback)
 *   New chat      → no snapshots → clean slate
 *   Switch back   → old chat's snapshots survive → full restore
 */
export async function purgeAndRestoreForChat(settings: EwSettings): Promise<void> {
  const target = await resolveTargetWorldbook(settings);
  if (!target) {
    console.info('[Evolution World] purgeAndRestore: no worldbook available, skipping');
    return;
  }

  const lastId = getLastMessageId();
  const allMessages = lastId >= 0 ? getChatMessages(`0-${lastId}`) : [];
  const hasSnapshotRefs = hasAnySnapshotReferences(allMessages);

  // 安全检查：先收集快照。如果存在快照引用但当前可见版本找不到匹配快照，
  // 保持 worldbook 现状不动，避免因版本错配或文件缺失导致破坏性清除。
  const { controllers: controllerSnapshots, dyn: dynSnapshots } = await collectLatestSnapshots();
  if (dynSnapshots.size === 0 && controllerSnapshots.length === 0 && hasSnapshotRefs) {
    console.info(
      '[Evolution World] purgeAndRestore: no valid snapshots found for current visible versions, keeping current worldbook state',
    );
    refreshObservedMessageVersions();
    return;
  }

  // Step 1: Remove all EW/Dyn/* entries and clear all EW/Controller/* entries.
  const nextEntries = klona(target.entries).filter(entry => !entry.name.startsWith(settings.dynamic_entry_prefix));

  // Clear all existing controller entries.
  const ctrlEntries = nextEntries.filter(e => e.name.startsWith(settings.controller_entry_prefix));
  for (const entry of ctrlEntries) {
    entry.content = '';
    entry.enabled = false;
  }

  // Step 2: Restore from snapshot (already collected above).

  for (const snap of dynSnapshots.values()) {
    const normalizedSnap = normalizeDynSnapshot(snap);
    const existing = nextEntries.find(e => e.name === snap.name);
    if (existing) {
      existing.content = normalizedSnap.content;
      existing.enabled = false;
    } else {
      nextEntries.push(ensureDefaultEntry(normalizedSnap.name, normalizedSnap.content, false, nextEntries));
    }
  }

  // Restore multi-controllers.
  for (const controllerSnapshot of controllerSnapshots) {
    const entryName = resolveControllerSnapshotEntryName(settings.controller_entry_prefix, controllerSnapshot);
    const existing = nextEntries.find(e => e.name === entryName);
    if (existing) {
      existing.content = controllerSnapshot.content;
      existing.enabled = true;
    } else {
      nextEntries.push(ensureDefaultEntry(entryName, controllerSnapshot.content, true, nextEntries, true));
    }
  }

  // Step 3: Commit the cleaned + restored worldbook.
  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });

  // Step 4: Cleanup orphaned snapshot files (file mode only).
  if (settings.snapshot_storage === 'file') {
    try {
      if (lastId >= 0) {
        const keepFiles = new Set<string>();
        const allMsgIds: number[] = [];
        for (const msg of allMessages) {
          allMsgIds.push(msg.message_id);
          const sources = await loadSnapshotVersionSources(msg);
          for (const source of sources) {
            if (source.source === 'file' && source.fileName) {
              keepFiles.add(source.fileName);
            }
          }
        }
        const cleaned = await cleanupSnapshotFiles(getCharName(), getChatId(), allMsgIds, keepFiles);
        if (cleaned > 0) {
          console.info(`[Evolution World] Cleaned up ${cleaned} orphaned snapshot files`);
        }
      }
    } catch (e) {
      console.warn('[Evolution World] Snapshot file cleanup failed:', e);
    }
  }

  refreshObservedMessageVersions();
  const restoredDyn = dynSnapshots.size;
  const restoredCtrl = controllerSnapshots.length;
  console.info(`[Evolution World] purgeAndRestore: ${restoredDyn} Dyn + ${restoredCtrl} Controller(s) restored`);
}

// ── 迁移 ────────────────────────────────────────────────

/**
 * Migrate snapshots between storage modes for the current chat.
 */
export async function migrateSnapshots(direction: 'to_file' | 'to_message_data'): Promise<{ migrated: number }> {
  const lastId = getLastMessageId();
  if (lastId < 0) return { migrated: 0 };

  const charName = getCharName();
  const chatId = getChatId();
  const allMessages = getChatMessages(`0-${lastId}`);
  let migrated = 0;

  if (direction === 'to_file') {
    for (const msg of allMessages) {
      const inlineVersions = readInlineSnapshotVersions(msg.data ?? {});
      if (Object.keys(inlineVersions).length === 0) continue;

      const fileName = await writeSnapshot(charName, chatId, msg.message_id, Object.values(inlineVersions)[0]);
      const store = buildSnapshotStoreFromVersions(inlineVersions);
      await writeSnapshotStore(fileName, store);

      const versionInfo = getMessageVersionInfo(msg);
      const nextData: Record<string, unknown> = { ...msg.data };
      nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
      nextData[EW_SWIPE_ID_KEY] = versionInfo.swipe_id;
      nextData[EW_CONTENT_HASH_KEY] = versionInfo.content_hash;
      delete nextData[EW_INLINE_SNAPSHOT_VERSIONS_KEY];
      delete nextData[EW_CONTROLLER_DATA_KEY];
      delete nextData[EW_CONTROLLERS_DATA_KEY];
      delete nextData[EW_DYN_SNAPSHOTS_KEY];

      await setChatMessages([{ message_id: msg.message_id, data: nextData }], { refresh: 'none' });
      migrated++;
    }
  } else {
    for (const msg of allMessages) {
      const snapshotFile: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
      if (!snapshotFile) continue;

      const store = await readSnapshotStore(snapshotFile);
      const nextData: Record<string, unknown> = { ...msg.data };
      delete nextData[EW_SNAPSHOT_FILE_KEY];
      clearInlineSnapshotFields(nextData);

      if (store && Object.keys(store.versions).length > 0) {
        writeInlineSnapshotVersions(nextData, store.versions);
        const versionInfo = getMessageVersionInfo(msg);
        nextData[EW_SWIPE_ID_KEY] = versionInfo.swipe_id;
        nextData[EW_CONTENT_HASH_KEY] = versionInfo.content_hash;
      }

      await setChatMessages([{ message_id: msg.message_id, data: nextData }], { refresh: 'none' });
      await deleteSnapshot(snapshotFile);
      migrated++;
    }
  }

  console.info(`[Evolution World] Migration ${direction}: ${migrated} messages processed`);
  return { migrated };
}

// ── History: Per-Floor Snapshot Collection ───────────────────

export type FloorSnapshot = {
  messageId: number;
  snapshot: SnapshotData | null;
  resolution: FloorSnapshotReadResolution;
  available_version_count: number;
  source: 'file' | 'inline' | 'none';
  matched_version_key?: string;
  file_name?: string;
  execution?: {
    execution_status: 'executed' | 'skipped';
    skip_reason?: string;
    attempted_flow_ids: string[];
    failed_flow_ids: string[];
    workflow_failed: boolean;
  };
};

export type SnapshotDiff = {
  created: string[];
  modified: string[];
  deleted: string[];
  toggled: string[];
  controllersChanged: Record<string, 'created' | 'modified' | 'deleted'>;
};

/**
 * Collect every message's individual snapshot (not merged).
 * Returns an array ordered by messageId ascending, where each entry
 * contains the snapshot data stored at that specific floor.
 * Messages without snapshots are included with `snapshot: null`.
 */
export async function collectAllFloorSnapshots(): Promise<FloorSnapshot[]> {
  const lastId = getLastMessageId();
  if (lastId < 0) return [];

  const allMessages = getChatMessages(`0-${lastId}`);
  const result: FloorSnapshot[] = [];

  for (const msg of allMessages) {
    const readResult = await readSnapshotForMessageDetailed(msg, 'history');
    result.push({
      messageId: msg.message_id,
      snapshot: readResult.snapshot,
      resolution: readResult.resolution,
      available_version_count: readResult.available_version_count,
      source: readResult.source,
      matched_version_key: readResult.matched_version_key,
      file_name: readResult.file_name,
    });
  }

  return result;
}

/**
 * Compute the diff between two snapshots (prev → curr).
 * If prev is null, all entries in curr are "created".
 */
export function diffSnapshots(prev: SnapshotData | null, curr: SnapshotData | null): SnapshotDiff {
  const diff: SnapshotDiff = { created: [], modified: [], deleted: [], toggled: [], controllersChanged: {} };
  if (!curr) return diff;

  const prevMap = new Map<string, { content: string; enabled: boolean }>();
  if (prev) {
    for (const e of prev.dyn_entries) {
      prevMap.set(e.name, { content: e.content, enabled: e.enabled });
    }
  }

  const currMap = new Map<string, { content: string; enabled: boolean }>();
  for (const e of curr.dyn_entries) {
    currMap.set(e.name, { content: e.content, enabled: e.enabled });
  }

  // Find created, modified, toggled
  for (const [name, currEntry] of currMap) {
    const prevEntry = prevMap.get(name);
    if (!prevEntry) {
      diff.created.push(name);
    } else if (prevEntry.content !== currEntry.content) {
      diff.modified.push(name);
    } else if (prevEntry.enabled !== currEntry.enabled) {
      diff.toggled.push(name);
    }
  }

  // Find deleted
  for (const name of prevMap.keys()) {
    if (!currMap.has(name)) {
      diff.deleted.push(name);
    }
  }

  // Controller changes (multi-controller)
  const prevControllers = new Map(
    (prev?.controllers ?? []).map(snapshot => [controllerSnapshotKey(snapshot), snapshot]),
  );
  const currControllers = new Map(curr.controllers.map(snapshot => [controllerSnapshotKey(snapshot), snapshot]));
  const allCtrlKeys = new Set([...prevControllers.keys(), ...currControllers.keys()]);
  for (const key of allCtrlKeys) {
    const prevVal = prevControllers.get(key);
    const currVal = currControllers.get(key);
    if (!prevVal && currVal) {
      diff.controllersChanged[key] = 'created';
    } else if (prevVal && !currVal) {
      diff.controllersChanged[key] = 'deleted';
    } else if (prevVal?.content !== currVal?.content || prevVal?.entry_name !== currVal?.entry_name) {
      diff.controllersChanged[key] = 'modified';
    }
  }

  return diff;
}

/**
 * Rollback worldbook to the cumulative snapshot state at a given floor.
 * This means: merge all snapshots from floor 0 up to and including
 * the target messageId, then apply that state to the worldbook.
 */
export async function rollbackToFloor(settings: EwSettings, targetMessageId: number): Promise<void> {
  await restoreWorldbookFromSnapshots(settings, floor => floor.messageId <= targetMessageId);
  console.info(`[Evolution World] Rolled back to floor #${targetMessageId}`);
}

export async function rollbackBeforeFloor(settings: EwSettings, messageId: number): Promise<void> {
  // 安全检查：如果目标楼层之前没有任何快照，跳过回退，
  // 避免清空全部条目后无法恢复。
  const allFloors = await collectAllFloorSnapshots();
  const hasSnapshotBefore = allFloors.some(f => f.messageId < messageId && f.snapshot !== null);
  if (!hasSnapshotBefore) {
    console.info(`[EW] No snapshot found before floor #${messageId}, skipping rollback to preserve current state`);
    return;
  }
  await restoreWorldbookFromSnapshots(settings, floor => floor.messageId < messageId);
  console.info(`[Evolution World] Rolled back to state before floor #${messageId}`);
}

async function restoreWorldbookFromSnapshots(
  settings: EwSettings,
  predicate: (floor: FloorSnapshot) => boolean,
): Promise<void> {
  const allFloors = await collectAllFloorSnapshots();
  const dynMerged = new Map<string, DynSnapshot>();
  const controllers = new Map<string, ControllerEntrySnapshot>();

  // 在 predicate 范围内找到**最新**有快照的楼层，直接使用其完整状态。
  // 每个快照已是全量备份，跨楼层累加合并会导致被后续工作流删除的条目复活。
  let latestSnapshot: SnapshotData | null = null;
  for (let i = allFloors.length - 1; i >= 0; i--) {
    const floor = allFloors[i];
    if (!predicate(floor)) continue;
    if (!floor.snapshot) continue;
    latestSnapshot = floor.snapshot;
    break;
  }

  // 核心安全防护：没有找到有效快照时，禁止破坏性写回
  if (!latestSnapshot) {
    console.info('[EW] restoreWorldbookFromSnapshots: no matching snapshot found, skipping destructive restore');
    return;
  }

  for (const snapshot of latestSnapshot.controllers.map(normalizeControllerSnapshot)) {
    controllers.set(controllerSnapshotKey(snapshot), snapshot);
  }
  for (const snap of latestSnapshot.dyn_entries) {
    if (snap.name && typeof snap.content === 'string') {
      dynMerged.set(snap.name, snap);
    }
  }

  // Apply to worldbook (same pattern as purgeAndRestoreForChat)
  const target = await resolveTargetWorldbook(settings);
  if (!target) {
    console.info('[Evolution World] restoreWorldbookFromSnapshots: no worldbook available, skipping');
    return;
  }
  const nextEntries = klona(target.entries).filter(entry => !entry.name.startsWith(settings.dynamic_entry_prefix));

  // Clear all existing controller entries.
  const ctrlEntries = nextEntries.filter(e => e.name.startsWith(settings.controller_entry_prefix));
  for (const entry of ctrlEntries) {
    entry.content = '';
    entry.enabled = false;
  }

  for (const snap of dynMerged.values()) {
    const normalizedSnap = normalizeDynSnapshot(snap);
    const existing = nextEntries.find(e => e.name === snap.name);
    if (existing) {
      existing.content = normalizedSnap.content;
      existing.enabled = false;
    } else {
      nextEntries.push(ensureDefaultEntry(normalizedSnap.name, normalizedSnap.content, false, nextEntries));
    }
  }

  // Restore multi-controllers.
  for (const controllerSnapshot of controllers.values()) {
    const entryName = resolveControllerSnapshotEntryName(settings.controller_entry_prefix, controllerSnapshot);
    const existing = nextEntries.find(e => e.name === entryName);
    if (existing) {
      existing.content = controllerSnapshot.content;
      existing.enabled = true;
    } else {
      nextEntries.push(ensureDefaultEntry(entryName, controllerSnapshot.content, true, nextEntries, true));
    }
  }

  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });
}

// ── Event Handlers ──────────────────────────────────────────

async function onChatChanged(settings: EwSettings): Promise<void> {
  try {
    await purgeAndRestoreForChat(settings);
  } catch (error) {
    console.warn('[Evolution World] chat change handling failed:', error);
  }
}

/**
 * Initialize floor binding event listeners.
 */
export function initFloorBindingEvents(getSettings: () => EwSettings): void {
  disposeFloorBindingEvents();
  refreshObservedMessageVersions();

  floorBindingListenerStops.push(
    eventOn(tavern_events.CHAT_CHANGED, () => {
      refreshObservedMessageVersions();
      const currentSettings = getSettings();
      if (currentSettings.enabled && currentSettings.floor_binding_enabled) {
        scheduleFloorBindingRestore(getSettings, 500);
      }
    }),
  );

  floorBindingListenerStops.push(
    eventOn(tavern_events.MESSAGE_DELETED, () => {
      refreshObservedMessageVersions();
      const currentSettings = getSettings();
      if (currentSettings.enabled && currentSettings.floor_binding_enabled) {
        scheduleFloorBindingRestore(getSettings, 180);
      }
    }),
  );

  floorBindingListenerStops.push(
    eventOn(tavern_events.MESSAGE_SWIPED, messageId => {
      const currentSettings = getSettings();
      if (
        currentSettings.enabled &&
        currentSettings.floor_binding_enabled &&
        shouldReactToVisibleVersionMutation(messageId)
      ) {
        scheduleFloorBindingRestore(getSettings, 300);
      }
    }),
  );

  floorBindingListenerStops.push(
    eventOn(tavern_events.MESSAGE_EDITED, messageId => {
      const currentSettings = getSettings();
      if (
        currentSettings.enabled &&
        currentSettings.floor_binding_enabled &&
        shouldReactToVisibleVersionMutation(messageId)
      ) {
        scheduleFloorBindingRestore(getSettings, 300);
      }
    }),
  );

  floorBindingListenerStops.push(
    eventOn(tavern_events.MESSAGE_UPDATED, messageId => {
      const currentSettings = getSettings();
      if (
        currentSettings.enabled &&
        currentSettings.floor_binding_enabled &&
        shouldReactToVisibleVersionMutation(messageId)
      ) {
        scheduleFloorBindingRestore(getSettings, 300);
      }
    }),
  );
}

/**
 * Dispose floor binding event listeners.
 */
export function disposeFloorBindingEvents(): void {
  if (floorBindingRestoreTimer) {
    clearTimeout(floorBindingRestoreTimer);
    floorBindingRestoreTimer = null;
  }

  observedMessageVersionKeys.clear();
  for (const stopper of floorBindingListenerStops.splice(0, floorBindingListenerStops.length)) {
    stopper.stop();
  }
}
