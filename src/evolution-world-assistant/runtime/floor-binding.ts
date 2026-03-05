import { EwSettings } from './types';
import { resolveTargetWorldbook } from './worldbook-runtime';

const EW_FLOOR_DATA_KEY = 'ew_entries';

const floorBindingListenerStops: EventOnReturn[] = [];

/**
 * Mark floor entries: write the list of EW/Dyn/ entry names into the chat message's `data` field.
 *
 * This follows shujuku's pattern of using `ChatMessage.data` for per-floor metadata,
 * enabling automatic cleanup when floors are deleted.
 */
export async function markFloorEntries(messageId: number, entryNames: string[]): Promise<void> {
  if (entryNames.length === 0) {
    return;
  }

  const messages = getChatMessages(messageId);
  if (messages.length === 0) {
    return;
  }

  const msg = messages[0];
  const existingEntries: string[] = _.get(msg.data, EW_FLOOR_DATA_KEY, []);
  const mergedEntries = _.uniq([...existingEntries, ...entryNames]);

  await setChatMessages(
    [{ message_id: messageId, data: { ...msg.data, [EW_FLOOR_DATA_KEY]: mergedEntries } }],
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

  // Find EW/Dyn/ entries in the worldbook that are NOT in any valid floor binding.
  const orphanedNames: string[] = [];
  for (const entry of target.entries) {
    if (entry.name.startsWith(settings.dynamic_entry_prefix) && !validEntryNames.has(entry.name)) {
      orphanedNames.push(entry.name);
    }
  }

  if (orphanedNames.length === 0) {
    return 0;
  }

  // Remove orphaned entries from the worldbook.
  const orphanSet = new Set(orphanedNames);
  const filteredEntries = target.entries.filter(entry => !orphanSet.has(entry.name));
  await replaceWorldbook(target.worldbook_name, filteredEntries, { render: 'debounced' });

  return orphanedNames.length;
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
      const settings = getSettings();
      if (settings.enabled && settings.floor_binding_enabled) {
        // Delay to allow chat to fully load.
        setTimeout(() => onChatChanged(settings), 500);
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
