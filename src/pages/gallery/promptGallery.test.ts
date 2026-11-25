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

import { matchPromptGalleryEntry } from '@/pages/gallery/promptGallery';
describe('prompt gallery automatic matching', () => {
 it('matches exact prompt text after wrapper and whitespace normalization', () => {
  expect(matchPromptGalleryEntry('<bbi_image>blue hair, smiling</bbi_image>', [{id:'a',promptEn:'blue hair smiling'}])?.id).toBe('a');
 });
 it('does not match partial or similar prompt strings', () => {
  expect(matchPromptGalleryEntry('blue hair smiling', [{id:'a',promptEn:'blue hair smiling with flowers'}])).toBeNull();
 });
});

import { imageInPromptGallery, updatePromptGalleryMembership } from '@/pages/gallery/promptGallery';
describe('prompt gallery membership map', () => {
 it('stores multiple galleries for one image without duplicates',()=>{
  const a=updatePromptGalleryMembership({},'path/image.png','p1',true);
  const b=updatePromptGalleryMembership(a,'path/image.png','p2',true);
  const c=updatePromptGalleryMembership(b,'path/image.png','p1',true);
  expect(c['path/image.png']).toEqual(['p1','p2']);
  expect(imageInPromptGallery(c,'path/image.png','p2')).toBe(true);
 });
 it('removes only selected gallery and deletes empty keys',()=>{
  const a={key:['p1','p2']};
  const b=updatePromptGalleryMembership(a,'key','p1',false);
  expect(b.key).toEqual(['p2']);
  expect(updatePromptGalleryMembership(b,'key','p2',false)).toEqual({});
 });
 it('ignores empty path and prompt IDs',()=>{
  expect(updatePromptGalleryMembership({},'','p1',true)).toEqual({});
  expect(updatePromptGalleryMembership({},'x','',true)).toEqual({});
 });
});
