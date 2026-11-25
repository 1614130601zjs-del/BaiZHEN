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

export interface PromptGalleryLibraryEntry { id: string; promptEn?: string; prompt?: string }
function normalizeGalleryPrompt(value: string): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\b(?:bbi_image|image|prompt)\b/gi, ' ')
    .replace(/[\\s,，、/／|;；·]+/gu, ' ').trim().toLowerCase();
}
/** Exact normalized matching only; avoid automatically linking near-matching prompts. */
export function matchPromptGalleryEntry(
  promptText: string,
  entries: PromptGalleryLibraryEntry[],
): PromptGalleryLibraryEntry | null {
  const target = normalizeGalleryPrompt(promptText);
  if (!target) return null;
  return entries.find(entry => normalizeGalleryPrompt(entry.promptEn || entry.prompt || '') === target) || null;
}

export type PromptGalleryMembershipStore = Record<string, string[]>;
export function updatePromptGalleryMembership(
  store: PromptGalleryMembershipStore,
  imageKey: string,
  promptId: string,
  include: boolean,
): PromptGalleryMembershipStore {
  const key = String(imageKey || '').trim(), id = String(promptId || '').trim();
  if (!key || !id) return store;
  const next = { ...store };
  const ids = [...(next[key] || [])];
  if (include && !ids.includes(id)) ids.push(id);
  if (!include) {
    const filtered = ids.filter(value => value !== id);
    if (filtered.length) next[key] = filtered; else delete next[key];
  } else next[key] = ids;
  return next;
}
export function imageInPromptGallery(store: PromptGalleryMembershipStore, imageKey: string, promptId: string): boolean {
  return Boolean(imageKey && promptId && store[imageKey]?.includes(promptId));
}
