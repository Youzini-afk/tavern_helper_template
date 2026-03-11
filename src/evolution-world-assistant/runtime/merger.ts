import { ControllerModel } from './contracts';
import { checkEjsSyntax } from './ejs-internal';
import { EwSettings, MergeInput, MergedPlan, Prioritized } from './types';

function comparePriority(
  lhs: { priority: number; flow_order: number },
  rhs: { priority: number; flow_order: number },
): number {
  if (lhs.priority !== rhs.priority) {
    return rhs.priority - lhs.priority;
  }
  return lhs.flow_order - rhs.flow_order;
}

function shouldReplace<T>(current: Prioritized<T> | undefined, next: Prioritized<T>): boolean {
  if (!current) {
    return true;
  }
  if (next.priority > current.priority) {
    return true;
  }
  if (next.priority < current.priority) {
    return false;
  }
  return next.flow_order >= current.flow_order;
}

/**
 * Normalize an entry name: bare names get the dynamic entry prefix.
 * Names that already have the prefix, or match the controller entry name, are untouched.
 */
function normalizeEntryName(name: string, prefix: string, controllerName: string): string {
  if (name.startsWith(prefix)) return name;
  if (name === controllerName) return name;
  return prefix + name;
}

export function mergeFlowResults(results: MergeInput, settings: EwSettings): MergedPlan {
  const sorted = [...results].sort((lhs, rhs) =>
    comparePriority(
      { priority: lhs.flow.priority, flow_order: lhs.flow_order },
      { priority: rhs.flow.priority, flow_order: rhs.flow_order },
    ),
  );

  // Declarative: desired_entries (final state) and remove_entries (deletions).
  const desiredMap = new Map<string, Prioritized<{ content: string; enabled: boolean }>>();
  const removeMap = new Map<string, Prioritized<null>>();

  let controllerModel: Prioritized<ControllerModel> | undefined;
  const replyParts: string[] = [];
  const diagnostics: Record<string, any> = {};

  for (const result of sorted) {
    const priority = result.flow.priority;
    const flowOrder = result.flow_order;
    const worldbookOps = result.response.operations.worldbook;

    for (const desired of worldbookOps.desired_entries) {
      const normalizedName = normalizeEntryName(
        desired.name,
        settings.dynamic_entry_prefix,
        settings.controller_entry_name,
      );
      const next: Prioritized<{ content: string; enabled: boolean }> = {
        value: { content: desired.content, enabled: desired.enabled },
        priority,
        flow_order: flowOrder,
      };
      const current = desiredMap.get(normalizedName);
      if (shouldReplace(current, next)) {
        desiredMap.set(normalizedName, next);
      }
    }

    for (const removal of worldbookOps.remove_entries) {
      const normalizedName = normalizeEntryName(
        removal.name,
        settings.dynamic_entry_prefix,
        settings.controller_entry_name,
      );
      const next: Prioritized<null> = { value: null, priority, flow_order: flowOrder };
      const current = removeMap.get(normalizedName);
      if (shouldReplace(current, next)) {
        removeMap.set(normalizedName, next);
      }
    }

    if (result.response.operations.controller_model) {
      const next: Prioritized<ControllerModel> = {
        value: result.response.operations.controller_model,
        priority,
        flow_order: flowOrder,
      };
      if (shouldReplace(controllerModel, next)) {
        controllerModel = next;
      }
    }

    if (result.response.reply_instruction.trim()) {
      replyParts.push(`[Flow:${result.flow.id}]\n${result.response.reply_instruction.trim()}`);
    }

    diagnostics[result.flow.id] = result.response.diagnostics;
  }

  // Conflict resolution: remove wins over desired when priority is >= .
  for (const [name, removal] of removeMap.entries()) {
    const desired = desiredMap.get(name);
    if (!desired) {
      continue;
    }

    if (removal.priority >= desired.priority) {
      desiredMap.delete(name);
    } else {
      removeMap.delete(name);
    }
  }

  const fallbackController: ControllerModel = {
    template_id: 'entry_selector_v1',
    variables: [],
    rules: [],
    fallback_entries: [],
  };

  if (!controllerModel) {
    console.warn('[EW Merger] No flow returned controller_model — using empty fallback.');
  }

  const desiredEntries = [...desiredMap.entries()].map(([name, value]) => ({
    name,
    content: value.value.content,
    enabled: value.value.enabled,
  }));

  // EJS syntax validation: warn (but do not block) on malformed EJS in entries.
  for (const entry of desiredEntries) {
    const err = checkEjsSyntax(entry.content);
    if (err) {
      console.warn(`[EW Merger] EJS syntax error in entry "${entry.name}":`, err);
      try {
        (globalThis as any).toastr?.warning(`EJS 语法错误: ${entry.name}`, 'Evolution World');
      } catch {
        /* noop */
      }
    }
  }

  // Normalize entry names inside controller_model (add EW/Dyn/ prefix).
  // Without this, getwi() would look for '小雪' but the entry is 'EW/Dyn/小雪'.
  const rawControllerModel = controllerModel ? controllerModel.value : fallbackController;
  const normalizedController: ControllerModel = {
    ...rawControllerModel,
    fallback_entries: rawControllerModel.fallback_entries.map(name =>
      normalizeEntryName(name, settings.dynamic_entry_prefix, settings.controller_entry_name),
    ),
    activate_entries: (rawControllerModel.activate_entries ?? []).map(entry => ({
      ...entry,
      entry: normalizeEntryName(entry.entry, settings.dynamic_entry_prefix, settings.controller_entry_name),
    })),
    rules: rawControllerModel.rules.map(rule => ({
      ...rule,
      include_entries: rule.include_entries.map(name =>
        normalizeEntryName(name, settings.dynamic_entry_prefix, settings.controller_entry_name),
      ),
    })),
  };

  return {
    worldbook: {
      desired_entries: desiredEntries,
      remove_entries: [...removeMap.keys()].map(name => ({ name })),
    },
    controller_model: normalizedController,
    reply_instruction: replyParts.join('\n\n'),
    diagnostics,
  };
}
