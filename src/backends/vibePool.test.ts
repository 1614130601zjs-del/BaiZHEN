import { describe, expect, it } from 'vitest';
import { applyVibeRefInformationExtracted, materializeVibeGroup, migrateLegacyVibeLibrary } from '@/backends/vibePool';
import type { NaiVibe } from '@/state/settings';
const v=(id:string,group:string,strength:number,enabled:boolean):NaiVibe=>({id,name:id,dataPath:`/files/${id}`,thumbnailPath:'',modelKeys:['v4-5full'],hasImage:true,fingerprint:id,strength,enabled,group});
describe('Vibe pool migration',()=>{
 it('preserves grouped and ungrouped legacy refs',()=>{const r=migrateLegacyVibeLibrary([v('a','组',.4,true),v('b','',.8,false)]);expect(r.pool.map(x=>x.id)).toEqual(['a','b']);expect(r.groups.map(x=>x.refs[0])).toEqual([{poolId:'a',strength:.4,enabled:true},{poolId:'b',strength:.8,enabled:false}]);});
 it('allows one resource in multiple groups with independent strengths',()=>{const a=v('shared','甲',.3,true),b={...a,group:'乙',strength:.9,enabled:false};const r=migrateLegacyVibeLibrary([a,b]);expect(r.pool).toHaveLength(1);expect(r.groups.map(x=>x.refs[0].strength)).toEqual([.3,.9]);});
});
describe('materializeVibeGroup',()=>{
 it('creates a legacy backend view without mutating the resource',()=>{const source=v('a','',.5,false),r=migrateLegacyVibeLibrary([source]);expect(materializeVibeGroup({...r.groups[0],name:'新组',refs:[{poolId:'a',strength:.75,enabled:true}]},r.pool)).toEqual([{...r.pool[0],strength:.75,enabled:true,group:'新组'}]);expect(source.strength).toBe(.5);});
 it('skips dangling references',()=>expect(materializeVibeGroup({id:'g',name:'组',refs:[{poolId:'missing',strength:1,enabled:true}]},[])).toEqual([]));
});

describe('Vibe group Information Extracted overrides',()=>{
 it('applies a per-reference override without mutating shared pool data',()=>{
  const source={image:'',thumbnail:'',encodings:{'v4-5full':{encoding:'abc',infoExtracted:0.4},'v5':{encoding:'def',infoExtracted:0.7}}};
  const next=applyVibeRefInformationExtracted(source,0.9);
  expect(Object.values(next.encodings).map(x=>x.infoExtracted)).toEqual([0.9,0.9]);
  expect(Object.values(source.encodings).map(x=>x.infoExtracted)).toEqual([0.4,0.7]);
 });
 it('leaves per-model values unchanged when no group override is set',()=>{
  const source={image:'',thumbnail:'',encodings:{v5:{encoding:'abc',infoExtracted:0.7}}};
  expect(applyVibeRefInformationExtracted(source)).toBe(source);
 });
 it('falls back to resource Information Extracted unless a group ref overrides it',()=>{
  const source={...v('a','',.5,true),informationExtracted:0.72};
  const pool=migrateLegacyVibeLibrary([source]).pool;
  const inherited=materializeVibeGroup({id:'g1',name:'继承',refs:[{poolId:'a',strength:.4,enabled:true}]},pool);
  const overridden=materializeVibeGroup({id:'g2',name:'覆盖',refs:[{poolId:'a',strength:.8,enabled:true,informationExtracted:0.91}]},pool);
  expect(inherited[0].informationExtracted).toBe(0.72);
  expect(overridden[0].informationExtracted).toBe(0.91);
 });

 it('migrates per-group Information Extracted overrides independently',()=>{
  const first={...v('shared','甲',.3,true),informationExtracted:0.42};
  const second={...first,group:'乙',strength:.9,informationExtracted:0.93};
  const migrated=migrateLegacyVibeLibrary([first,second]);
  expect(migrated.pool).toHaveLength(1);
  expect(migrated.groups.map(group=>group.refs[0].informationExtracted)).toEqual([0.42,0.93]);
 });

});
