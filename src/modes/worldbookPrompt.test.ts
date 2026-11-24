import { describe, expect, it } from 'vitest';
import { buildWorldbookModeSystem } from '@/modes/worldbookPrompt';
import type { WorldbookModeProfile } from '@/modes/worldbookMode';

const profile = (overrides: Partial<WorldbookModeProfile> = {}): WorldbookModeProfile => ({
  profileType: 'inherit',
  enabled: true,
  mode: 'pair',
  coreBook: '双人核心书',
  coreBooks: { pair: '双人核心书', group: '群像核心书' },
  worldviewBook: '世界观书',
  worldview: '蒸汽都市',
  entryOverrides: {},
  modeEntryBindings: { pair: {}, group: {} },
  ...overrides,
});

describe('worldbook mode prompt contract', () => {
  it('does not affect native mode', () => {
    expect(buildWorldbookModeSystem(profile({ enabled: false }))).toBe('');
  });

  it('describes the selected pair profile and keeps book content subordinate to the task protocol', () => {
    const result = buildWorldbookModeSystem(profile());
    expect(result).toContain('双人模式');
    expect(result).toContain('双人核心书');
    expect(result).toContain('蒸汽都市');
    expect(result).toContain('不得强行补齐人数');
    expect(result).toContain('不得改变本次生图任务的输出结构');
  });

  it('uses the group-specific profile and does not leak the pair core book', () => {
    const result = buildWorldbookModeSystem(profile({
      mode: 'group',
      coreBook: '群像核心书',
    }));
    expect(result).toContain('群像模式');
    expect(result).toContain('群像核心书');
    expect(result).not.toContain('核心世界书：「双人核心书」');
    expect(result).toContain('不得为了凑人数虚构角色');
  });

  it('does not create a partial context when required book selection is incomplete', () => {
    expect(buildWorldbookModeSystem(profile({ worldview: '' }))).toBe('');
  });
});
