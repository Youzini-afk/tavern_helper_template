import { klona } from 'klona';
import _ from 'lodash';

import type {
  ApiBindingMode,
  BrowseViewMode,
  ConnectionSnapshot,
  EditApplyMode,
  PresetAssistantMeta,
  PresetAssistantStateV1,
} from '../types';

const STORAGE_KEY = '__preset_assistant_state_v1__';

export function createDefaultAssistantState(): PresetAssistantStateV1 {
  return {
    version: 1,
    ui: {
      view_mode: 'cards',
      browse_param_panel_open: true,
      browse_param_last_expanded_group: 'context',
      api_binding_mode: 'sticky_connection',
      edit_apply_mode: 'live',
      last_selected_preset: '',
    },
    meta_by_preset: {},
    tag_catalog: [],
    sticky_connection_snapshot: null,
  };
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map(item => normalizeString(item).trim()).filter(Boolean))];
}

function normalizeMeta(value: unknown): PresetAssistantMeta {
  const raw = _.isPlainObject(value) ? (value as Record<string, unknown>) : {};
  return {
    favorite: raw.favorite === true,
    tags: normalizeStringArray(raw.tags),
    note: normalizeString(raw.note),
    updated_at: _.isNumber(raw.updated_at) ? raw.updated_at : 0,
  };
}

function normalizeMetaMap(value: unknown): Record<string, PresetAssistantMeta> {
  if (!_.isPlainObject(value)) {
    return {};
  }
  const result: Record<string, PresetAssistantMeta> = {};
  for (const [key, meta] of Object.entries(value)) {
    const name = normalizeString(key).trim();
    if (!name) {
      continue;
    }
    result[name] = normalizeMeta(meta);
  }
  return result;
}

function normalizeBindingMode(value: unknown): ApiBindingMode {
  return value === 'follow_preset' ? 'follow_preset' : 'sticky_connection';
}

function normalizeViewMode(value: unknown): BrowseViewMode {
  return value === 'list' ? 'list' : 'cards';
}

function normalizeEditApplyMode(value: unknown): EditApplyMode {
  return value === 'draft' ? 'draft' : 'live';
}

function normalizeConnectionSnapshot(value: unknown): ConnectionSnapshot | null {
  if (!_.isPlainObject(value)) {
    return null;
  }
  return {
    api_source: normalizeString((value as Record<string, unknown>).api_source),
    profile_name: normalizeString((value as Record<string, unknown>).profile_name),
    model_name: normalizeString((value as Record<string, unknown>).model_name),
    api_url: normalizeString((value as Record<string, unknown>).api_url),
  };
}

export function normalizeAssistantState(input: unknown): PresetAssistantStateV1 {
  if (!_.isPlainObject(input)) {
    return createDefaultAssistantState();
  }
  const raw = input as Record<string, unknown>;
  const uiRaw = _.isPlainObject(raw.ui) ? (raw.ui as Record<string, unknown>) : {};
  const base = createDefaultAssistantState();
  return {
    version: 1,
    ui: {
      view_mode: normalizeViewMode(uiRaw.view_mode),
      browse_param_panel_open:
        typeof uiRaw.browse_param_panel_open === 'boolean'
          ? uiRaw.browse_param_panel_open
          : base.ui.browse_param_panel_open,
      browse_param_last_expanded_group:
        normalizeString(uiRaw.browse_param_last_expanded_group, base.ui.browse_param_last_expanded_group) ||
        base.ui.browse_param_last_expanded_group,
      api_binding_mode: normalizeBindingMode(uiRaw.api_binding_mode),
      edit_apply_mode: normalizeEditApplyMode(uiRaw.edit_apply_mode),
      last_selected_preset: normalizeString(uiRaw.last_selected_preset),
    },
    meta_by_preset: normalizeMetaMap(raw.meta_by_preset),
    tag_catalog: normalizeStringArray(raw.tag_catalog),
    sticky_connection_snapshot: normalizeConnectionSnapshot(raw.sticky_connection_snapshot),
  };
}

export function readAssistantState(): PresetAssistantStateV1 {
  try {
    const variables = getVariables({ type: 'script', script_id: getScriptId() });
    return normalizeAssistantState(variables[STORAGE_KEY]);
  } catch (error) {
    console.warn('[PresetAssistant] read state failed:', error);
    return createDefaultAssistantState();
  }
}

export function writeAssistantState(state: PresetAssistantStateV1): void {
  try {
    const normalized = normalizeAssistantState(state);
    const variables = getVariables({ type: 'script', script_id: getScriptId() });
    variables[STORAGE_KEY] = normalized;
    replaceVariables(variables, { type: 'script', script_id: getScriptId() });
  } catch (error) {
    console.warn('[PresetAssistant] write state failed:', error);
  }
}

export function mutateAssistantState(
  state: PresetAssistantStateV1,
  mutator: (draft: PresetAssistantStateV1) => void,
): PresetAssistantStateV1 {
  const draft = klona(state);
  mutator(draft);
  return normalizeAssistantState(draft);
}
