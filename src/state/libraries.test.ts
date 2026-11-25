import { describe, expect, it } from 'vitest';
import {
  findWorkEntry,
  importPromptEntries,
  parsePromptLibraryJson,
  importWorkEntries,
  parseWorkLibraryJson,
  parseWorkLibraryText,
} from '@/state/libraries';

describe('work library compatibility', () => {
  it('imports prompt JSON safely and skips duplicate prompts', () => {
    const parsed = parsePromptLibraryJson(JSON.stringify({ entries: [
      { name: '氛围', category: '场景', promptEn: 'cinematic lighting', promptZh: '电影光', source: 'other', sourceNote: '作者链接', imagePath: '/user/images/ref.jpg' },
      { name: '', promptEn: 'invalid' },
    ] }));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].imagePath).toBe('/user/images/ref.jpg');
    const existing = [{ id: 'old', name: '氛围', category: '场景', promptEn: 'cinematic lighting', promptZh: '', source: 'original' as const, sourceNote: '', imagePath: '', createdAt: 1, updatedAt: 1 }];
    const result = importPromptEntries(existing, parsed);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.entries).toHaveLength(1);
  });
  it('parses Shizhen text format and extracts work names', () => {
    expect(parseWorkLibraryText(['角色甲=character a (作品A)', '# 注释', '角色乙=character b'].join(String.fromCharCode(10)))).toEqual([
      { name: '角色甲', canonical: 'character a (作品A)', work: '作品A' },
      { name: '角色乙', canonical: 'character b', work: '' },
    ]);
  });
  it('accepts both JSON arrays and entries envelopes', () => {
    expect(parseWorkLibraryJson('{"entries":[{"name":"角色甲","canonical":"alpha","work":"作品A"}]}')).toEqual([
      { name: '角色甲', canonical: 'alpha', work: '作品A' },
    ]);
  });
  it('deduplicates by localized name and work, not by canonical tag', () => {
    const existing = [{ id: '1', name: '角色甲', canonical: 'alpha', work: '作品A' }];
    const result = importWorkEntries(existing, [
      { name: '角色甲', canonical: 'alpha changed', work: '作品A' },
      { name: '角色甲', canonical: 'beta', work: '作品B' },
    ]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.entries).toHaveLength(2);
  });
  it('resolves pipe-separated aliases and bare canonical tags', () => {
    const entries = [{ id: '1', name: '角色甲|甲别名', canonical: 'alpha (作品A)', work: '作品A' }];
    expect(findWorkEntry(entries, '甲别名')?.canonical).toBe('alpha (作品A)');
    expect(findWorkEntry(entries, 'alpha')?.name).toBe('角色甲|甲别名');
  });
});
