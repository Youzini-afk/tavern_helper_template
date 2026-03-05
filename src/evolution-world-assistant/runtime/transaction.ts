import { MergedPlan, EwSettings } from './types';
import { resolveTargetWorldbook, ensureDefaultEntry } from './worldbook-runtime';
import { markFloorEntries } from './floor-binding';
import { saveControllerBackup } from './settings';

type CommitResult = {
  worldbook_name: string;
  chat_id: string;
  changed_count: number;
};

function findEntry(entries: WorldbookEntry[], name: string): WorldbookEntry | undefined {
  return entries.find(entry => entry.name === name);
}

function isManagedEntryName(settings: EwSettings, name: string): boolean {
  if (name === settings.controller_entry_name) {
    return true;
  }
  return name.startsWith(settings.dynamic_entry_prefix);
}

/**
 * Apply declarative diff: reconcile the worldbook entries to match the desired state.
 *
 * - desired_entries: each entry should exist with the given content and enabled state.
 *   If it already exists, overwrite content/enabled. If not, create it.
 * - remove_entries: each named entry should be deleted if it exists.
 */
function applyDeclarativeDiff(
  currentEntries: WorldbookEntry[],
  desiredEntries: Array<{ name: string; content: string; enabled: boolean }>,
  removeEntries: Array<{ name: string }>,
): WorldbookEntry[] {
  // Step 1: Remove entries.
  const removeSet = new Set(removeEntries.map(e => e.name));
  let result = currentEntries.filter(entry => !removeSet.has(entry.name));

  // Step 2: Apply desired state.
  for (const desired of desiredEntries) {
    const cloned = klona(result);
    const existing = cloned.find(entry => entry.name === desired.name);

    if (existing) {
      existing.content = desired.content;
      existing.enabled = desired.enabled;
      result = cloned;
    } else {
      result = [...result, ensureDefaultEntry(desired.name, desired.content, desired.enabled, result)];
    }
  }

  return result;
}

export async function commitMergedPlan(
  settings: EwSettings,
  mergedPlan: MergedPlan,
  controllerTemplate: string,
  _requestId: string,
  messageId: number,
): Promise<CommitResult> {
  const target = await resolveTargetWorldbook(settings);
  const beforeEntries = target.entries;
  const chatId = String(SillyTavern.getCurrentChatId?.() ?? SillyTavern.chatId ?? 'unknown');

  // Backup the current controller content before overwriting.
  const previousController = findEntry(beforeEntries, settings.controller_entry_name)?.content ?? '';
  saveControllerBackup(chatId, target.worldbook_name, previousController);

  // Validate that all operations target managed entry names.
  const allNames = [
    ...mergedPlan.worldbook.desired_entries.map(entry => entry.name),
    ...mergedPlan.worldbook.remove_entries.map(entry => entry.name),
  ];
  const unmanaged = allNames.filter(name => !isManagedEntryName(settings, name));
  if (unmanaged.length > 0) {
    throw new Error(`unmanaged entry name(s): ${unmanaged.join(', ')}`);
  }

  // Apply declarative diff to worldbook entries.
  let nextEntries = applyDeclarativeDiff(
    beforeEntries,
    mergedPlan.worldbook.desired_entries,
    mergedPlan.worldbook.remove_entries,
  );

  // Write the EJS controller entry into the character worldbook.
  const ctrlExisting = nextEntries.find(e => e.name === settings.controller_entry_name);
  if (ctrlExisting) {
    const cloned = klona(nextEntries);
    const ctrl = cloned.find(e => e.name === settings.controller_entry_name)!;
    ctrl.content = controllerTemplate;
    ctrl.enabled = true;
    nextEntries = cloned;
  } else {
    nextEntries = [...nextEntries, ensureDefaultEntry(settings.controller_entry_name, controllerTemplate, true, nextEntries)];
  }

  // Commit all changes in one atomic operation.
  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });

  // Mark floor binding: record which EW/Dyn/ entries belong to this message.
  if (settings.floor_binding_enabled && messageId >= 0) {
    const floorEntryNames = mergedPlan.worldbook.desired_entries
      .map(entry => entry.name)
      .filter(name => name.startsWith(settings.dynamic_entry_prefix));

    if (floorEntryNames.length > 0) {
      await markFloorEntries(messageId, floorEntryNames);
    }
  }

  return {
    worldbook_name: target.worldbook_name,
    chat_id: chatId,
    changed_count: nextEntries.length,
  };
}
