import type { NaiModel, NaiModelParamSnapshot, NaiSettings } from '@/state/settings';

export function defaultNaiModelParams(model: string): NaiModelParamSnapshot {
  if (/^nai-diffusion-5-/i.test(model)) return { steps: 28, scale: 4, sampler: 'k_euler_ancestral', noiseSchedule: 'karras', cfgRescale: 0 };
  if (/^nai-diffusion-3(?:-|$)/i.test(model) || /furry-3/i.test(model)) return { steps: 28, scale: 6, sampler: 'k_euler_ancestral', noiseSchedule: 'karras', cfgRescale: 0 };
  return { steps: 28, scale: 5, sampler: 'k_euler_ancestral', noiseSchedule: 'karras', cfgRescale: 0 };
}

type ModelParams = Pick<NaiSettings, 'model' | 'modelParams' | 'steps' | 'scale' | 'sampler' | 'noiseSchedule' | 'cfgRescale'>;

export function switchNaiModelParams(current: ModelParams, nextModel: NaiModel): Partial<ModelParams> {
  if (nextModel === current.model) return {};
  const saved = { ...current.modelParams, [current.model]: {
    steps: current.steps, scale: current.scale, sampler: current.sampler,
    noiseSchedule: current.noiseSchedule, cfgRescale: current.cfgRescale,
  } };
  const next = saved[nextModel] ?? defaultNaiModelParams(nextModel);
  return { model: nextModel, modelParams: saved, ...next };
}
