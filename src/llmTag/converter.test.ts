import {describe,expect,it} from 'vitest';
import {CHINESE_TAG_SYSTEM_PROMPT,filterWorldbookEntries,selectBorrowedPresetText,shouldSkipWorldbookEntry} from './converter';
describe('Chinese to Tag worldbook selection',()=>{
 it('skips irrelevant entries and clips output-format sections',()=>{
  expect(shouldSkipWorldbookEntry({comment:'构思与自检',content:'x'})).toBe(true);
  const rows=filterWorldbookEntries([{world:'A',uid:1,comment:'人物设定',content:'角色外貌设定\n## 输出格式\nimage###...'}, {world:'A',uid:2,comment:'彩蛋规则',content:'不要带入'}]);
  expect(rows).toHaveLength(1); expect(rows[0].content).toBe('角色外貌设定');
 });
 it('honors whole-book and individual-entry exclusions',()=>{
  const rows=[{world:'A',uid:1,comment:'a',content:'A1'},{world:'A',uid:2,comment:'b',content:'A2'},{world:'B',uid:1,comment:'c',content:'B1'}];
  expect(filterWorldbookEntries(rows,['A']).map(x=>x.content)).toEqual(['B1']);
  expect(filterWorldbookEntries(rows,[],['A::2']).map(x=>x.content)).toEqual(['A1','B1']);
 });
 it('deduplicates identical activated content',()=>{
  expect(filterWorldbookEntries([{world:'A',uid:1,comment:'a',content:'same'},{world:'B',uid:2,comment:'b',content:'same'}])).toHaveLength(1);
 });
});
describe('Chinese to Tag preset borrowing',()=>{
 it('borrows selected non-marker entries and expands macros',()=>{
  const text=selectBorrowedPresetText([{id:'a',name:'A',content:'Hello {{char}}'},{id:'b',name:'B',content:'hidden',marker:true},{id:'c',name:'C',content:'not selected'}],['a','b'],v=>v.replace('{{char}}','小雪'));
  expect(text).toBe('Hello 小雪');
 });
 it('keeps role-action and output constraints',()=>{
  expect(CHINESE_TAG_SYSTEM_PROMPT).toContain('最终只输出一行 tag');
  expect(CHINESE_TAG_SYSTEM_PROMPT).toContain('source#'); expect(CHINESE_TAG_SYSTEM_PROMPT).toContain('target#'); expect(CHINESE_TAG_SYSTEM_PROMPT).toContain('mutual#');
 });
});
