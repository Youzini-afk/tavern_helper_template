// MagVarUpdate source-aligned MVU filtering helpers.
// Keep these rules narrow so we avoid MVU artifacts without harming normal lore/prompt content.

export const MVU_ENTRY_COMMENT_REGEX = /\[(mvu_update|mvu_plot|initvar)\]/i;

const MVU_UPDATE_BLOCK_REGEX = /\n?<(update(?:variable)?|variableupdate)>(?:(?!<\1>).)*<\/\1?>/gis;
const MVU_STATUS_PLACEHOLDER_REGEX = /\n?<StatusPlaceHolderImpl\/>/gi;

export function isMvuTaggedWorldInfoComment(comment: string): boolean {
  return MVU_ENTRY_COMMENT_REGEX.test(comment);
}

export function stripMvuPromptArtifacts(content: string): string {
  if (!content) {
    return '';
  }

  return content.replace(MVU_UPDATE_BLOCK_REGEX, '').replace(MVU_STATUS_PLACEHOLDER_REGEX, '').trim();
}
