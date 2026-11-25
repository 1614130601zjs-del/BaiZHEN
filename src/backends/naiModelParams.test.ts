import { describe, expect, it } from 'vitest';
import { defaultNaiModelParams, switchNaiModelParams } from './naiModelParams';

const base = { model: 'nai-diffusion-5-full' as const, modelParams: {}, steps: 31, scale: 6.2, sampler: 'k_euler', noiseSchedule: 'native', cfgRescale: 0.2, qualityToggle: false, ucPreset: 1 };

describe('NAI per-model parameter memory', () => {
  it('saves current values and applies family defaults on first switch', () => {
    const next = switchNaiModelParams(base, 'nai-diffusion-4-5-full');
    expect(next.model).toBe('nai-diffusion-4-5-full');
    expect(next.modelParams?.['nai-diffusion-5-full']).toEqual({ steps: 31, scale: 6.2, sampler: 'k_euler', noiseSchedule: 'native', cfgRescale: 0.2 });
    expect(next.scale).toBe(5);
    expect(next.qualityToggle).toBe(true);
    expect(next.ucPreset).toBe(3);
  });
  it('restores saved values when returning to a model', () => {
    const v4 = switchNaiModelParams(base, 'nai-diffusion-4-5-full');
    const v5 = switchNaiModelParams({ ...base, ...v4, steps: 24, scale: 4.5 }, 'nai-diffusion-5-full');
    expect(v5.steps).toBe(31);
    expect(v5.scale).toBe(6.2);
    expect(v5.sampler).toBe('k_euler');
    expect(v5.qualityToggle).toBe(false);
    expect(v5.ucPreset).toBe(1);
  });
  it('uses V3 family defaults', () => expect(defaultNaiModelParams('nai-diffusion-3').scale).toBe(6));
});
