import { describe, expect, it } from 'vitest';
import { parseShizhenVibeJson, readShizhenVibeFile } from '@/backends/shizhenVibeImport';

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


describe('Shizhen V3 Vibe backup compatibility', () => {
  it('keeps V3 image encoding under the v3 model key even when current model is V4.5', () => {
    const result = parseShizhenVibeJson({
      identifier: 'novelai-vibe-transfer',
      image: 'A'.repeat(220),
      name: 'V3 reference',
    }, 'v4-5full');
    expect(result.items[0]?.data.encodings.v3.encoding).toBe('A'.repeat(220));
    expect(result.items[0]?.data.image).toBe('A'.repeat(220));
  });
});


function makeStoredZip(content: string, declaredSize = new TextEncoder().encode(content).byteLength): File {
  const name = new TextEncoder().encode('vibe.json');
  const data = new TextEncoder().encode(content);
  const localSize = 30 + name.length + data.length;
  const centralSize = 46 + name.length;
  const bytes = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(bytes.buffer);
  const put16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const put32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  put32(0, 0x04034b50); put16(4, 20); put16(8, 0); put32(18, data.length); put32(22, declaredSize);
  put16(26, name.length); bytes.set(name, 30); bytes.set(data, 30 + name.length);
  const c = localSize;
  put32(c, 0x02014b50); put16(c + 4, 20); put16(c + 6, 20); put16(c + 10, 0);
  put32(c + 20, data.length); put32(c + 24, declaredSize); put16(c + 28, name.length);
  put32(c + 42, 0); bytes.set(name, c + 46);
  const e = c + centralSize;
  put32(e, 0x06054b50); put16(e + 8, 1); put16(e + 10, 1); put32(e + 12, centralSize); put32(e + 16, c);
  return new File([bytes], 'vibes.zip', { type: 'application/zip' });
}

describe('Vibe ZIP archive safety', () => {
  it('reads a valid stored JSON member', async () => {
    const json = JSON.stringify({ identifier: 'novelai-vibe-transfer', encodings: { 'v4-5full': { encoding: payload } } });
    const result = await readShizhenVibeFile(makeStoredZip(json), 'v4-5full');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].data.encodings['v4-5full'].encoding).toBe(payload);
  });

  it('rejects stored entries whose actual length exceeds the declared output size', async () => {
    const json = JSON.stringify({ identifier: 'novelai-vibe-transfer', encodings: { 'v4-5full': { encoding: payload } } });
    await expect(readShizhenVibeFile(makeStoredZip(json, 8), 'v4-5full')).rejects.toThrow(/长度不符/);
  });

  it('rejects a local filename that disagrees with the central directory', async () => {
    const json = JSON.stringify({ identifier: 'novelai-vibe-transfer', encodings: { 'v4-5full': { encoding: payload } } });
    const valid = makeStoredZip(json);
    const bytes = new Uint8Array(await valid.arrayBuffer());
    bytes[30] = 'x'.charCodeAt(0);
    const tampered = new File([bytes], 'tampered.zip', { type: 'application/zip' });
    await expect(readShizhenVibeFile(tampered, 'v4-5full')).rejects.toThrow(/本地文件头与中央目录不一致/);
  });
});
