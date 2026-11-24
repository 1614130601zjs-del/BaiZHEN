import { describe, expect, it } from 'vitest';
import {
  buildGenerationModeSystem,
  getGenerationModeWorldNames,
  registerGenerationModeStrategy,
  type GenerationModeSnapshot,
} from '@/modes/dispatcher';
import type { WorldbookModeProfile } from '@/modes/worldbookMode';
const profile: WorldbookModeProfile = {
  profileType: 'inherit', enabled: true, mode: 'pair', coreBook: '核心书',
  coreBooks: { pair: '核心书', group: '群像书' }, worldviewBook: '世界观书',
  worldview: '蒸汽都市', entryOverrides: {}, worldviewEntryOverrides: {}, modeEntryBindings: { pair: {}, group: {} },
};
describe('generation mode dispatcher', () => {
  it('routes a task to exactly one native or worldbook strategy', () => {
    const native: GenerationModeSnapshot = { mode: 'native', worldbookProfile: { ...profile, enabled: false } };
    expect(buildGenerationModeSystem(native)).toBe('');
    expect(getGenerationModeWorldNames(native)).toBeUndefined();
    const worldbook: GenerationModeSnapshot = { mode: 'worldbook', worldbookProfile: profile };
    expect(buildGenerationModeSystem(worldbook)).toContain('双人模式');
    expect(getGenerationModeWorldNames(worldbook)).toEqual(['核心书', '世界观书']);
  });
  it('supports a future strategy without replacing built-in modes', () => {
    const strategy = { id: 'future-mode', buildSystemContext: () => 'future context', allowedWorldNames: () => ['future-book'] };
    const unregister = registerGenerationModeStrategy(strategy);
    try {
      const snapshot: GenerationModeSnapshot = { mode: 'future-mode', worldbookProfile: profile };
      expect(buildGenerationModeSystem(snapshot)).toBe('future context');
      expect(getGenerationModeWorldNames(snapshot)).toEqual(['future-book']);
      expect(buildGenerationModeSystem({ mode: 'native', worldbookProfile: profile })).toBe('');
    } finally { unregister(); }
  });
  it('rejects replacing built-in modes and duplicate registrations', () => {
    expect(() => registerGenerationModeStrategy({ id: 'native', buildSystemContext: () => '', allowedWorldNames: () => [] })).toThrow();
    const strategy = { id: 'temporary', buildSystemContext: () => '', allowedWorldNames: () => undefined };
    const unregister = registerGenerationModeStrategy(strategy);
    try { expect(() => registerGenerationModeStrategy(strategy)).toThrow(); } finally { unregister(); }
  });
});
