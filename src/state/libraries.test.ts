import { describe, expect, it } from 'vitest';
import {
  findWorkEntry,
  importWorkEntries,
  parseWorkLibraryJson,
  parseWorkLibraryText,
} from '@/state/libraries';

describe('work library compatibility', () => {
  it('parses Shizhen text format and extracts work names', () => {
    expect(parseWorkLibraryText('角色甲=character a (作品A)\\n# 注释\\n角色乙=character b')).toEqual([
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
