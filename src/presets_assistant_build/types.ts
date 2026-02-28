export type ApiBindingMode = 'sticky_connection' | 'follow_preset';
export type BrowseViewMode = 'cards' | 'list';
export type EditApplyMode = 'live' | 'draft';
export type UnsavedDecision = 'save' | 'discard' | 'cancel';

export interface ConnectionSnapshot {
  api_source: string;
  profile_name: string;
  model_name: string;
  api_url: string;
}

export interface PresetAssistantMeta {
  favorite: boolean;
  tags: string[];
  note: string;
  updated_at: number;
}

export interface QuickPromptToggleState {
  saving_ids: Set<string>;
  last_saved_at_by_id: Record<string, number>;
}

export interface BrowseParamDraftState {
  base_settings: Preset['settings'];
  staged_settings: Preset['settings'];
  dirty: boolean;
  applying: boolean;
}

export interface PresetAssistantStateV1 {
  version: 1;
  ui: {
    view_mode: BrowseViewMode;
    browse_param_panel_open: boolean;
    browse_param_last_expanded_group: string;
    api_binding_mode: ApiBindingMode;
    edit_apply_mode: EditApplyMode;
    last_selected_preset: string;
  };
  meta_by_preset: Record<string, PresetAssistantMeta>;
  tag_catalog: string[];
  sticky_connection_snapshot: ConnectionSnapshot | null;
}

export interface SettingOption {
  label: string;
  value: string;
}

export interface SettingField {
  key: keyof Preset['settings'];
  label: string;
  type: 'number' | 'boolean' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: SettingOption[];
}

export interface SettingGroup {
  id: string;
  title: string;
  fields: SettingField[];
}

export interface PromptQuickItem {
  index: number;
  key: string;
  id: string;
  name: string;
  role: PresetPrompt['role'];
  enabled: boolean;
  kind: 'normal' | 'system' | 'placeholder';
  is_saving: boolean;
  is_recently_saved: boolean;
}

export interface PresetSummary {
  name: string;
  prompt_count: number;
  enabled_prompt_count: number;
  favorite: boolean;
  tags: string[];
  note: string;
  is_loaded: boolean;
  is_selected: boolean;
}

export interface PendingAction {
  type: 'select' | 'switch';
  target_name: string;
}
