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

  it('rejects unrelated settings files', () => {
    expect(() => parseShizhenFullBackup({ extensions: { baibaiToolkit: {} } }, 'v4-5full')).toThrow(/拾帧完整备份/);
  });
});
