<script setup lang="ts">
import { ref, watch } from 'vue';
export interface ComicBubble { id:string; shape:'speech'|'thought'; x:number; y:number; w:number; h:number; text:string }
const props=defineProps<{imageSrc:string;modelValue?:ComicBubble[];panelTexts?:string[]}>();
const emit=defineEmits<{ 'update:modelValue':[value:ComicBubble[]] }>();
const bubbles=ref<ComicBubble[]>([]);
const layer=ref<HTMLElement|null>(null);
const drag=ref<{id:string;mode:'move'|'resize';sx:number;sy:number;x:number;y:number;w:number;h:number;rect:DOMRect}|null>(null);
function publish(){emit('update:modelValue',bubbles.value.map(b=>({...b})));}
watch(()=>props.modelValue,v=>{if(Array.isArray(v))bubbles.value=v.map(b=>({...b}));},{immediate:true,deep:true});
function add(shape:'speech'|'thought'){bubbles.value.push({id:'bubble_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),shape,x:18,y:18,w:40,h:20,text:''});publish();}
function remove(id:string){bubbles.value=bubbles.value.filter(b=>b.id!==id);publish();}
function start(e:PointerEvent,b:ComicBubble,mode:'move'|'resize'){if(!layer.value)return;e.preventDefault();(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);drag.value={id:b.id,mode,sx:e.clientX,sy:e.clientY,x:b.x,y:b.y,w:b.w,h:b.h,rect:layer.value.getBoundingClientRect()};}
function move(e:PointerEvent){if(!drag.value)return;const d=drag.value,b=bubbles.value.find(x=>x.id===d.id);if(!b)return;const dx=(e.clientX-d.sx)/d.rect.width*100,dy=(e.clientY-d.sy)/d.rect.height*100;if(d.mode==='move'){b.x=Math.max(0,Math.min(100-b.w,d.x+dx));b.y=Math.max(0,Math.min(100-b.h,d.y+dy));}else{b.w=Math.max(10,Math.min(100-b.x,d.w+dx));b.h=Math.max(8,Math.min(100-b.y,d.h+dy));}}
function end(){if(drag.value){drag.value=null;publish();}}
function editText(b:ComicBubble,e:Event){b.text=(e.target as HTMLTextAreaElement).value;publish();}
function wrap(ctx:CanvasRenderingContext2D,s:string,max:number){const lines:string[]=[];for(const para of s.split(/\n+/)){let line='';for(const ch of para){if(line&&ctx.measureText(line+ch).width>max){lines.push(line);line=ch;}else line+=ch;}if(line)lines.push(line);}return lines;}
async function exportImage(){const img=new Image();img.crossOrigin='anonymous';img.src=props.imageSrc;await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('图片加载失败'));});const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法创建画布');ctx.drawImage(img,0,0);for(const b of bubbles.value){const x=b.x/100*canvas.width,y=b.y/100*canvas.height,w=b.w/100*canvas.width,h=b.h/100*canvas.height;ctx.save();ctx.fillStyle='#fff';ctx.strokeStyle='#1a1a1a';ctx.lineWidth=Math.max(2,Math.min(w,h)*.02);ctx.beginPath();const r=Math.min(w,h)*(b.shape==='thought'?.5:.22);if(typeof ctx.roundRect==='function')ctx.roundRect(x,y,w,h,r);else{ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);}ctx.fill();ctx.stroke();if(b.shape==='thought'){let cx=x+w*.22,cy=y+h,rr=Math.min(w,h)*.09;for(let i=0;i<3;i++){cx-=rr*1.6;cy+=rr*1.4;rr*=.7;ctx.beginPath();ctx.arc(cx,cy,Math.max(1.5,rr),0,Math.PI*2);ctx.fill();ctx.stroke();}}if(b.text.trim()){let size=Math.max(12,Math.min(h*.22,w*.12)),lines:string[]=[];ctx.fillStyle='#111';ctx.textAlign='center';ctx.textBaseline='middle';for(let i=0;i<4;i++){ctx.font=size+'px sans-serif';lines=wrap(ctx,b.text,w*.76);if(lines.length*size*1.25<=h*.7||size<=11)break;size*=.8;}ctx.font=size+'px sans-serif';const lh=size*1.25,sy=y+h/2-lines.length*lh/2+lh/2;lines.forEach((line,i)=>ctx.fillText(line,x+w/2,sy+i*lh));}ctx.restore();}const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='baibai-comic-bubbles.png';a.click();}
</script>
<template>
<div class="comic-editor">
 <div ref="layer" class="stage" @pointermove="move" @pointerup="end" @pointercancel="end">
  <img :src="imageSrc" alt="条漫图片">
  <div class="bubble-layer">
   <div v-for="b in bubbles" :key="b.id" class="bubble" :class="b.shape" :style="{left:b.x+'%',top:b.y+'%',width:b.w+'%',height:b.h+'%'}">
    <div class="bubble-shape" @pointerdown="start($event,b,'move')"></div>
    <textarea :value="b.text" placeholder="输入台词…" aria-label="气泡台词" @pointerdown.stop @input="editText(b,$event)"></textarea>
    <button type="button" class="remove" aria-label="删除气泡" @click="remove(b.id)">×</button>
    <button type="button" class="resize" aria-label="调整气泡大小" @pointerdown.stop="start($event,b,'resize')"></button>
   </div>
  </div>
 </div>
 <div class="toolbar"><button type="button" @click="add('speech')">＋ 对话气泡</button><button type="button" @click="add('thought')">＋ 心理气泡</button><button type="button" @click="exportImage">合成导出</button></div>
</div>
</template>
<style scoped>
.comic-editor{display:flex;flex-direction:column;gap:8px}.stage{position:relative;width:100%;line-height:0;touch-action:pan-y}.stage>img{display:block;width:100%;height:auto;border-radius:8px}.bubble-layer{position:absolute;inset:0;pointer-events:none}.bubble{position:absolute;min-width:10%;min-height:8%;pointer-events:none;line-height:normal}.bubble-shape{position:absolute;inset:0;border:2px solid #1a1a1a;border-radius:16px;background:rgba(255,255,255,.95);box-shadow:0 2px 6px #0003;cursor:grab;touch-action:none;pointer-events:auto}.thought .bubble-shape{border-radius:50%}.bubble textarea{position:absolute;inset:8% 10%;width:80%;height:84%;padding:0;border:0;resize:none;background:transparent;color:#111;text-align:center;font-size:clamp(10px,2vw,18px);line-height:1.25;outline:none;pointer-events:auto}.remove,.resize{position:absolute;pointer-events:auto;width:24px;height:24px;padding:0!important;border:2px solid #111!important;border-radius:50%!important;background:#fff!important;color:#111!important;line-height:18px}.remove{top:-10px;right:-10px}.resize{right:-9px;bottom:-9px;width:20px;height:20px;background:#ddd!important;touch-action:none;cursor:se-resize}.toolbar{display:flex;gap:8px;flex-wrap:wrap}
</style>
