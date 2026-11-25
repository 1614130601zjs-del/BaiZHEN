/**
 * Prompt-specific gallery membership helpers.
 * Keeps prompt-gallery collection semantics separate from the character album.
 * A record may belong to one prompt gallery; exclusion IDs prevent an image
 * intentionally removed from a gallery from reappearing through auto-collection.
 */
export interface PromptGalleryRecord {
  id?: string;
  promptEntryId?: string;
  sourcePromptEntryId?: string;
  promptGalleryExcludedIds?: string[];
  collection?: string;
}

export interface PromptGalleryPrompt {
  id: string;
}

export function recordBelongsToPromptGallery(record: PromptGalleryRecord, prompt: PromptGalleryPrompt): boolean {
  const id = String(prompt?.id ?? '').trim();
  if (!id || record.collection === 'cache') return false;
  if (Array.isArray(record.promptGalleryExcludedIds) && record.promptGalleryExcludedIds.includes(id)) return false;
  return record.promptEntryId === id || record.sourcePromptEntryId === id;
}

export function assignPromptGallery(
  record: PromptGalleryRecord,
  promptId: string,
  options: { source?: boolean } = {},
): PromptGalleryRecord {
  const id = String(promptId ?? '').trim();
  if (!id) throw new Error('提示词图集 ID 不能为空');
  const excluded = Array.isArray(record.promptGalleryExcludedIds)
    ? record.promptGalleryExcludedIds.filter(value => value !== id)
    : [];
  return {
    ...record,
    promptGalleryExcludedIds: excluded,
    ...(options.source ? { sourcePromptEntryId: id } : { promptEntryId: id }),
    collection: 'prompt-gallery',
  };
}

export function removeFromPromptGallery(record: PromptGalleryRecord, promptId: string, moveToCache = true): PromptGalleryRecord {
  const id = String(promptId ?? '').trim();
  const excluded = Array.isArray(record.promptGalleryExcludedIds) ? [...record.promptGalleryExcludedIds] : [];
  if (id && !excluded.includes(id)) excluded.push(id);
  const next: PromptGalleryRecord = { ...record, promptGalleryExcludedIds: excluded };
  delete next.promptEntryId;
  delete next.sourcePromptEntryId;
  if (moveToCache) next.collection = 'cache';
  return next;
}
