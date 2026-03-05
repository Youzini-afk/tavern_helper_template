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

function upsertEntry(entries: WorldbookEntry[], name: string, content: string, enabled: boolean): WorldbookEntry[] {
  const cloned = klona(entries);
  const existing = findEntry(cloned, name);
  if (existing) {
    existing.content = content;
    existing.enabled = enabled;
    return cloned;
  }

  cloned.push(ensureDefaultEntry(name, content, enabled, cloned));
  return cloned;
}

function deleteByNames(entries: WorldbookEntry[], names: string[]): WorldbookEntry[] {
  if (names.length === 0) {
    return klona(entries);
  }

  const nameSet = new Set(names);
  return entries.filter(entry => !nameSet.has(entry.name));
}

function toggleEntries(entries: WorldbookEntry[], toggles: Array<{ name: string; enabled: boolean }>): WorldbookEntry[] {
  const cloned = klona(entries);
  for (const toggle of toggles) {
    const entry = findEntry(cloned, toggle.name);
    if (!entry) {
      throw new Error(`toggle target entry not found: ${toggle.name}`);
    }
    entry.enabled = toggle.enabled;
  }
  return cloned;
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
    ...mergedPlan.worldbook.upsert_entries.map(entry => entry.name),
    ...mergedPlan.worldbook.delete_entries.map(entry => entry.name),
    ...mergedPlan.worldbook.toggle_entries.map(entry => entry.name),
  ];
  const unmanaged = allNames.filter(name => !isManagedEntryName(settings, name));
  if (unmanaged.length > 0) {
    throw new Error(`unmanaged entry name(s): ${unmanaged.join(', ')}`);
  }

  // Apply worldbook operations.
  let nextEntries = deleteByNames(beforeEntries, mergedPlan.worldbook.delete_entries.map(entry => entry.name));

  for (const upsert of mergedPlan.worldbook.upsert_entries) {
    nextEntries = upsertEntry(nextEntries, upsert.name, upsert.content, upsert.enabled);
  }

  nextEntries = toggleEntries(nextEntries, mergedPlan.worldbook.toggle_entries);

  // Write the EJS controller entry into the character worldbook.
  nextEntries = upsertEntry(nextEntries, settings.controller_entry_name, controllerTemplate, true);

  // Commit all changes in one atomic operation.
  await replaceWorldbook(target.worldbook_name, nextEntries, { render: 'debounced' });

  // Mark floor binding: record which EW/Dyn/ entries belong to this message.
  if (settings.floor_binding_enabled && messageId >= 0) {
    const floorEntryNames = mergedPlan.worldbook.upsert_entries
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
