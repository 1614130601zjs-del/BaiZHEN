import type { NaiVibeData } from '@/state/settings';
import { clampVibeStrength } from '@/backends/vibeStore';

export interface ShizhenVibeImportItem {
  name: string;
  group: string;
  strength: number;
  data: NaiVibeData;
}

export interface ShizhenVibeImportResult {
  items: ShizhenVibeImportItem[];
  unsupported: number;
}

const PAYLOAD_KEYS = /^(?:encoding|encoded|encodedVibe|encoded_vibe|vibeEncoding|vibe_encoding|vibeData|vibe_data|payload|base64|imageBase64|image_base64|referenceImage|reference_image)$/i;
const GROUP_KEYS = /^(?:vibes?|vibeGroups?|groups|参考图组|参考组|氛围转移)$/i;
const ENTRY_KEYS = ['entries', 'images', 'references', 'vibeData', 'vibes', 'items'] as const;

function cleanPayload(value: string): string {
  return value.trim()
    .replace(/^data:(?:application\/octet-stream|image\/[^;]+);base64,/i, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
}

function isPayload(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const clean = cleanPayload(value);
  return clean.length > 160 && /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
}

function looksLikeImage(value: string): boolean {
  if (/^data:image\//i.test(value)) return true;
  const clean = cleanPayload(value);
  // PNG, JPEG, GIF and WebP magic bytes in base64.
  return /^(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)/.test(clean);
}

function normalizedModelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readNumericField(value: unknown, pattern: RegExp, fallback: number): number {
  try {
    const serialized = JSON.stringify(value);
    const match = serialized.match(pattern);
    if (!match) return fallback;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function unwrapEncoding(value: unknown, fallbackInfo = 1): { encoding: string; infoExtracted: number } | null {
  if (typeof value === 'string') {
    return isPayload(value) ? { encoding: cleanPayload(value), infoExtracted: fallbackInfo } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const direct = record.encoding ?? record.encoded ?? record.data ?? record.payload ?? record.base64;
  if (isPayload(direct)) {
    const params = record.params && typeof record.params === 'object'
      ? record.params as Record<string, unknown>
      : {};
    const info = params.information_extracted ?? params.informationExtracted ?? record.infoExtracted;
    return {
      encoding: cleanPayload(direct),
      infoExtracted: Number.isFinite(Number(info)) ? Math.min(1, Math.max(0, Number(info))) : fallbackInfo,
    };
  }
  for (const child of Object.values(record)) {
    const found = unwrapEncoding(child, fallbackInfo);
    if (found) return found;
  }
  return null;
}

function collectEncodings(raw: Record<string, unknown>, currentModelKey: string): Record<string, { encoding: string; infoExtracted: number }> {
  const result: Record<string, { encoding: string; infoExtracted: number }> = {};
  const fallbackInfo = Math.min(1, Math.max(0, readNumericField(
    raw,
    /"(?:reference_information_extracted|referenceInformationExtracted|information_extracted|informationExtracted|info_extracted|infoExtracted)"\s*:\s*([0-9.]+)/i,
    1,
  )));
  const encodings = raw.encodings;
  if (encodings && typeof encodings === 'object' && !Array.isArray(encodings)) {
    for (const [modelKey, value] of Object.entries(encodings as Record<string, unknown>)) {
      const extracted = unwrapEncoding(value, fallbackInfo);
      if (extracted) result[modelKey] = extracted;
    }
  }

  // Shizhen supports V3 exports where the Vibe payload is stored in image rather than encodings.
  if (!Object.keys(result).length && raw.identifier === 'novelai-vibe-transfer' && isPayload(raw.image) && !looksLikeImage(raw.image)) {
    result[currentModelKey] = { encoding: cleanPayload(raw.image as string), infoExtracted: fallbackInfo };
  }

  // Some exports place a model-specific payload directly beside the encodings object.
  if (!Object.keys(result).length) {
    const seen = new WeakSet<object>();
    const walk = (value: unknown, key = ''): string | null => {
      if (typeof value === 'string') return PAYLOAD_KEYS.test(key) && isPayload(value) ? cleanPayload(value) : null;
      if (!value || typeof value !== 'object' || seen.has(value)) return null;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const child of value) {
          const found = walk(child, key);
          if (found) return found;
        }
        return null;
      }
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
        if (childKey === 'encodings') continue;
        const found = walk(child, childKey);
        if (found) return found;
      }
      return null;
    };
    const found = walk(raw);
    if (found) result[currentModelKey] = { encoding: found, infoExtracted: fallbackInfo };
  }
  return result;
}

function entryArrays(record: Record<string, unknown>): unknown[] | null {
  for (const key of ENTRY_KEYS) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

function extractOne(
  value: unknown,
  fallbackName: string,
  group: string,
  currentModelKey: string,
): ShizhenVibeImportItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const wrapper = value as Record<string, unknown>;
  // Shizhen pool entries keep the original NovelAI object under raw while storing
  // display name/strength/thumbnail beside it. Read encoding payloads from both.
  const nestedRaw = wrapper.raw && typeof wrapper.raw === 'object' && !Array.isArray(wrapper.raw)
    ? wrapper.raw as Record<string, unknown>
    : null;
  const raw = nestedRaw ? { ...nestedRaw, ...wrapper, raw: undefined } : wrapper;
  const encodings = collectEncodings(raw, currentModelKey);
  const imageValue = typeof raw.image === 'string' ? raw.image : '';
  // Shizhen stores V3 Vibe payloads in image; BaiZHEN's V3 backend consumes this field directly.
  const image = imageValue && (looksLikeImage(imageValue)
    || (currentModelKey === 'v3' && isPayload(imageValue)))
    ? cleanPayload(imageValue)
    : '';
  const thumbnailValue = typeof raw.thumbnail === 'string'
    ? raw.thumbnail
    : typeof raw.thumb === 'string' ? raw.thumb : '';
  if (!Object.keys(encodings).length) return null;

  const importInfo = raw.importInfo && typeof raw.importInfo === 'object'
    ? raw.importInfo as Record<string, unknown>
    : {};
  const importedStrength = importInfo.strength ?? raw.strength;
  const strength = clampVibeStrength(
    importedStrength ?? readNumericField(raw, /"(?:reference_strength|referenceStrength|strength)"\s*:\s*([0-9.]+)/i, 0.6),
    0.6,
  );
  const infoValues = Object.values(encodings).map(item => item.infoExtracted);
  const infoExtracted = infoValues[0] ?? 1;
  const name = String(raw.name ?? raw.title ?? raw.label ?? raw.filename ?? fallbackName).trim() || fallbackName;
  return {
    name,
    group,
    strength,
    data: {
      image,
      thumbnail: thumbnailValue,
      encodings: Object.fromEntries(Object.entries(encodings).map(([key, item]) => [key, {
        encoding: item.encoding,
        infoExtracted: item.infoExtracted,
      }])),
    },
  };
}

function collectItems(
  input: unknown,
  fallbackName: string,
  currentModelKey: string,
  output: ShizhenVibeImportItem[],
  unsupported: { count: number },
  group = '',
  seen = new WeakSet<object>(),
): void {
  if (!input || typeof input !== 'object' || seen.has(input)) return;
  seen.add(input);
  if (Array.isArray(input)) {
    for (const item of input) collectItems(item, fallbackName, currentModelKey, output, unsupported, group, seen);
    return;
  }
  const record = input as Record<string, unknown>;
  const name = String(record.name ?? record.title ?? record.label ?? record.filename ?? fallbackName).trim() || fallbackName;
  const entries = entryArrays(record);
  const isCanonical = record.identifier === 'novelai-vibe-transfer';
  if (!isCanonical && entries?.length) {
    for (const [index, entry] of entries.entries()) {
      const item = extractOne(entry, `${name} ${index + 1}`, name, currentModelKey);
      if (item) output.push(item);
      else unsupported.count++;
    }
    return;
  }
  // Avoid treating a container as one Vibe merely because a descendant has
  // an encoding. Descend first unless this record itself declares a Vibe payload.
  const hasOwnPayload = isCanonical
    || (record.encodings && typeof record.encodings === 'object')
    || (record.raw && typeof record.raw === 'object')
    || Object.entries(record).some(([key, child]) => PAYLOAD_KEYS.test(key) && isPayload(child));
  if (!hasOwnPayload) {
    const before = output.length;
    for (const [key, child] of Object.entries(record)) {
      if (Array.isArray(child) && GROUP_KEYS.test(key)) {
        for (const [index, nested] of child.entries()) {
          collectItems(nested, `${name} ${index + 1}`, currentModelKey, output, unsupported, '', seen);
        }
      } else if (child && typeof child === 'object') {
        collectItems(child, name, currentModelKey, output, unsupported, group, seen);
      }
    }
    if (output.length > before) return;
  }

  const direct = extractOne(record, name, group, currentModelKey);
  if (direct) {
    output.push(direct);
    return;
  }
  if (entries?.length) {
    for (const [index, entry] of entries.entries()) {
      const item = extractOne(entry, `${name} ${index + 1}`, group || name, currentModelKey);
      if (item) output.push(item);
      else unsupported.count++;
    }
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (Array.isArray(child) && GROUP_KEYS.test(key)) {
      for (const [index, nested] of child.entries()) {
        collectItems(nested, `${name} ${index + 1}`, currentModelKey, output, unsupported, '', seen);
      }
    } else if (child && typeof child === 'object') {
      collectItems(child, name, currentModelKey, output, unsupported, group, seen);
    }
  }
}

export function parseShizhenVibeJson(input: unknown, currentModelKey: string, fallbackName = '导入的 Vibe'): ShizhenVibeImportResult {
  const items: ShizhenVibeImportItem[] = [];
  const unsupported = { count: 0 };
  collectItems(input, fallbackName, currentModelKey, items, unsupported);
  return { items, unsupported: unsupported.count };
}

/** Read JSON directly or JSON resources inside a ZIP/.naiv4vibebundle archive. */
export async function readShizhenVibeFile(file: File, currentModelKey: string): Promise<ShizhenVibeImportResult> {
  try {
    const parsed: unknown = JSON.parse(await file.text());
    return parseShizhenVibeJson(parsed, currentModelKey, file.name);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const archived = await readZipJson(file);
      if (archived.length) {
        const items: ShizhenVibeImportItem[] = [];
        let unsupported = 0;
        for (const value of archived) {
          const result = parseShizhenVibeJson(value, currentModelKey, file.name);
          items.push(...result.items);
          unsupported += result.unsupported;
        }
        return { items, unsupported };
      }
    }
    throw error;
  }
}

async function readZipJson(file: File): Promise<unknown[]> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const read16 = (offset: number) => view.getUint16(offset, true);
  const read32 = (offset: number) => view.getUint32(offset, true);
  const output: unknown[] = [];

  for (let offset = 0; offset + 46 <= bytes.length;) {
    if (read32(offset) !== 0x02014b50) {
      offset++;
      continue;
    }
    const method = read16(offset + 10);
    const compressedSize = read32(offset + 20);
    const nameLength = read16(offset + 28);
    const extraLength = read16(offset + 30);
    const commentLength = read16(offset + 32);
    const localOffset = read32(offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (/\.(?:json|naiv4vibe|naiv4vibebundle)$/i.test(name)) {
      if (read32(localOffset) !== 0x04034b50) throw new Error(`Vibe 压缩包文件头无法识别：${name}`);
      const localNameLength = read16(localOffset + 26);
      const localExtraLength = read16(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const packed = bytes.slice(start, start + compressedSize);
      let raw: Uint8Array;
      if (method === 0) raw = packed;
      else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        raw = new Uint8Array(await new Response(stream).arrayBuffer());
      } else {
        throw new Error('当前浏览器不支持该 Vibe 压缩算法。');
      }
      try {
        output.push(JSON.parse(decoder.decode(raw)) as unknown);
      } catch {
        // Ignore unrelated or malformed JSON entries; other archive members may still be valid.
      }
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}
