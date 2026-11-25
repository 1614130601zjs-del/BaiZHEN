import { describe, expect, it } from 'vitest';
import { applyGenericWords } from './genericWords';
import type { GenericWordsSettings } from '@/state/settings';

const config = (overrides: Partial<GenericWordsSettings> = {}): GenericWordsSettings => ({
  on: true, anyOn: true, position: 'back',
  sets: [
    { id: 'f', name: '女性', gender: 'female', text: 'slim waist', negative: 'bad anatomy' },
    { id: 'm', name: '男性', gender: 'male', text: 'broad shoulders', negative: 'bad hands' },
    { id: 'a', name: '通用', gender: 'any', text: 'masterpiece', negative: 'low quality' },
  ],
  pick: { female: 'f', male: 'm', any: 'a' }, ...overrides,
});
describe('applyGenericWords', () => {
  it('does nothing when disabled', () => expect(applyGenericWords({ prompt: '1girl' }, config({ on: false })).prompt).toBe('1girl'));
  it('applies a single gender and common group to the base prompt', () => {
    const result = applyGenericWords({ prompt: '1girl' }, config());
    expect(result.prompt).toBe('1girl, slim waist, masterpiece');
    expect(result.negative).toBe('low quality, bad anatomy');
  });
  it('adds gender words to each character for mixed-gender scenes', () => {
    const result = applyGenericWords({ prompt: '2people', characters: [
      { name: 'A', tag: 'girl, long hair', nl: '' }, { name: 'B', tag: 'boy, short hair', nl: '' },
    ] }, config());
    expect(result.prompt).toBe('2people, masterpiece');
    expect(result.characters?.[0].tag).toContain('slim waist');
    expect(result.characters?.[1].tag).toContain('broad shoulders');
    expect(result.negative).toBe('low quality, bad anatomy, bad hands');
  });
  it('supports front insertion and deduplicates tags', () => {
    const result = applyGenericWords({ prompt: 'masterpiece, 1girl' }, config({ position: 'front' }));
    expect(result.prompt).toBe('slim waist, masterpiece, 1girl');
  });
  it('does not add disabled common words or unknown gender groups', () => {
    const result = applyGenericWords({ prompt: 'landscape' }, config({ anyOn: false }));
    expect(result.prompt).toBe('landscape');
    expect(result.negative).toBe('');
  });
  it('skips egg prompts and preserves empty configurations', () => {
    expect(applyGenericWords({ prompt: '1girl', artistTarget: 'egg' }, config()).prompt).toBe('1girl');
    expect(applyGenericWords({ prompt: '1girl' }, config({ sets: [], pick: {} })).prompt).toBe('1girl');
  });
});
