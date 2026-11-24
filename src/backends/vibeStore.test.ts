import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileStore = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/floor/upload', () => ({
  uploadBase64File: fileStore.upload,
  deleteUploadedFile: fileStore.remove,
}));

import {
  clampVibeStrength,
  deleteVibeData,
  loadVibeData,
  saveVibeFiles,
  vibeMetaFromData,
  vibeFingerprint,
} from '@/backends/vibeStore';
import type { NaiVibeData } from '@/state/settings';

const data: NaiVibeData = {
  image: 'aW1hZ2U=',
  thumbnail: 'data:image/jpeg;base64,dGh1bWI=',
  encodings: { 'v4-5full': { encoding: 'ZW5jb2Rpbmc=', infoExtracted: 1 } },
};

describe('vibeStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fileStore.upload.mockReset();
    fileStore.remove.mockReset();
  });

  it('设置索引不包含原图和编码正文', () => {
    const meta = vibeMetaFromData(
      'v1',
      '测试',
      '/user/files/bbi-vibe-v1.json',
      '/user/files/bbi-vibe-thumb-v1.jpg',
      data,
      0.6,
      true,
    );
    expect(meta).toMatchObject({
      id: 'v1',
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-v1.jpg',
      modelKeys: ['v4-5full'],
      hasImage: true,
    });
    expect(meta).not.toHaveProperty('image');
    expect(meta).not.toHaveProperty('encodings');
    expect(meta).not.toHaveProperty('thumbnail');
  });

  it('正文和缩略图使用稳定文件名分别上传', async () => {
    fileStore.upload
      .mockResolvedValueOnce('/user/files/bbi-vibe-v1.json')
      .mockResolvedValueOnce('/user/files/bbi-vibe-thumb-v1.jpg');

    await expect(saveVibeFiles(data, null, 'v1')).resolves.toEqual({
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-v1.jpg',
    });
    expect(fileStore.upload).toHaveBeenNthCalledWith(1, 'bbi-vibe-v1.json', expect.any(String));
    expect(fileStore.upload).toHaveBeenNthCalledWith(2, 'bbi-vibe-thumb-v1.jpg', 'dGh1bWI=');
  });

  it('更新已有 Vibe 时写入新版本文件，不提前删除旧版本', async () => {
    fileStore.upload
      .mockResolvedValueOnce('/user/files/bbi-vibe-v1-next.json')
      .mockResolvedValueOnce('/user/files/bbi-vibe-thumb-v1-next.jpg');

    await expect(saveVibeFiles(data, {
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-v1.jpg',
    }, 'v1')).resolves.toEqual({
      dataPath: '/user/files/bbi-vibe-v1-next.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-v1-next.jpg',
    });

    expect(fileStore.upload).toHaveBeenCalledTimes(2);
    expect(fileStore.upload).toHaveBeenNthCalledWith(2, expect.stringMatching(/^bbi-vibe-thumb-v1-/), 'dGh1bWI=');
    expect(fileStore.remove).not.toHaveBeenCalled();
  });

  it('更新时移除缩略图会先保留旧文件，交由元数据提交后的调用方清理', async () => {
    fileStore.upload.mockResolvedValueOnce('/user/files/bbi-vibe-v1.json');
    fileStore.remove.mockResolvedValue(true);
    await expect(saveVibeFiles({ ...data, thumbnail: '' }, {
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-v1.jpg',
    }, 'v1')).resolves.toEqual({
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '',
    });
    expect(fileStore.upload).toHaveBeenCalledTimes(1);
    expect(fileStore.remove).not.toHaveBeenCalled();
  });

  it('缩略图移除时不在元数据提交前删除旧文件', async () => {
    fileStore.upload.mockResolvedValueOnce('/user/files/bbi-vibe-v1.json');
    fileStore.remove.mockRejectedValueOnce(new Error('remove failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(saveVibeFiles({ ...data, thumbnail: '' }, {
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-v1.jpg',
    }, 'v1')).resolves.toEqual({
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '',
    });
    expect(fileStore.remove).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('保留已有 Vibe 的数据更新结果，避免缩略图失败造成指纹与文件内容不一致', async () => {
    fileStore.upload
      .mockResolvedValueOnce('/user/files/bbi-vibe-v1.json')
      .mockRejectedValueOnce(new Error('thumbnail upload failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(saveVibeFiles(data, {
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '',
    }, 'v1')).resolves.toEqual({
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '',
    });

    expect(fileStore.upload).toHaveBeenCalledTimes(2);
    expect(fileStore.remove).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('已有缩略图刷新失败时不继续引用可能过期的旧预览', async () => {
    fileStore.upload
      .mockResolvedValueOnce('/user/files/bbi-vibe-v1.json')
      .mockRejectedValueOnce(new Error('thumbnail refresh failed'));
    fileStore.remove.mockResolvedValue(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(saveVibeFiles(data, {
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-v1.jpg',
    }, 'v1')).resolves.toEqual({
      dataPath: '/user/files/bbi-vibe-v1.json',
      thumbnailPath: '',
    });
    expect(fileStore.remove).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('新 Vibe 的缩略图上传失败时会尝试清理已上传的数据文件', async () => {
    fileStore.upload
      .mockResolvedValueOnce('/user/files/bbi-vibe-new.json')
      .mockRejectedValueOnce(new Error('thumbnail upload failed'));
    fileStore.remove.mockResolvedValue(true);
    // A failed server upload falls back to IndexedDB; stub the browser database
    // so this test can assert the server-side rollback without depending on a real DB.
    const request = { onsuccess: null as null | (() => void), onerror: null as null | (() => void), error: null };
    const store = { put: vi.fn(() => { queueMicrotask(() => request.onsuccess?.()); return request; }) };
    const transaction = { objectStore: vi.fn(() => store) };
    const db = { transaction: vi.fn(() => transaction) };
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const openRequest: { onsuccess: null | (() => void); onerror: null | (() => void); onupgradeneeded: null | (() => void); result: typeof db; error: null } = {
          onsuccess: null, onerror: null, onupgradeneeded: null, result: db, error: null,
        };
        queueMicrotask(() => openRequest.onsuccess?.());
        return openRequest;
      }),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await saveVibeFiles(data, null, 'new-vibe');
    expect(result.dataPath).toBe('idb:new-vibe');
    expect(fileStore.remove).toHaveBeenCalledWith('/user/files/bbi-vibe-new.json');
  });

  it('更新 IndexedDB 中的 Vibe 时清除旧远程缩略图引用', async () => {
    const request = { onsuccess: null as null | (() => void), onerror: null as null | (() => void), error: null };
    const store = { put: vi.fn(() => { queueMicrotask(() => request.onsuccess?.()); return request; }) };
    const transaction = { objectStore: vi.fn(() => store) };
    const db = { transaction: vi.fn(() => transaction) };
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const openRequest: { onsuccess: null | (() => void); onerror: null | (() => void); onupgradeneeded: null | (() => void); result: typeof db; error: null } = {
          onsuccess: null, onerror: null, onupgradeneeded: null, result: db, error: null,
        };
        queueMicrotask(() => openRequest.onsuccess?.());
        return openRequest;
      }),
    });
    fileStore.remove.mockResolvedValue(true);
    await expect(saveVibeFiles(data, {
      dataPath: 'idb:local-vibe',
      thumbnailPath: '/user/files/old-vibe-thumb.jpg',
    }, 'local-vibe')).resolves.toEqual({
      dataPath: expect.stringMatching(/^idb:local-vibe-/),
      thumbnailPath: '',
    });
    // IndexedDB connection is cached across tests; the old version remains until metadata commits.
    expect(fileStore.remove).not.toHaveBeenCalled();
    expect(fileStore.upload).not.toHaveBeenCalled();
  });

  it('按路径读取正文并删除两份文件', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 })));
    const vibe = vibeMetaFromData(
      'v1',
      '测试',
      '/user/files/bbi-vibe-v1.json',
      '/user/files/bbi-vibe-thumb-v1.jpg',
      data,
      0.6,
      true,
    );
    await expect(loadVibeData(vibe)).resolves.toEqual(data);

    fileStore.remove.mockResolvedValue(true);
    await deleteVibeData(vibe);
    expect(fileStore.remove).toHaveBeenNthCalledWith(1, vibe.dataPath);
    expect(fileStore.remove).toHaveBeenNthCalledWith(2, vibe.thumbnailPath);
  });
});

describe('clampVibeStrength', () => {
  it('自由填值不吸附步进,超界夹到 0–1', () => {
    expect(clampVibeStrength(0.375)).toBe(0.375);
    expect(clampVibeStrength('0.4321')).toBe(0.4321);
    expect(clampVibeStrength(5)).toBe(1);
    expect(clampVibeStrength(-2)).toBe(0);
    expect(clampVibeStrength(0)).toBe(0);
    expect(clampVibeStrength(1)).toBe(1);
  });

  it('认不出数就回落默认值,而非静默变成 0', () => {
    // 回归:旧实现用 Number(v),而 Number(null) / Number('') 都是 0,
    // 「字段缺失」于是被判成「强度 0」——vibe 挂上了却对画面毫无影响。
    for (const raw of [null, undefined, '', '   ', 'abc', NaN, Infinity, true, {}, []]) {
      expect(clampVibeStrength(raw)).toBe(0.6);
    }
  });

  it('可指定回落值(面板输入非法时保留原强度)', () => {
    expect(clampVibeStrength('', 0.9)).toBe(0.9);
    expect(clampVibeStrength('abc', 0.25)).toBe(0.25);
    expect(clampVibeStrength('0.5', 0.9)).toBe(0.5);
  });
});

describe('vibeFingerprint', () => {
  it('检测完整编码尾部的差异，而不只比较前缀', () => {
    const prefix = 'A'.repeat(240);
    const left = vibeFingerprint({ 'v4-5full': { encoding: prefix + 'B', infoExtracted: 1 } });
    const right = vibeFingerprint({ 'v4-5full': { encoding: prefix + 'C', infoExtracted: 1 } });
    expect(left).not.toBe(right);
  });
});

  it('把 Information Extracted 作为 Vibe 参数的一部分参与指纹', () => {
    const encoding = 'A'.repeat(200);
    expect(vibeFingerprint({ model: { encoding, infoExtracted: 0.2 } })).not.toBe(
      vibeFingerprint({ model: { encoding, infoExtracted: 0.8 } }),
    );
    expect(vibeFingerprint({ model: { encoding, infoExtracted: 0 } })).not.toBe(
      vibeFingerprint({ model: { encoding, infoExtracted: 0.01 } }),
    );
  });
