import { describe, expect, it } from 'vitest';
import {
  makeCharacterBindingKey,
  mapShizhenComboReferences,
  mapShizhenTarget,
  removeArtistCombo,
  resolveArtistTarget,
} from '@/backends/shizhenArtistProfiles';
import type { NaiArtistProfileSettings } from '@/state/settings';

const profiles: NaiArtistProfileSettings = {
  combos: [
    { id: 'combo-a', name: 'A', artistId: 'artist-a', vibeId: 'vibe-a', updatedAt: 1 },
    { id: 'combo-b', name: 'B', artistId: '', vibeId: '', updatedAt: 2 },
  ],
  global: {
    body: { comboId: 'combo-a', size: '832x1216' },
    statusBar: { comboId: 'combo-b', size: '' },
    egg: { comboId: '', size: '' },
  },
  bindings: [{
    characterKey: 'avatar:hero.png',
    characterName: 'Hero',
    body: { comboId: 'combo-b', size: '1024x1024' },
    statusBar: { comboId: '', size: '' },
    egg: { comboId: '', size: '' },
  }],
};

describe('Shizhen artist profile mapping', () => {
  it('把拾帧数组下标引用转换为柏宝绘稳定 ID', () => {
    const combos = mapShizhenComboReferences(
      [{ name: '组合 A', artistIndex: 1, vibeIndex: 0 }, { name: '空组合', artistIndex: -1, vibeIndex: -1 }],
      ['artist-a', 'artist-b'],
      ['vibe-a'],
      index => `combo-${index}`,
    );
    expect(combos.map(item => [item.artistId, item.vibeId])).toEqual([
      ['artist-b', 'vibe-a'],
      ['', ''],
    ]);
  });

  it('拾帧正文、状态栏、彩蛋绑定字段独立映射', () => {
    expect(mapShizhenTarget(0, '832x1216', ['combo-a'])).toEqual({
      comboId: 'combo-a',
      size: '832x1216',
    });
    expect(mapShizhenTarget(-1, '', ['combo-a'])).toEqual({ comboId: '', size: '' });
  });

  it('优先使用角色头像名作为稳定绑定键', () => {
    expect(makeCharacterBindingKey('hero.png', 'Hero', 3)).toBe('avatar:hero.png');
    expect(makeCharacterBindingKey('', 'Hero', 3)).toBe('name:Hero');
    expect(makeCharacterBindingKey('', '', 3)).toBe('legacy-index:3');
  });

  it('角色目标缺少覆盖时回退通用目标', () => {
    expect(resolveArtistTarget(profiles, 'avatar:hero.png', 'body')).toEqual({
      comboId: 'combo-b',
      size: '1024x1024',
    });
    expect(resolveArtistTarget(profiles, 'avatar:hero.png', 'statusBar')).toEqual({
      comboId: 'combo-b',
      size: '',
    });
    expect(resolveArtistTarget(profiles, 'unknown', 'egg')).toEqual({
      comboId: '',
      size: '',
    });
  });

  it('删除组合时清除所有悬空引用，但保留其他组合', () => {
    const next = removeArtistCombo(profiles, 'combo-a');
    expect(next.combos.map(item => item.id)).toEqual(['combo-b']);
    expect(next.global.body.comboId).toBe('');
    expect(next.bindings[0].body.comboId).toBe('combo-b');
  });
});
