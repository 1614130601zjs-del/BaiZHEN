import { describe, expect, it } from 'vitest';
import {
  makeCharacterBindingKey,
  mapShizhenComboReferences,
  mapShizhenTarget,
  applyArtistProfileToNai,
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
      size: '1024x1024',
    });
    expect(resolveArtistTarget(profiles, 'unknown', 'egg')).toEqual({
      comboId: 'combo-a',
      size: '832x1216',
    });
  });

  it('删除组合时清除所有悬空引用，但保留其他组合', () => {
    const next = removeArtistCombo(profiles, 'combo-a');
    expect(next.combos.map(item => item.id)).toEqual(['combo-b']);
    expect(next.global.body.comboId).toBe('');
    expect(next.bindings[0].body.comboId).toBe('combo-b');
  });
});


describe('request-local artist profile application', () => {
  it('只在本次请求应用组合，不修改原生画师串和 Vibe 开关', () => {
    const native = {
      activeArtistId: 'native-artist',
      artistPresets: [{ id: 'combo-artist', name: 'Combo', prompt: 'artist:combo', quality: '', negative: '' }],
      vibes: [
        { id: 'native-vibe', enabled: true, strength: 0.5 },
        { id: 'combo-vibe', enabled: false, strength: 0.7 },
      ],
      portraitSize: '832x1216',
      landscapeSize: '1216x832',
      shizhenArtistProfiles: {
        ...profiles,
        global: { ...profiles.global, body: { comboId: 'combo-a', size: '1024x1024' } },
        combos: [{ id: 'combo-a', name: 'A', artistId: 'combo-artist', vibeId: 'combo-vibe', updatedAt: 1 }],
      },
    } as unknown as import('@/state/settings').NaiSettings;

    const result = applyArtistProfileToNai(native, '', 'body');
    expect(result.applied).toBe(true);
    expect(result.nai.activeArtistId).toBe('combo-artist');
    expect(result.nai.vibes.map(vibe => vibe.enabled)).toEqual([false, true]);
    expect(result.nai.portraitSize).toBe('1024x1024');
    expect(native.activeArtistId).toBe('native-artist');
    expect(native.vibes.map(vibe => vibe.enabled)).toEqual([true, false]);
    expect(native.portraitSize).toBe('832x1216');
  });

  it('未选择拾帧组合时完全沿用原生配置', () => {
    const emptyProfiles = {
      combos: [],
      global: {
        body: { comboId: '', size: '' },
        statusBar: { comboId: '', size: '' },
        egg: { comboId: '', size: '' },
      },
      bindings: [],
    } as NaiArtistProfileSettings;
    const native = { activeArtistId: 'native', vibes: [], shizhenArtistProfiles: emptyProfiles } as unknown as import('@/state/settings').NaiSettings;
    const result = applyArtistProfileToNai(native, 'unknown', 'body');
    expect(result.applied).toBe(false);
    expect(result.nai).toBe(native);
  });
});


describe('profile size-only and target fallback', () => {
  it('状态栏和彩蛋没有单独设置时继承正文', () => {
    const result = resolveArtistTarget({
      ...profiles,
      global: {
        body: { comboId: 'combo-a', size: '1024x1024' },
        statusBar: { comboId: '', size: '' },
        egg: { comboId: '', size: '' },
      },
      bindings: [],
    }, '', 'egg');
    expect(result).toEqual({ comboId: 'combo-a', size: '1024x1024' });
  });

  it('允许只配置尺寸而不选择组合', () => {
    const native = {
      activeArtistId: 'native',
      vibes: [],
      portraitSize: '832x1216',
      landscapeSize: '1216x832',
      shizhenArtistProfiles: {
        ...profiles,
        global: { ...profiles.global, body: { comboId: '', size: '1024x1024' } },
        combos: [],
      },
    } as unknown as import('@/state/settings').NaiSettings;
    const result = applyArtistProfileToNai(native, '', 'body');
    expect(result.applied).toBe(true);
    expect(result.nai.portraitSize).toBe('1024x1024');
    expect(result.nai.activeArtistId).toBe('native');
  });
});


describe('Shizhen Vibe groups and name fallback', () => {
  it('uses name-only imported bindings as a fallback for avatar-based runtime identities', () => {
    const imported = {
      ...profiles,
      bindings: [{
        characterKey: 'name:Alice', characterName: 'Alice',
        body: { comboId: 'combo-b', size: '' },
        statusBar: { comboId: '', size: '' }, egg: { comboId: '', size: '' },
      }],
    };
    expect(resolveArtistTarget(imported, 'avatar:alice.png', 'body', 'Alice').comboId).toBe('combo-b');
  });

  it('does not bind a different avatar merely because its display name matches', () => {
    const avatarBound = {
      ...profiles,
      bindings: [{ ...profiles.bindings[0], characterKey: 'avatar:other.png', body: { comboId: 'combo-b', size: '' } }],
    };
    expect(resolveArtistTarget(avatarBound, 'avatar:alice.png', 'body', 'Hero').comboId).toBe('combo-a');
  });

  it('enables every Vibe in a selected imported group on a request-local copy', () => {
    const native = {
      activeArtistId: 'native',
      vibes: [
        { id: 'v1', group: '雨夜', enabled: false },
        { id: 'v2', group: '雨夜', enabled: false },
        { id: 'v3', group: '晴天', enabled: true },
      ],
      portraitSize: '832x1216',
      landscapeSize: '1216x832',
      shizhenArtistProfiles: {
        ...profiles,
        combos: [{ id: 'group-combo', name: '雨夜组合', artistId: '', vibeId: '', vibeGroup: '雨夜', updatedAt: 1 }],
        global: { ...profiles.global, body: { comboId: 'group-combo', size: '' } },
      },
    } as unknown as import('@/state/settings').NaiSettings;
    const result = applyArtistProfileToNai(native, '', 'body');
    expect(result.nai.vibes.map(v => v.enabled)).toEqual([true, true, false]);
    expect(native.vibes.map(v => v.enabled)).toEqual([false, false, true]);
  });
});


describe('partial artist and Vibe combos', () => {
  const makeNai = (combo: { artistId: string; vibeId: string; vibeGroup?: string }, size = '') => ({
    activeArtistId: 'native-artist',
    vibes: [
      { id: 'native-vibe', group: 'native', enabled: true },
      { id: 'group-vibe', group: 'group', enabled: false },
    ],
    portraitSize: '832x1216',
    landscapeSize: '1216x832',
    shizhenArtistProfiles: {
      ...profiles,
      combos: [{ id: 'partial', name: 'Partial', ...combo, updatedAt: 1 }],
      global: { ...profiles.global, body: { comboId: 'partial', size } },
    },
  }) as unknown as import('@/state/settings').NaiSettings;

  it('artist-only combo keeps native Vibe selections', () => {
    const source = makeNai({ artistId: 'artist-new', vibeId: '' });
    const result = applyArtistProfileToNai(source, '', 'body');
    expect(result.nai.activeArtistId).toBe('artist-new');
    expect(result.nai.vibes.map(v => v.enabled)).toEqual([true, false]);
  });

  it('Vibe-only combo keeps the native artist selection', () => {
    const source = makeNai({ artistId: '', vibeId: 'group-vibe' });
    const result = applyArtistProfileToNai(source, '', 'body');
    expect(result.nai.activeArtistId).toBe('native-artist');
    expect(result.nai.vibes.map(v => v.enabled)).toEqual([false, true]);
  });

  it('applies portrait and landscape dimensions independently', () => {
    const portrait = applyArtistProfileToNai(makeNai({ artistId: '', vibeId: '' }, '768x1344'), '', 'body');
    expect(portrait.nai.portraitSize).toBe('768x1344');
    expect(portrait.nai.landscapeSize).toBe('1216x832');
    const landscape = applyArtistProfileToNai(makeNai({ artistId: '', vibeId: '' }, '1344x768'), '', 'body');
    expect(landscape.nai.portraitSize).toBe('832x1216');
    expect(landscape.nai.landscapeSize).toBe('1344x768');
  });
});
