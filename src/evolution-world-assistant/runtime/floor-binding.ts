import { EwSettings } from './types';
import { resolveTargetWorldbook, ensureDefaultEntry } from './worldbook-runtime';

const EW_FLOOR_DATA_KEY = 'ew_entries';
const EW_CONTROLLER_DATA_KEY = 'ew_controller';
const EW_DYN_SNAPSHOTS_KEY = 'ew_dyn_snapshots';

type DynSnapshot = { name: string; content: string; enabled: boolean };

const floorBindingListenerStops: EventOnReturn[] = [];

// ── Floor Marking ────────────────────────────────────────────

/**
 * Mark floor entries: write entry names, Dyn content snapshots, and Controller
 * snapshot into the chat message's `data` field.
 *
 * Each message stores the complete state of all EW entries at that point.
 * On CHAT_CHANGED, purgeAndRestoreForChat reads the latest surviving
 * snapshot to restore the worldbook — covering delete-floor (rollback),
 * new-chat (clean slate), and switch-back (full restore).
 */
export async function markFloorEntries(
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
  if (controllerSnapshot !== undefined) {
    nextData[EW_CONTROLLER_DATA_KEY] = controllerSnapshot;
  }
  if (dynSnapshots && dynSnapshots.length > 0) {
    nextData[EW_DYN_SNAPSHOTS_KEY] = dynSnapshots;
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

// ── Chat Message Scanning ─────────────────────────────────────

/**
 * Scan all surviving messages and return the latest snapshots.
 * Reads messages once and extracts both Controller and Dyn snapshots
 * in a single pass for efficiency.
 */
function collectLatestSnapshots(): {
  controller: string | null;
  dyn: Map<string, DynSnapshot>;
} {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return { controller: null, dyn: new Map() };
  }

  const allMessages = getChatMessages(`0-${lastId}`);
  const dynMerged = new Map<string, DynSnapshot>();
  let latestController: string | null = null;

  // Iterate oldest to newest: latest wins for both Dyn and Controller.
  for (const msg of allMessages) {
    // Dyn snapshots
    const snapshots: DynSnapshot[] | undefined = _.get(msg.data, EW_DYN_SNAPSHOTS_KEY);
    if (Array.isArray(snapshots)) {
      for (const snap of snapshots) {
        if (snap.name && typeof snap.content === 'string') {
          dynMerged.set(snap.name, snap);
        }
      }
    }

    // Controller snapshot
    const ctrlSnap: string | undefined = _.get(msg.data, EW_CONTROLLER_DATA_KEY);
    if (typeof ctrlSnap === 'string' && ctrlSnap.length > 0) {
      latestController = ctrlSnap;
    }
  }

  return { controller: latestController, dyn: dynMerged };
}

// ── Unified Purge + Restore ─────────────────────────────────

/**
 * Purge all EW-generated entries from worldbook, then restore from the
 * current chat's message data snapshots.
 *
 * This is the SINGLE handler for all CHAT_CHANGED events:
 *
 *   Delete floor  → deleted message's snapshot gone → restores previous message's state (rollback)
 *   New chat      → no messages with snapshots     → clean slate (purge only)
 *   Switch back   → old chat's messages still have snapshots → full restore
 *
 * Worldbook entries are treated as ephemeral derivatives of chat message data.
 */
export async function purgeAndRestoreForChat(settings: EwSettings): Promise<void> {
  const target = await resolveTargetWorldbook(settings);

  // Step 1: Remove all EW/Dyn/* entries and clear EW/Controller.
  const nextEntries = target.entries.filter(
    entry => !entry.name.startsWith(settings.dynamic_entry_prefix),
  );
  const ctrlEntry = nextEntries.find(e => e.name === settings.controller_entry_name);
  if (ctrlEntry) {
    ctrlEntry.content = '';
    ctrlEntry.enabled = false;
  }

  // Step 2: Restore from current chat's latest surviving snapshots.
  const { controller: controllerSnapshot, dyn: dynSnapshots } = collectLatestSnapshots();

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

  const restoredDyn = dynSnapshots.size;
  const restoredCtrl = controllerSnapshot ? 1 : 0;
  console.info(
    `[Evolution World] purgeAndRestore: ${restoredDyn} Dyn + ${restoredCtrl} Controller restored from chat snapshots`,
  );
}

// ── Event Handlers ──────────────────────────────────────────

/**
 * Handle all CHAT_CHANGED events with unified purge + restore.
 */
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
        // Delay to allow chat to fully load, then re-read settings to avoid stale closure.
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
