import { MergeInput, MergedPlan, Prioritized } from './types';
import { ControllerModel } from './contracts';

function comparePriority(lhs: { priority: number; flow_order: number }, rhs: { priority: number; flow_order: number }): number {
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

export function mergeFlowResults(results: MergeInput): MergedPlan {
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
      const next: Prioritized<{ content: string; enabled: boolean }> = {
        value: { content: desired.content, enabled: desired.enabled },
        priority,
        flow_order: flowOrder,
      };
      const current = desiredMap.get(desired.name);
      if (shouldReplace(current, next)) {
        desiredMap.set(desired.name, next);
      }
    }

    for (const removal of worldbookOps.remove_entries) {
      const next: Prioritized<null> = { value: null, priority, flow_order: flowOrder };
      const current = removeMap.get(removal.name);
      if (shouldReplace(current, next)) {
        removeMap.set(removal.name, next);
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

  return {
    worldbook: {
      desired_entries: [...desiredMap.entries()].map(([name, value]) => ({
        name,
        content: value.value.content,
        enabled: value.value.enabled,
      })),
      remove_entries: [...removeMap.keys()].map(name => ({ name })),
    },
    controller_model: controllerModel ? controllerModel.value : fallbackController,
    reply_instruction: replyParts.join('\n\n'),
    diagnostics,
  };
}
