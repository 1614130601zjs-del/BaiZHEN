import { describe, expect, it } from 'vitest';
import { materializeVibeGroup, migrateLegacyVibeLibrary } from '@/backends/vibePool';
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
