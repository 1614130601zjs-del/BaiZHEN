export interface GalleryAlbum {
  id: string;
  name: string;
  imageKeys: string[];
  coverKey?: string;
  coverData?: string;
  createdAt: number;
  updatedAt: number;
}

export interface GalleryAlbumsState {
  version: 1;
  albums: GalleryAlbum[];
}

export const GALLERY_ALBUMS_STORAGE_KEY = 'bbi.galleryAlbums.v1';

export function normalizeGalleryAlbums(value: unknown): GalleryAlbumsState {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const raw = Array.isArray(root.albums) ? root.albums : [];
  const albums: GalleryAlbum[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const imageKeys = Array.isArray(record.imageKeys)
      ? [...new Set(record.imageKeys.filter((key): key is string => typeof key === 'string' && key.trim()).map(key => key.trim()))]
      : [];
    albums.push({
      id,
      name,
      imageKeys,
      ...(typeof record.coverKey === 'string' && record.coverKey ? { coverKey: record.coverKey } : {}),
      ...(typeof record.coverData === 'string' && record.coverData.startsWith('data:image/') ? { coverData: record.coverData } : {}),
      createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
      updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
    });
  }
  return { version: 1, albums };
}

export function loadGalleryAlbums(storage?: Pick<Storage, 'getItem'>): GalleryAlbumsState {
  try {
    const source = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = source?.getItem(GALLERY_ALBUMS_STORAGE_KEY);
    return normalizeGalleryAlbums(raw ? JSON.parse(raw) : null);
  } catch {
    return { version: 1, albums: [] };
  }
}

export function saveGalleryAlbums(state: GalleryAlbumsState, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const source = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!source) return false;
    source.setItem(GALLERY_ALBUMS_STORAGE_KEY, JSON.stringify(normalizeGalleryAlbums(state)));
    return true;
  } catch {
    return false;
  }
}

export function createGalleryAlbum(state: GalleryAlbumsState, name: string, now = Date.now(), id = `album-${now}-${Math.random().toString(36).slice(2, 7)}`): GalleryAlbumsState {
  const clean = name.trim();
  if (!clean || state.albums.some(album => album.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) return state;
  return { version: 1, albums: [...state.albums, { id, name: clean, imageKeys: [], createdAt: now, updatedAt: now }] };
}

export function renameGalleryAlbum(state: GalleryAlbumsState, id: string, name: string, now = Date.now()): GalleryAlbumsState {
  const clean = name.trim();
  if (!clean || state.albums.some(album => album.id !== id && album.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) return state;
  return { version: 1, albums: state.albums.map(album => album.id === id ? { ...album, name: clean, updatedAt: now } : album) };
}

export function deleteGalleryAlbum(state: GalleryAlbumsState, id: string): GalleryAlbumsState {
  return { version: 1, albums: state.albums.filter(album => album.id !== id) };
}

export function assignImagesToGalleryAlbum(state: GalleryAlbumsState, id: string, imageKeys: string[]): GalleryAlbumsState {
  const keys = [...new Set(imageKeys.filter(key => typeof key === 'string' && key.trim()).map(key => key.trim()))];
  if (!keys.length || !state.albums.some(album => album.id === id)) return state;
  return { version: 1, albums: state.albums.map(album => album.id === id ? { ...album, imageKeys: [...new Set([...album.imageKeys, ...keys])], updatedAt: Date.now() } : album) };
}

export function removeImagesFromGalleryAlbum(state: GalleryAlbumsState, id: string, imageKeys: string[]): GalleryAlbumsState {
  const remove = new Set(imageKeys);
  return { version: 1, albums: state.albums.map(album => album.id === id ? { ...album, imageKeys: album.imageKeys.filter(key => !remove.has(key)), coverKey: album.coverKey && remove.has(album.coverKey) ? undefined : album.coverKey, updatedAt: Date.now() } : album) };
}

export function moveImagesBetweenGalleryAlbums(state: GalleryAlbumsState, fromId: string, toId: string, imageKeys: string[]): GalleryAlbumsState {
  if (fromId === toId || !state.albums.some(album => album.id === fromId) || !state.albums.some(album => album.id === toId)) return state;
  const keys = new Set(imageKeys);
  return { version: 1, albums: state.albums.map(album => {
    if (album.id === fromId) return { ...album, imageKeys: album.imageKeys.filter(key => !keys.has(key)), coverKey: album.coverKey && keys.has(album.coverKey) ? undefined : album.coverKey, updatedAt: Date.now() };
    if (album.id === toId) return { ...album, imageKeys: [...new Set([...album.imageKeys, ...keys])], updatedAt: Date.now() };
    return album;
  }) };
}

export function setGalleryAlbumCover(state: GalleryAlbumsState, id: string, imageKey?: string, coverData?: string): GalleryAlbumsState {
  return { version: 1, albums: state.albums.map(album => album.id === id ? { ...album, coverKey: imageKey, coverData: coverData, updatedAt: Date.now() } : album) };
}

export function removeGalleryImageFromAllAlbums(state: GalleryAlbumsState, imageKey: string): GalleryAlbumsState {
  return { version: 1, albums: state.albums.map(album => ({ ...album, imageKeys: album.imageKeys.filter(key => key !== imageKey), coverKey: album.coverKey === imageKey ? undefined : album.coverKey })) };
}
