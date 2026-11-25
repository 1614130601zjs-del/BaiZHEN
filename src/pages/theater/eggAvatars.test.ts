import { describe, expect, it } from 'vitest';
import { addEggAvatarName, collectEggAvatarNames, hideEggAvatarName, normalizeEggAvatarUrl, setEggAvatar } from '@/pages/theater/eggAvatars';
describe('theater egg avatar library', () => {
 it('collects speakers and narrator from records, avatar keys and manual names', () => {
  const names=collectEggAvatarNames([{room:{narrator:'旁白'},messages:[{speaker:'甲'},{speaker:'乙'}]}],{eggAvatars:{丙:'data:image/png;base64,x'},eggAvatarManualNames:['丁']});
  expect(names).toEqual(['丁','丙','乙','甲','旁白'].sort((a,b)=>a.localeCompare(b,'zh')));
 });
 it('adds manual name and unhides it',()=>{
  expect(addEggAvatarName({eggAvatarHiddenNames:['甲']},'甲').eggAvatarHiddenNames).toEqual([]);
 });
 it('stores data URL and supports legacy url object',()=>{
  expect(setEggAvatar({},'甲','data:image/png;base64,x').eggAvatars?.['甲']).toBe('data:image/png;base64,x');
  expect(normalizeEggAvatarUrl({url:'https://example.com/a.png'})).toBe('https://example.com/a.png');
 });
 it('hides name and deletes avatar/manual entry without deleting chat snapshot',()=>{
  const next=hideEggAvatarName({eggAvatars:{甲:'data:image/png;base64,x'},eggAvatarManualNames:['甲'],eggAvatarHiddenNames:[]},'甲');
  expect(next.eggAvatars?.['甲']).toBeUndefined();
  expect(next.eggAvatarManualNames).toEqual([]);
  expect(next.eggAvatarHiddenNames).toEqual(['甲']);
 });
});
