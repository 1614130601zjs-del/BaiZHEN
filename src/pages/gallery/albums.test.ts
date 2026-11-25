import { describe, expect, it } from 'vitest';
import {
  assignImagesToGalleryAlbum, createGalleryAlbum, deleteGalleryAlbum, moveImagesBetweenGalleryAlbums,
  normalizeGalleryAlbums, removeGalleryImageFromAllAlbums, removeImagesFromGalleryAlbum,
  renameGalleryAlbum, setGalleryAlbumCover,
} from './albums';

describe('gallery albums', () => {
  it('normalizes invalid records, duplicate ids and image keys', () => {
    const normalized = normalizeGalleryAlbums({ albums: [
      { id: 'a', name: ' Alpha ', imageKeys: ['x', 'x', '', 'y'], coverData: 'data:image/png;base64,abc' },
      { id: 'a', name: 'Duplicate', imageKeys: ['z'] },
      { id: '', name: 'bad' },
      null,
    ] });
    expect(normalized.albums).toHaveLength(1);
    expect(normalized.albums[0]).toMatchObject({ id: 'a', name: 'Alpha', imageKeys: ['x', 'y'] });
    expect(normalized.albums[0].coverData).toBe('data:image/png;base64,abc');
  });

  it('creates and renames albums with case-insensitive duplicate protection', () => {
    const empty = { version: 1 as const, albums: [] };
    const created = createGalleryAlbum(empty, ' Photos ', 10, 'a');
    expect(created.albums[0].name).toBe('Photos');
    expect(createGalleryAlbum(created, 'photos', 20, 'b')).toBe(created);
    expect(renameGalleryAlbum(created, 'a', ' photos ')).toBe(created);
    expect(renameGalleryAlbum(created, 'a', 'New', 30).albums[0].updatedAt).toBe(30);
  });

  it('assigns, removes, moves images and handles cover references', () => {
    const state = createGalleryAlbum(createGalleryAlbum({ version: 1, albums: [] }, 'One', 1, 'one'), 'Two', 2, 'two');
    const assigned = assignImagesToGalleryAlbum(state, 'one', ['x', 'y', 'x']);
    expect(assigned.albums[0].imageKeys).toEqual(['x', 'y']);
    const covered = setGalleryAlbumCover(assigned, 'one', 'x');
    const moved = moveImagesBetweenGalleryAlbums(covered, 'one', 'two', ['x']);
    expect(moved.albums[0].imageKeys).toEqual(['y']);
    expect(moved.albums[0].coverKey).toBeUndefined();
    expect(moved.albums[1].imageKeys).toEqual(['x']);
    expect(removeImagesFromGalleryAlbum(moved, 'two', ['x']).albums[1].imageKeys).toEqual([]);
    expect(removeGalleryImageFromAllAlbums(moved, 'y').albums[0].imageKeys).toEqual([]);
    expect(deleteGalleryAlbum(moved, 'one').albums.map(album => album.id)).toEqual(['two']);
  });
});
