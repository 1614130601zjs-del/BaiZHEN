import { describe, expect, it } from 'vitest';
import { assignPromptGallery, recordBelongsToPromptGallery, removeFromPromptGallery } from '@/pages/gallery/promptGallery';

describe('prompt gallery helpers', () => {
  it('associates records and excludes cache records', () => {
    const record = assignPromptGallery({ id: 'img1' }, 'p1');
    expect(recordBelongsToPromptGallery(record, { id: 'p1' })).toBe(true);
    expect(recordBelongsToPromptGallery({ ...record, collection: 'cache' }, { id: 'p1' })).toBe(false);
  });
  it('supports source association and independent prompt IDs', () => {
    const record = assignPromptGallery({ id: 'img1' }, 'p1', { source: true });
    expect(recordBelongsToPromptGallery(record, { id: 'p1' })).toBe(true);
    expect(recordBelongsToPromptGallery(record, { id: 'p2' })).toBe(false);
    expect(recordBelongsToPromptGallery({ ...record, promptGalleryExcludedIds: ['p1'] }, { id: 'p1' })).toBe(false);
  });
  it('removes the link and records exclusion to prevent re-collection', () => {
    const record = assignPromptGallery({ id: 'img1' }, 'p1');
    const next = removeFromPromptGallery(record, 'p1');
    expect(next.promptEntryId).toBeUndefined();
    expect(next.sourcePromptEntryId).toBeUndefined();
    expect(next.collection).toBe('cache');
    expect(next.promptGalleryExcludedIds).toEqual(['p1']);
    expect(recordBelongsToPromptGallery(next, { id: 'p1' })).toBe(false);
  });
  it('rejects empty IDs', () => {
    expect(() => assignPromptGallery({}, ' ')).toThrow('提示词图集 ID 不能为空');
  });
});
