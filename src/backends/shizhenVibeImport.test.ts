import { describe, expect, it } from 'vitest';
import { parseShizhenVibeJson } from '@/backends/shizhenVibeImport';

const payload = 'A'.repeat(240);

describe('parseShizhenVibeJson', () => {
  it('保留官方 .naiv4vibe 的多个模型编码和强度', () => {
    const result = parseShizhenVibeJson({
      identifier: 'novelai-vibe-transfer',
      name: '官方 Vibe',
      importInfo: { strength: 0.73 },
      encodings: {
        'v4-5full': { hash: { encoding: payload, params: { information_extracted: 0.82 } } },
        'v4-curated': { hash: { encoding: 'B'.repeat(240), params: { information_extracted: 0.9 } } },
      },
    }, 'v4-5full');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: '官方 Vibe',
      strength: 0.73,
      data: {
        encodings: {
          'v4-5full': { encoding: payload, infoExtracted: 0.82 },
          'v4-curated': { encoding: 'B'.repeat(240), infoExtracted: 0.9 },
        },
      },
    });
  });

  it('识别拾帧导出的 groups/entries 包装并保留组名', () => {
    const result = parseShizhenVibeJson({
      format: 'shizhen-vibe-export',
      version: 1,
      groups: [{
        name: '电影感',
        entries: [{
          name: '柔光',
          strength: 0.45,
          informationExtracted: 0.7,
          raw: {
            identifier: 'novelai-vibe-transfer',
            encodings: { 'v4-5full': { hash: { encoding: payload, params: { information_extracted: 0.7 } } } },
          },
        }],
      }],
    }, 'v4-5full');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: '柔光',
      group: '电影感',
      strength: 0.45,
      data: { encodings: { 'v4-5full': { encoding: payload, infoExtracted: 0.7 } } },
    });
  });

  it('识别拾帧 V3 将编码放在 image 字段的结构', () => {
    const result = parseShizhenVibeJson({
      identifier: 'novelai-vibe-transfer',
      version: 3,
      name: 'V3 编码',
      image: payload,
      importInfo: { strength: 0.6 },
    }, 'v3');

    expect(result.items[0]?.data.encodings.v3.encoding).toBe(payload);
  });

  it('从其他包装对象中递归识别编码字段', () => {
    const result = parseShizhenVibeJson({
      presets: [{ title: '嵌套 Vibe', vibeData: { encoded_vibe: payload } }],
    }, 'v4-5full');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('嵌套 Vibe');
    expect(result.items[0]?.data.encodings['v4-5full'].encoding).toBe(payload);
  });

  it('兼容拾帧 Vibe 池条目以 image 保存编码的结构', () => {
    const result = parseShizhenVibeJson({
      groups: [{
        name: '池迁移',
        entries: [{
          name: '池条目',
          image: payload,
          strength: 0.78,
          informationExtracted: 0.66,
        }],
      }],
    }, 'v4-5full');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: '池条目',
      group: '池迁移',
      strength: 0.78,
      data: {
        encodings: { 'v4-5full': { encoding: payload, infoExtracted: 0.66 } },
      },
    });
  });

  it('从拾帧原始对象兼容 reference_strength 与 informationExtracted', () => {
    const result = parseShizhenVibeJson({
      identifier: 'novelai-vibe-transfer',
      name: '兼容元数据',
      reference_strength: 0.74,
      informationExtracted: 0.63,
      encodings: { 'v4-5full': payload },
    }, 'v4-5full');

    expect(result.items[0]).toMatchObject({
      strength: 0.74,
      data: { encodings: { 'v4-5full': { encoding: payload, infoExtracted: 0.63 } } },
    });
  });

  it('V3 image 编码同时保留给 V3 后端使用', () => {
    const result = parseShizhenVibeJson({
      identifier: 'novelai-vibe-transfer',
      name: 'V3 image 编码',
      image: payload,
      importInfo: { strength: 0.6 },
    }, 'v3');

    expect(result.items[0]?.data.image).toBe(payload);
    expect(result.items[0]?.data.encodings.v3.encoding).toBe(payload);
  });

  it('忽略没有可用编码的条目并计数', () => {
    const result = parseShizhenVibeJson({
      groups: [{ name: '空组', entries: [{ name: '普通图片', image: 'not-an-encoding' }] }],
    }, 'v4-5full');

    expect(result.items).toHaveLength(0);
    expect(result.unsupported).toBe(1);
  });
});
