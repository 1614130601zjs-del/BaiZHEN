import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: null as Record<string, any> | null,
  saveVibeFiles: vi.fn(),
}));

vi.mock('@/st/context', () => ({
  getContext: () => mocks.context,
}));

// 只替换真正需要拦截的 saveVibeFiles(要断言调用与失败路径),其余导出取真身。
// 曾经这里手抄了 vibeFingerprint / vibeMetaFromData 的实现,于是 vibeStore 每加一个
// 导出都会让本文件以「No xxx export is defined on the mock」炸掉,且抄件与真身还会悄悄漂移。
vi.mock('@/backends/vibeStore', async () => ({
  ...(await vi.importActual<typeof import('@/backends/vibeStore')>('@/backends/vibeStore')),
  saveVibeFiles: mocks.saveVibeFiles,
}));

describe('旧版 Vibe 设置迁移', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.saveVibeFiles.mockReset();
    vi.stubGlobal('toastr', {
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  it('删除活动分组后，重载设置仍保留悬空 ID 以阻止回退旧 Vibe 库', async () => {
    mocks.context = {
      extensionSettings: {
        baibai_image: {
          nai: {
            vibes: [{
              id: 'legacy-vibe',
              name: '旧 Vibe',
              dataPath: '/user/files/legacy.json',
              thumbnailPath: '',
              modelKeys: ['v4-5full'],
              hasImage: true,
              fingerprint: 'legacy',
              strength: 0.6,
              enabled: true,
              group: '',
            }],
            vibePool: [],
            vibeGroups: [],
            activeVibeGroupId: 'deleted-group-id',
          },
        },
      },
      saveSettingsDebounced: vi.fn(),
    };

    const { hydrateSettings, settings } = await import('@/state/settings');
    await hydrateSettings();

    expect(settings.nai.activeVibeGroupId).toBe('deleted-group-id');
  });

  it('把大字段上传后只留下文件路径和小型索引', async () => {
    const saveSettingsDebounced = vi.fn();
    const legacy = {
      id: 'legacy-v1',
      name: '旧 Vibe',
      image: 'A'.repeat(1024),
      thumbnail: 'data:image/jpeg;base64,dGh1bWI=',
      encodings: { 'v4-5full': { encoding: 'B'.repeat(512), infoExtracted: 1 } },
      strength: 0.7,
      enabled: true,
    };
    mocks.context = {
      extensionSettings: {
        baibai_image: {
          nai: { vibes: [legacy] },
        },
      },
      saveSettingsDebounced,
    };
    mocks.saveVibeFiles.mockResolvedValue({
      dataPath: '/user/files/bbi-vibe-legacy-v1.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-legacy-v1.jpg',
    });

    const { hydrateSettings, settings } = await import('@/state/settings');
    await hydrateSettings();

    expect(mocks.saveVibeFiles).toHaveBeenCalledOnce();
    expect(settings.nai.vibes[0]).toMatchObject({
      id: 'legacy-v1',
      dataPath: '/user/files/bbi-vibe-legacy-v1.json',
      thumbnailPath: '/user/files/bbi-vibe-thumb-legacy-v1.jpg',
      modelKeys: ['v4-5full'],
      hasImage: true,
      strength: 0.7,
      enabled: true,
    });
    const persisted = mocks.context.extensionSettings.baibai_image.nai.vibes[0];
    expect(persisted).not.toHaveProperty('image');
    expect(persisted).not.toHaveProperty('thumbnail');
    expect(persisted).not.toHaveProperty('encodings');
    expect(saveSettingsDebounced).toHaveBeenCalled();
  });

  it('每条落盘后立即释放该条大字段', async () => {
    const vibes = [
      { id: 'legacy-1', image: 'A'.repeat(1024), thumbnail: '', encodings: {} },
      { id: 'legacy-2', image: 'B'.repeat(1024), thumbnail: '', encodings: {} },
    ];
    mocks.context = {
      extensionSettings: { baibai_image: { nai: { vibes } } },
      saveSettingsDebounced: vi.fn(),
    };
    mocks.saveVibeFiles
      .mockResolvedValueOnce({ dataPath: '/user/files/1.json', thumbnailPath: '' })
      .mockImplementationOnce(async () => {
        expect(vibes[0]).not.toHaveProperty('image');
        expect(vibes[1]).toHaveProperty('image');
        return { dataPath: '/user/files/2.json', thumbnailPath: '' };
      });

    const { hydrateSettings } = await import('@/state/settings');
    await hydrateSettings();

    expect(vibes[0]).not.toHaveProperty('image');
    expect(vibes[1]).not.toHaveProperty('image');
  });

  it('单条保存失败时保留原数据且不进入正常设置回写', async () => {
    const saveSettingsDebounced = vi.fn();
    const legacy = {
      id: 'legacy-failed',
      image: 'A'.repeat(1024),
      thumbnail: '',
      encodings: {},
    };
    mocks.context = {
      extensionSettings: { baibai_image: { nai: { vibes: [legacy] } } },
      saveSettingsDebounced,
    };
    mocks.saveVibeFiles.mockRejectedValue(new Error('server 与 IndexedDB 都失败'));

    const { hydrateSettings } = await import('@/state/settings');
    await expect(hydrateSettings()).rejects.toThrow('server 与 IndexedDB 都失败');

    expect(mocks.context.extensionSettings.baibai_image.nai.vibes[0]).toBe(legacy);
    expect(legacy).toHaveProperty('image');
    expect(saveSettingsDebounced).not.toHaveBeenCalled();
  });

  it('部分失败时保存已释放条目并保留失败条目', async () => {
    const saveSettingsDebounced = vi.fn();
    const vibes = [
      { id: 'legacy-ok', image: 'A'.repeat(1024), thumbnail: '', encodings: {} },
      { id: 'legacy-failed', image: 'B'.repeat(1024), thumbnail: '', encodings: {} },
    ];
    mocks.context = {
      extensionSettings: { baibai_image: { nai: { vibes } } },
      saveSettingsDebounced,
    };
    mocks.saveVibeFiles
      .mockResolvedValueOnce({ dataPath: '/user/files/ok.json', thumbnailPath: '' })
      .mockRejectedValueOnce(new Error('第二条失败'));

    const { hydrateSettings } = await import('@/state/settings');
    await expect(hydrateSettings()).rejects.toThrow('第二条失败');

    expect(vibes[0]).not.toHaveProperty('image');
    expect(vibes[1]).toHaveProperty('image');
    expect(saveSettingsDebounced).toHaveBeenCalledOnce();
  });
});


describe('Vibe pool artist combo normalization', () => {
  it('keeps a combo that references a pool-only resource across settings reload', async () => {
    mocks.context = {
      extensionSettings: {
        baibai_image: {
          nai: {
            vibes: [],
            vibePool: [{
              id: 'pool-only-vibe', name: '池资源', dataPath: '/user/files/pool.json',
              thumbnailPath: '', modelKeys: ['v4-5full'], hasImage: false, fingerprint: 'pool-only',
            }],
            vibeGroups: [],
            shizhenArtistProfiles: {
              combos: [{ id: 'pool-combo', name: '池资源组合', artistId: '', vibeId: 'pool-only-vibe', vibeGroup: '', updatedAt: 1 }],
              global: {
                body: { comboId: 'pool-combo', size: '' },
                statusBar: { comboId: '', size: '' },
                egg: { comboId: '', size: '' },
              },
              bindings: [],
            },
          },
        },
      },
      saveSettingsDebounced: vi.fn(),
    };
    const { hydrateSettings, settings } = await import('@/state/settings');
    await hydrateSettings();
    expect(settings.nai.shizhenArtistProfiles.combos[0].vibeId).toBe('pool-only-vibe');
    expect(settings.nai.shizhenArtistProfiles.global.body.comboId).toBe('pool-combo');
  });
});
