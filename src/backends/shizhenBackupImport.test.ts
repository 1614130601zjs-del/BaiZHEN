import { describe, expect, it } from 'vitest';
import { parseShizhenFullBackup } from '@/backends/shizhenBackupImport';

const payload = 'A'.repeat(220);
describe('parseShizhenFullBackup', () => {
  it('converts preset, combo, global target and character bindings', () => {
    const plan = parseShizhenFullBackup({
      format: 'shizhen-lite-full-backup',
      data: {
        presets: [{ name: '柔和', positive: 'soft lighting', negative: 'blurry' }],
        combinations: [{ name: '柔和+氛围', artistIndex: 0, vibeIndex: 0 }],
        globalComboIndex: 0, bodySize: '832x1216', sbComboIndex: 0, sbSize: '', eggComboIndex: -1, eggSize: '',
        bindings: [{ characterKey: '2', characterName: 'A', combinationIndex: 0, sbComboIndex: -1, eggComboIndex: 0, bodySize: '1024x1024' }],
        vibes: [{ name: '氛围', refs: [{ poolId: 'p1', strength: 0.7, informationExtracted: 0.8 }] }],
        vibePool: [{ id: 'p1', name: '雨夜', image: payload, strength: 0.6 }],
      },
    }, 'v4-5full');
    expect(plan.artists[0].prompt).toBe('soft lighting');
    expect(plan.combos[0]).toEqual({ name: '柔和+氛围', artistIndex: 0, vibeIndex: 0 });
    expect(plan.global.body).toEqual({ comboIndex: 0, size: '832x1216' });
    expect(plan.bindings[0].characterIndex).toBe('2');
    expect(plan.bindings[0].characterName).toBe('A');
    expect(plan.bindings[0].body.size).toBe('1024x1024');
    expect(plan.vibes[0].group).toBe('氛围');
    expect(plan.vibes[0].strength).toBe(0.7);
    expect(plan.vibes[0].data.encodings['v4-5full'].encoding).toBe(payload);
  });

  it('accepts legacy group entries and leaves the input untouched', () => {
    const source = { presets: [], combinations: [], vibes: [{ name: '旧组', entries: [{ name: '旧 Vibe', encoding: payload }] }] };
    const before = JSON.stringify(source);
    const plan = parseShizhenFullBackup(source, 'v4-5full');
    expect(plan.vibes).toHaveLength(1);
    expect(plan.vibes[0].group).toBe('旧组');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects duplicate Vibe pool IDs instead of silently binding refs to the last entry', () => {
    expect(() => parseShizhenFullBackup({
      format: 'shizhen-lite-full-backup',
      data: {
        presets: [], combinations: [],
        vibes: [{ name: 'group', refs: [{ poolId: 'duplicate' }] }],
        vibePool: [
          { id: 'duplicate', name: 'first', raw: { encodings: { 'v4-5full': { encoding: payload } } } },
          { id: 'duplicate', name: 'second', raw: { encodings: { 'v4-5full': { encoding: payload + 'B' } } } },
        ],
      },
    }, 'v4-5full')).toThrow(/重复的 Vibe 池 ID/);
  });

  it('rejects unrelated settings files', () => {
    expect(() => parseShizhenFullBackup({ extensions: { baibaiToolkit: {} } }, 'v4-5full')).toThrow(/拾帧完整备份/);
  });
  it('round-trips the canonical Shizhen pool envelope with model metadata and preview image', () => {
    const sourceImage = 'iVBORw0KGgo' + 'C'.repeat(220);
    const plan = parseShizhenFullBackup({
      format: 'shizhen-lite-full-backup',
      version: 1,
      data: {
        presets: [], combinations: [],
        vibes: [{ name: 'canon', refs: [{ poolId: 'pool-canon', strength: 0.63 }] }],
        vibePool: [{
          id: 'pool-canon',
          name: 'canon',
          image: sourceImage,
          thumb: 'data:image/png;base64,thumb',
          raw: {
            identifier: 'novelai-vibe-transfer',
            version: 1,
            type: 'encoding',
            name: 'canon',
            image: sourceImage,
            encodings: {
              'v4-5full': { encoding: payload, infoExtracted: 0.73 },
              v3: { encoding: payload + 'D', infoExtracted: 0.89 },
            },
          },
        }],
      },
    }, 'v4-5full');
    expect(plan.vibes).toHaveLength(1);
    expect(plan.vibes[0].strength).toBe(0.63);
    expect(plan.vibes[0].data.image).toBe(sourceImage);
    expect(plan.vibes[0].data.thumbnail).toBe('data:image/png;base64,thumb');
    expect(plan.vibes[0].data.encodings['v4-5full']).toEqual({ encoding: payload, infoExtracted: 0.73 });
    expect(plan.vibes[0].data.encodings.v3).toEqual({ encoding: payload + 'D', infoExtracted: 0.89 });
  });

  it('imports a V3 pool entry whose encoding is stored in the canonical image field', () => {
    const v3Payload = 'V'.repeat(240);
    const plan = parseShizhenFullBackup({
      format: 'shizhen-lite-full-backup',
      data: {
        presets: [], combinations: [],
        vibes: [{ name: 'V3', refs: [{ poolId: 'pool-v3', strength: 0.5 }] }],
        vibePool: [{
          id: 'pool-v3',
          name: 'V3',
          raw: { identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding', image: v3Payload },
        }],
      },
    }, 'v4-5full');
    expect(plan.vibes).toHaveLength(1);
    expect(plan.vibes[0].data.encodings.v3).toEqual({ encoding: v3Payload, infoExtracted: 1 });
    expect(plan.vibes[0].data.image).toBe(v3Payload);
  });

});


describe('Shizhen Vibe pool reference metadata', () => {
  it('preserves per-model Information Extracted when the group reference has no override', () => {
    const plan = parseShizhenFullBackup({
      format: 'shizhen-lite-full-backup',
      data: {
        presets: [], combinations: [],
        vibes: [{ name: 'multi-model', refs: [{ poolId: 'p2', strength: 0.55 }] }],
        vibePool: [{
          id: 'p2', name: 'multi-model',
          raw: { encodings: {
            'v4-5full': { encoding: payload, infoExtracted: 0.72 },
            v3: { encoding: payload + 'B', infoExtracted: 0.91 },
          } },
        }],
      },
    }, 'v4-5full');
    expect(plan.vibes[0].data.encodings['v4-5full'].infoExtracted).toBe(0.72);
    expect(plan.vibes[0].data.encodings.v3.infoExtracted).toBe(0.91);
    expect(plan.vibes[0].strength).toBe(0.55);
  });

  it('preserves per-reference strength and Information Extracted when one pool item is reused', () => {
    const plan = parseShizhenFullBackup({
      format: 'shizhen-lite-full-backup',
      data: {
        presets: [], combinations: [],
        vibes: [
          { name: 'soft', refs: [{ poolId: 'shared', strength: 0.31, informationExtracted: 0.42 }] },
          { name: 'strong', refs: [{ poolId: 'shared', strength: 0.87, informationExtracted: 0.93 }] },
        ],
        vibePool: [{
          id: 'shared',
          name: 'shared pool item',
          raw: { encodings: {
            'v4-5full': { encoding: payload, infoExtracted: 0.72 },
            v3: { encoding: payload + 'X', infoExtracted: 0.81 },
          } },
        }],
      },
    }, 'v4-5full');
    expect(plan.vibes).toHaveLength(2);
    expect(plan.vibes[0]).toMatchObject({
      group: 'soft',
      strength: 0.31,
      data: { encodings: {
        'v4-5full': { encoding: payload, infoExtracted: 0.42 },
        v3: { encoding: payload + 'X', infoExtracted: 0.42 },
      } },
    });
    expect(plan.vibes[1]).toMatchObject({
      group: 'strong',
      strength: 0.87,
      data: { encodings: {
        'v4-5full': { encoding: payload, infoExtracted: 0.93 },
        v3: { encoding: payload + 'X', infoExtracted: 0.93 },
      } },
    });
  });

});

describe('Shizhen Vibe strength fallback', () => {
  it('does not turn missing or blank reference strength into zero', () => {
    for (const raw of [undefined, null, '', '   ', true]) {
      const plan = parseShizhenFullBackup({
        format: 'shizhen-lite-full-backup',
        data: {
          presets: [], combinations: [],
          vibes: [{ name: 'fallback', refs: [{ poolId: 'p', strength: raw }] }],
          vibePool: [{ id: 'p', name: 'fallback', strength: 0.64, raw: { encodings: { 'v4-5full': { encoding: payload, infoExtracted: 0.77 } } } }],
        },
      }, 'v4-5full');
      expect(plan.vibes[0].strength).toBe(0.64);
      expect(plan.vibes[0].data.encodings['v4-5full'].infoExtracted).toBe(0.77);
    }
  });

  it('preserves an explicit zero reference value', () => {
    const plan = parseShizhenFullBackup({
      format: 'shizhen-lite-full-backup',
      data: {
        presets: [], combinations: [],
        vibes: [{ name: 'zero', refs: [{ poolId: 'p', strength: 0, informationExtracted: 0 }] }],
        vibePool: [{ id: 'p', raw: { encodings: { 'v4-5full': { encoding: payload, infoExtracted: 0.8 } } } }],
      },
    }, 'v4-5full');
    expect(plan.vibes[0].strength).toBe(0);
    expect(plan.vibes[0].data.encodings['v4-5full'].infoExtracted).toBe(0);
  });
});
