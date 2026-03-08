import { EwSettings } from './types';
import { resolveTargetWorldbook } from './worldbook-runtime';

const EW_FLOOR_DATA_KEY = 'ew_entries';
const EW_CONTROLLER_DATA_KEY = 'ew_controller';

const floorBindingListenerStops: EventOnReturn[] = [];

/**
 * Mark floor entries: write the list of EW/Dyn/ entry names into the chat message's `data` field.
 *
 * This follows shujuku's pattern of using `ChatMessage.data` for per-floor metadata,
 * enabling automatic cleanup when floors are deleted.
 */
export async function markFloorEntries(messageId: number, entryNames: string[], controllerSnapshot?: string): Promise<void> {
  if (entryNames.length === 0 && !controllerSnapshot) {
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

  await setChatMessages(
    [{ message_id: messageId, data: nextData }],
    { refresh: 'none' },
  );
}

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

/**
 * Get all floor bindings: map of message_id -> entry names.
 */
function getAllFloorBindings(): Map<number, string[]> {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return new Map();
  }

  const bindings = new Map<number, string[]>();
  const allMessages = getChatMessages(`0-${lastId}`);

  for (const msg of allMessages) {
    const entries: string[] = _.get(msg.data, EW_FLOOR_DATA_KEY, []);
    if (entries.length > 0) {
      bindings.set(msg.message_id, entries);
    }
  }

  return bindings;
}

/**
 * Cleanup orphaned entries: remove EW/Dyn/ entries from the worldbook whose
 * bound floor no longer exists. Also updates the EJS controller to remove
 * references to deleted entries.
 *
 * Returns the number of entries cleaned up.
 */
export async function cleanupOrphanedEntries(settings: EwSettings): Promise<number> {
  const target = await resolveTargetWorldbook(settings);
  const bindings = getAllFloorBindings();

  // Collect all entry names that are still validly bound to existing floors.
  const validEntryNames = new Set<string>();
  for (const entries of bindings.values()) {
    for (const name of entries) {
      validEntryNames.add(name);
    }
  }

  // We only want to remove EW/Dyn/ entries in the worldbook that:
  // 1) Match the dynamic_entry_prefix
  // 2) Are NOT currently bound to any existing floor
  // 3) There IS at least one floor binding in the chat (meaning floor binding has been used)
  //    — if no bindings exist at all, this is likely a fresh chat or floor binding was just enabled,
  //    and we should NOT remove anything.
  if (bindings.size === 0) {
    return 0;
  }

  const orphanedNames: string[] = [];
  for (const entry of target.entries) {
    if (entry.name.startsWith(settings.dynamic_entry_prefix) && !validEntryNames.has(entry.name)) {
      orphanedNames.push(entry.name);
    }
  }

  // Auto-rollback Controller: find the latest surviving message with a Controller snapshot.
  let controllerRolledBack = false;
  if (orphanedNames.length > 0) {
    const latestSnapshot = findLatestControllerSnapshot();
    const ctrlEntry = target.entries.find(e => e.name === settings.controller_entry_name);
    if (latestSnapshot !== null && ctrlEntry && ctrlEntry.content !== latestSnapshot) {
      ctrlEntry.content = latestSnapshot;
      controllerRolledBack = true;
    } else if (latestSnapshot === null && ctrlEntry) {
      // No surviving snapshots → disable the Controller entry.
      ctrlEntry.enabled = false;
      controllerRolledBack = true;
    }
  }

  if (orphanedNames.length === 0 && !controllerRolledBack) {
    return 0;
  }

  // Remove orphaned entries from the worldbook (and apply Controller rollback if needed).
  const orphanSet = new Set(orphanedNames);
  const filteredEntries = target.entries.filter(entry => !orphanSet.has(entry.name));
  await replaceWorldbook(target.worldbook_name, filteredEntries, { render: 'debounced' });

  if (controllerRolledBack) {
    console.info(`[Evolution World] Controller auto-rolled back to latest surviving snapshot`);
  }

  return orphanedNames.length;
}

/**
 * Find the latest Controller snapshot from surviving chat messages.
 * Scans all messages from newest to oldest, returns the first ew_controller found.
 * Returns null if no snapshot exists.
 */
function findLatestControllerSnapshot(): string | null {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return null;
  }

  const allMessages = getChatMessages(`0-${lastId}`);
  // Iterate from newest to oldest
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const snapshot: string | undefined = _.get(allMessages[i].data, EW_CONTROLLER_DATA_KEY);
    if (typeof snapshot === 'string' && snapshot.length > 0) {
      return snapshot;
    }
  }
  return null;
}

/**
 * Handle floor deletion: when chat messages are deleted, remove their
 * bound EW/Dyn/ entries from the worldbook.
 */
async function onChatChanged(settings: EwSettings): Promise<void> {
  if (!settings.auto_cleanup_orphans) {
    return;
  }

  try {
    const cleaned = await cleanupOrphanedEntries(settings);
    if (cleaned > 0) {
      console.info(`[Evolution World] cleaned up ${cleaned} orphaned entries`);
    }
  } catch (error) {
    console.warn('[Evolution World] floor cleanup failed:', error);
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
