import { describe, expect, it } from 'vitest';
import { normalizeWorldbookModeProfile } from '@/modes/worldbookMode';

describe('normalizeWorldbookModeProfile', () => {
  it('将旧版世界观条目覆盖迁移到独立字段', () => {
    const profile = normalizeWorldbookModeProfile({
      worldviewBook: '世界观书',
      entryOverrides: { 世界观书: { 'entry-a': false, 'entry-b': true }, 核心书: { 'core-a': false } },
    });
    expect(profile.worldviewEntryOverrides).toEqual({
      世界观书: { 'entry-a': false, 'entry-b': true },
    });
    expect(profile.entryOverrides).toEqual({
      世界观书: { 'entry-a': false, 'entry-b': true },
      核心书: { 'core-a': false },
    });
  });

  it('新字段优先，且不会把普通条目覆盖混入世界观覆盖', () => {
    const profile = normalizeWorldbookModeProfile({
      worldviewBook: '世界观书',
      entryOverrides: { 世界观书: { 'entry-a': false }, 核心书: { 'core-a': true } },
      worldviewEntryOverrides: { 世界观书: { 'entry-b': true } },
    });
    expect(profile.worldviewEntryOverrides).toEqual({ 世界观书: { 'entry-b': true } });
    expect(profile.entryOverrides.核心书).toEqual({ 'core-a': true });
  });

  it('缺失或错误结构回落到安全默认值', () => {
    const profile = normalizeWorldbookModeProfile({ mode: 'invalid', enabled: 'true', entryOverrides: null });
    expect(profile.mode).toBe('pair');
    expect(profile.enabled).toBe(false);
    expect(profile.entryOverrides).toEqual({});
    expect(profile.worldviewEntryOverrides).toEqual({});
    expect(profile.modeEntryBindings).toEqual({ pair: {}, group: {} });
  });
});
