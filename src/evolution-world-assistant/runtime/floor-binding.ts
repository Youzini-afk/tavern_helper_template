import { EwSettings } from './types';
import { resolveTargetWorldbook, ensureDefaultEntry } from './worldbook-runtime';
import {
  writeSnapshot,
  readSnapshot,
  deleteSnapshot,
  cleanupSnapshotFiles,
  type SnapshotData,
} from './snapshot-storage';

const EW_FLOOR_DATA_KEY = 'ew_entries';
const EW_CONTROLLER_DATA_KEY = 'ew_controller';
const EW_DYN_SNAPSHOTS_KEY = 'ew_dyn_snapshots';
const EW_SNAPSHOT_FILE_KEY = 'ew_snapshot_file';

export type DynSnapshot = { name: string; content: string; enabled: boolean };

const floorBindingListenerStops: EventOnReturn[] = [];

// ── Context Helpers ──────────────────────────────────────────

function getCharName(): string {
  return getCurrentCharacterName() ?? 'unknown';
}

function getChatId(): string {
  return String(SillyTavern.getCurrentChatId?.() ?? SillyTavern.chatId ?? 'unknown');
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
  controllerSnapshot?: string,
  dynSnapshots?: DynSnapshot[],
): Promise<void> {
  if (entryNames.length === 0 && !controllerSnapshot && (!dynSnapshots || dynSnapshots.length === 0)) {
    return;
  }

  const messages = getChatMessages(messageId);
  if (messages.length === 0) {
    return;
  }

  const msg = messages[0];
  const existingEntries: string[] = _.get(msg.data, EW_FLOOR_DATA_KEY, []);
  const mergedEntries = _.uniq([...existingEntries, ...entryNames]);

  const nextData: Record<string, unknown> = {
    ...msg.data,
    [EW_FLOOR_DATA_KEY]: mergedEntries,
  };

  if (settings.snapshot_storage === 'file') {
    // File mode: write snapshot to file, store filename in message data.
    if (controllerSnapshot || (dynSnapshots && dynSnapshots.length > 0)) {
      const snapshotData: SnapshotData = {
        controller: controllerSnapshot ?? '',
        dyn_entries: dynSnapshots ?? [],
      };
      try {
        const fileName = await writeSnapshot(getCharName(), getChatId(), messageId, snapshotData);
        nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
      } catch (e) {
        console.warn('[Evolution World] File snapshot write failed, falling back to message data:', e);
        // Fallback: store in message data
        if (controllerSnapshot !== undefined) {
          nextData[EW_CONTROLLER_DATA_KEY] = controllerSnapshot;
        }
        if (dynSnapshots && dynSnapshots.length > 0) {
          nextData[EW_DYN_SNAPSHOTS_KEY] = dynSnapshots;
        }
      }
    }
  } else {
    // Message data mode (default).
    if (controllerSnapshot !== undefined) {
      nextData[EW_CONTROLLER_DATA_KEY] = controllerSnapshot;
    }
    if (dynSnapshots && dynSnapshots.length > 0) {
      nextData[EW_DYN_SNAPSHOTS_KEY] = dynSnapshots;
    }
  }

  await setChatMessages(
    [{ message_id: messageId, data: nextData }],
    { refresh: 'none' },
  );
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
  controller: string | null;
  dyn: Map<string, DynSnapshot>;
}> {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return { controller: null, dyn: new Map() };
  }

  const allMessages = getChatMessages(`0-${lastId}`);
  const dynMerged = new Map<string, DynSnapshot>();
  let latestController: string | null = null;

  // Iterate oldest to newest: latest wins.
  for (const msg of allMessages) {
    const snapshotFile: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);

    if (snapshotFile) {
      // File mode snapshot: read from file.
      const fileData = await readSnapshot(snapshotFile);
      if (fileData) {
        if (fileData.controller) {
          latestController = fileData.controller;
        }
        for (const snap of fileData.dyn_entries) {
          if (snap.name && typeof snap.content === 'string') {
            dynMerged.set(snap.name, snap);
          }
        }
        continue; // File snapshot found, skip message data for this message.
      }
    }

    // Message data mode (or file read failed — fallback).
    const snapshots: DynSnapshot[] | undefined = _.get(msg.data, EW_DYN_SNAPSHOTS_KEY);
    if (Array.isArray(snapshots)) {
      for (const snap of snapshots) {
        if (snap.name && typeof snap.content === 'string') {
          dynMerged.set(snap.name, snap);
        }
      }
    }

    const ctrlSnap: string | undefined = _.get(msg.data, EW_CONTROLLER_DATA_KEY);
    if (typeof ctrlSnap === 'string' && ctrlSnap.length > 0) {
      latestController = ctrlSnap;
    }
  }

  return { controller: latestController, dyn: dynMerged };
}

/**
 * 仅获取最新一条快照（为 injectEntryNames 优化）。
 * 倒序遍历消息，找到第一条有快照的消息后立即返回，最多 1 次 HTTP 请求。
 */
export async function collectLatestSnapshotFast(): Promise<{
  controller: string | null;
  dyn: Map<string, DynSnapshot>;
}> {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return { controller: null, dyn: new Map() };
  }

  const allMessages = getChatMessages(`0-${lastId}`);

  // 倒序遍历：最新的消息优先
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];

    // 检查文件模式快照
    const snapshotFile: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
    if (snapshotFile) {
      const fileData = await readSnapshot(snapshotFile);
      if (fileData) {
        const dyn = new Map<string, DynSnapshot>();
        for (const snap of fileData.dyn_entries) {
          if (snap.name && typeof snap.content === 'string') {
            dyn.set(snap.name, snap);
          }
        }
        return { controller: fileData.controller || null, dyn };
      }
    }

    // 检查消息数据模式快照
    const snapshots: DynSnapshot[] | undefined = _.get(msg.data, EW_DYN_SNAPSHOTS_KEY);
    const ctrlSnap: string | undefined = _.get(msg.data, EW_CONTROLLER_DATA_KEY);

    if ((Array.isArray(snapshots) && snapshots.length > 0) || (typeof ctrlSnap === 'string' && ctrlSnap.length > 0)) {
      const dyn = new Map<string, DynSnapshot>();
      if (Array.isArray(snapshots)) {
        for (const snap of snapshots) {
          if (snap.name && typeof snap.content === 'string') {
            dyn.set(snap.name, snap);
          }
        }
      }
      return { controller: (typeof ctrlSnap === 'string' && ctrlSnap.length > 0) ? ctrlSnap : null, dyn };
    }
  }

  return { controller: null, dyn: new Map() };
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

  // Step 1: Remove all EW/Dyn/* entries and clear EW/Controller.
  const nextEntries = klona(target.entries).filter(
    entry => !entry.name.startsWith(settings.dynamic_entry_prefix),
  );
  const ctrlEntry = nextEntries.find(e => e.name === settings.controller_entry_name);
  if (ctrlEntry) {
    ctrlEntry.content = '';
    ctrlEntry.enabled = false;
  }

  // Step 2: Restore from current chat's latest surviving snapshots.
  const { controller: controllerSnapshot, dyn: dynSnapshots } = await collectLatestSnapshots();

  for (const snap of dynSnapshots.values()) {
    const existing = nextEntries.find(e => e.name === snap.name);
    if (existing) {
      existing.content = snap.content;
      existing.enabled = snap.enabled;
    } else {
      nextEntries.push(
        ensureDefaultEntry(snap.name, snap.content, snap.enabled, nextEntries),
      );
    }
  }

  if (controllerSnapshot && ctrlEntry) {
    ctrlEntry.content = controllerSnapshot;
    ctrlEntry.enabled = true;
  } else if (controllerSnapshot) {
    nextEntries.push(
      ensureDefaultEntry(settings.controller_entry_name, controllerSnapshot, true, nextEntries, true),
    );
  }

  // Step 3: Commit the cleaned + restored worldbook.
  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });

  // Step 4: Cleanup orphaned snapshot files (file mode only).
  if (settings.snapshot_storage === 'file') {
    try {
      const lastId = getLastMessageId();
      if (lastId >= 0) {
        const allMessages = getChatMessages(`0-${lastId}`);
        const keepFiles = new Set<string>();
        const allMsgIds: number[] = [];
        for (const msg of allMessages) {
          allMsgIds.push(msg.message_id);
          const file: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
          if (file) keepFiles.add(file);
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

  const restoredDyn = dynSnapshots.size;
  const restoredCtrl = controllerSnapshot ? 1 : 0;
  console.info(
    `[Evolution World] purgeAndRestore: ${restoredDyn} Dyn + ${restoredCtrl} Controller restored`,
  );
}

// ── 迁移 ────────────────────────────────────────────────

/**
 * Migrate snapshots between storage modes for the current chat.
 */
export async function migrateSnapshots(
  direction: 'to_file' | 'to_message_data',
): Promise<{ migrated: number }> {
  const lastId = getLastMessageId();
  if (lastId < 0) return { migrated: 0 };

  const charName = getCharName();
  const chatId = getChatId();
  const allMessages = getChatMessages(`0-${lastId}`);
  let migrated = 0;

  if (direction === 'to_file') {
    // message_data → file: read from msg.data, write to file, clear msg.data snapshot fields.
    for (const msg of allMessages) {
      const dyn: DynSnapshot[] | undefined = _.get(msg.data, EW_DYN_SNAPSHOTS_KEY);
      const ctrl: string | undefined = _.get(msg.data, EW_CONTROLLER_DATA_KEY);

      if (!dyn && !ctrl) continue;

      const snapshotData: SnapshotData = {
        controller: ctrl ?? '',
        dyn_entries: dyn ?? [],
      };

      const fileName = await writeSnapshot(charName, chatId, msg.message_id, snapshotData);

      // Update message data: keep ew_entries, add file ref, remove inline snapshots.
      const nextData: Record<string, unknown> = { ...msg.data };
      nextData[EW_SNAPSHOT_FILE_KEY] = fileName;
      delete nextData[EW_DYN_SNAPSHOTS_KEY];
      delete nextData[EW_CONTROLLER_DATA_KEY];

      await setChatMessages(
        [{ message_id: msg.message_id, data: nextData }],
        { refresh: 'none' },
      );
      migrated++;
    }
  } else {
    // file → message_data: read from file, write to msg.data, delete file.
    for (const msg of allMessages) {
      const snapshotFile: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
      if (!snapshotFile) continue;

      const fileData = await readSnapshot(snapshotFile);

      const nextData: Record<string, unknown> = { ...msg.data };
      delete nextData[EW_SNAPSHOT_FILE_KEY];

      if (fileData) {
        if (fileData.controller) {
          nextData[EW_CONTROLLER_DATA_KEY] = fileData.controller;
        }
        if (fileData.dyn_entries.length > 0) {
          nextData[EW_DYN_SNAPSHOTS_KEY] = fileData.dyn_entries;
        }
      }

      await setChatMessages(
        [{ message_id: msg.message_id, data: nextData }],
        { refresh: 'none' },
      );

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
};

export type SnapshotDiff = {
  created: string[];
  modified: string[];
  deleted: string[];
  toggled: string[];
  controllerChanged: boolean;
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
    const snapshotFile: string | undefined = _.get(msg.data, EW_SNAPSHOT_FILE_KEY);
    let snapshot: SnapshotData | null = null;

    if (snapshotFile) {
      snapshot = await readSnapshot(snapshotFile);
    }

    if (!snapshot) {
      const snapshots: DynSnapshot[] | undefined = _.get(msg.data, EW_DYN_SNAPSHOTS_KEY);
      const ctrlSnap: string | undefined = _.get(msg.data, EW_CONTROLLER_DATA_KEY);
      if ((Array.isArray(snapshots) && snapshots.length > 0) || (typeof ctrlSnap === 'string' && ctrlSnap.length > 0)) {
        snapshot = {
          controller: ctrlSnap ?? '',
          dyn_entries: Array.isArray(snapshots) ? snapshots : [],
        };
      }
    }

    result.push({ messageId: msg.message_id, snapshot });
  }

  return result;
}

/**
 * Compute the diff between two snapshots (prev → curr).
 * If prev is null, all entries in curr are "created".
 */
export function diffSnapshots(
  prev: SnapshotData | null,
  curr: SnapshotData | null,
): SnapshotDiff {
  const diff: SnapshotDiff = { created: [], modified: [], deleted: [], toggled: [], controllerChanged: false };
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

  // Controller change
  diff.controllerChanged = (prev?.controller ?? '') !== (curr.controller ?? '');

  return diff;
}

/**
 * Rollback worldbook to the cumulative snapshot state at a given floor.
 * This means: merge all snapshots from floor 0 up to and including
 * the target messageId, then apply that state to the worldbook.
 */
export async function rollbackToFloor(
  settings: EwSettings,
  targetMessageId: number,
): Promise<void> {
  const allFloors = await collectAllFloorSnapshots();
  const dynMerged = new Map<string, DynSnapshot>();
  let controller: string | null = null;

  // Merge snapshots up to targetMessageId (inclusive)
  for (const floor of allFloors) {
    if (floor.messageId > targetMessageId) break;
    if (!floor.snapshot) continue;

    if (floor.snapshot.controller) {
      controller = floor.snapshot.controller;
    }
    for (const snap of floor.snapshot.dyn_entries) {
      if (snap.name && typeof snap.content === 'string') {
        dynMerged.set(snap.name, snap);
      }
    }
  }

  // Apply to worldbook (same pattern as purgeAndRestoreForChat)
  const target = await resolveTargetWorldbook(settings);
  const nextEntries = klona(target.entries).filter(
    entry => !entry.name.startsWith(settings.dynamic_entry_prefix),
  );
  const ctrlEntry = nextEntries.find(e => e.name === settings.controller_entry_name);
  if (ctrlEntry) {
    ctrlEntry.content = '';
    ctrlEntry.enabled = false;
  }

  for (const snap of dynMerged.values()) {
    const existing = nextEntries.find(e => e.name === snap.name);
    if (existing) {
      existing.content = snap.content;
      existing.enabled = snap.enabled;
    } else {
      nextEntries.push(
        ensureDefaultEntry(snap.name, snap.content, snap.enabled, nextEntries),
      );
    }
  }

  if (controller && ctrlEntry) {
    ctrlEntry.content = controller;
    ctrlEntry.enabled = true;
  } else if (controller) {
    nextEntries.push(
      ensureDefaultEntry(settings.controller_entry_name, controller, true, nextEntries, true),
    );
  }

  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });
  console.info(`[Evolution World] Rolled back to floor #${targetMessageId}: ${dynMerged.size} Dyn + ${controller ? 1 : 0} Controller`);
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

  floorBindingListenerStops.push(
    eventOn(tavern_events.CHAT_CHANGED, () => {
      const currentSettings = getSettings();
      if (currentSettings.enabled && currentSettings.floor_binding_enabled) {
        setTimeout(() => {
          const freshSettings = getSettings();
          if (freshSettings.enabled && freshSettings.floor_binding_enabled) {
            onChatChanged(freshSettings);
          }
        }, 500);
      }
    }),
  );
}

/**
 * Dispose floor binding event listeners.
 */
export function disposeFloorBindingEvents(): void {
  for (const stopper of floorBindingListenerStops.splice(0, floorBindingListenerStops.length)) {
    stopper.stop();
  }
}
