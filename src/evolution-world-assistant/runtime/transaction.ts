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
  const result = klona(currentEntries.filter(entry => !removeSet.has(entry.name)));

  // Step 2: Build an index for O(1) lookups.
  const indexByName = new Map<string, number>();
  for (let i = 0; i < result.length; i++) {
    indexByName.set(result[i].name, i);
  }

  // Step 3: Apply desired state (in-place on the already-cloned array).
  for (const desired of desiredEntries) {
    const existingIndex = indexByName.get(desired.name);

    if (existingIndex !== undefined) {
      result[existingIndex].content = desired.content;
      result[existingIndex].enabled = desired.enabled;
    } else {
      const newEntry = ensureDefaultEntry(desired.name, desired.content, desired.enabled, result);
      indexByName.set(desired.name, result.length);
      result.push(newEntry);
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
  const nextEntries = applyDeclarativeDiff(
    beforeEntries,
    mergedPlan.worldbook.desired_entries,
    mergedPlan.worldbook.remove_entries,
  );

  // Write the EJS controller entry into the character worldbook.
  const ctrlExisting = nextEntries.find(e => e.name === settings.controller_entry_name);
  if (ctrlExisting) {
    // CR-3: nextEntries is already a deep clone from applyDeclarativeDiff — modify in-place.
    ctrlExisting.content = controllerTemplate;
    ctrlExisting.enabled = true;
  } else {
    nextEntries.push(ensureDefaultEntry(settings.controller_entry_name, controllerTemplate, true, nextEntries, true));
  }

  // Commit all changes in one atomic operation.
  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });

  // Mark floor binding: record which EW/Dyn/ entries + Controller snapshot belong to this message.
  if (settings.floor_binding_enabled && messageId >= 0) {
    const floorEntryNames = mergedPlan.worldbook.desired_entries
      .map(entry => entry.name)
      .filter(name => name.startsWith(settings.dynamic_entry_prefix));

    if (floorEntryNames.length > 0 || controllerTemplate) {
      await markFloorEntries(messageId, floorEntryNames, controllerTemplate);
    }
  }

  return {
    worldbook_name: target.worldbook_name,
    chat_id: chatId,
    changed_count: nextEntries.length,
  };
}
