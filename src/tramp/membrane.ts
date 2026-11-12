import {BufferAttribute,BufferGeometry,ClampToEdgeWrapping,DataTexture,DataUtils,DoubleSide,FileLoader,HalfFloatType,LinearFilter,MeshStandardMaterial,RedFormat,Sphere,Vector3,Vector4} from 'three'
import {TRAMP} from './bounce.mjs'
import meta from './vat-meta.json'

export const MAX_DENTS=4
export const MAX_RINGS=2
export const VAT_FILE='tramp_vat.bin'
export const VAT_META=meta

const NR=56,NS=128
const Z0=TRAMP.zones[0].to,Z1=TRAMP.zones[1].to

/** 膜のメッシュ（極座標の格子）。高さは頂点シェーダーで付ける */
function buildGeometry(){
 const pos=new Float32Array(NR*NS*3),nor=new Float32Array(NR*NS*3)
 for(let j=0;j<NR;j++)for(let i=0;i<NS;i++){
  const r=(j/(NR-1))*TRAMP.R,th=(i/NS)*Math.PI*2,p=(j*NS+i)*3
  pos[p]=r*Math.cos(th);pos[p+2]=r*Math.sin(th);nor[p+1]=1
 }
 const index:number[]=[]
 for(let j=0;j<NR-1;j++)for(let i=0;i<NS;i++){
  const a=j*NS+i,b=j*NS+((i+1)%NS),c=a+NS,d=b+NS
  // 上面が表になる巻き方（裏だと法線が反転して真っ黒になる）
  index.push(a,b,c,b,d,c)
 }
 const g=new BufferGeometry()
 g.setAttribute('position',new BufferAttribute(pos,3))
 g.setAttribute('normal',new BufferAttribute(nor,3))
 g.setIndex(index)
 g.boundingSphere=new Sphere(new Vector3(),TRAMP.R+1)
 return g
}

const f=(n:number)=>n.toFixed(1)
const TW=meta.SECTORS+1

const HEAD=/* glsl */`
uniform vec4 uDent[${MAX_DENTS}];
uniform vec4 uRing[${MAX_RINGS}];
uniform sampler2D uVat;
varying vec2 vTrampXZ;
const float TR=${TRAMP.R.toFixed(3)};
// VAT の1コマ。tile=クリップ番号×コマ数+コマ、a=角度（0〜1 でひと回り）、rc=中心からの距離（0〜1）
float trampVat(float tile,float a,float rc){
 float col=mod(tile,${f(meta.COLS)});
 float row=floor(tile/${f(meta.COLS)});
 float u=(col*${f(TW)}+0.5+fract(a)*${f(meta.SECTORS)})/${f(meta.width)};
 float v=(row*${f(meta.RINGS)}+0.5+rc*${f(meta.RINGS-1)})/${f(meta.height)};
 return texture2D(uVat,vec2(u,v)).r;
}
// 膜の高さ。踏んでいる足のくぼみ（式）＋離れたあとの揺れ戻し（VAT）
float trampH(vec2 p){
 float r=length(p);
 float rim=max(0.0,1.0-r*r/(TR*TR));
 float h=0.0;
 for(int i=0;i<${MAX_DENTS};i++){
  vec4 d=uDent[i];
  if(d.z<=0.0)continue;
  float prim=max(0.12,1.0-dot(d.xy,d.xy)/(TR*TR));
  float dd=length(p-d.xy);
  float q1=dd/0.4,q2=dd/1.3;
  // 足元の鋭いくぼみ＋膜全体がゆるく引かれる分
  h-=d.z*min(1.0,rim/prim)*(0.55/pow(1.0+q1*q1,1.2)+0.45/(1.0+q2*q2));
 }
 float th=atan(p.y,p.x);
 float rc=clamp(r/TR,0.0,1.0);
 for(int i=0;i<${MAX_RINGS};i++){
  vec4 g=uRing[i];
  float fr=g.w*${f(meta.FPS)};
  if(g.z<=0.0||fr>=${f(meta.FRAMES-1)})continue;
  float f0=floor(fr),ft=fr-f0;
  float c0=floor(g.y),ct=g.y-c0,c1=min(c0+1.0,${f(meta.K-1)});
  float a=(th-g.x)/6.2831853;
  float t0=c0*${f(meta.FRAMES)}+f0,t1=c1*${f(meta.FRAMES)}+f0;
  float va=mix(trampVat(t0,a,rc),trampVat(t0+1.0,a,rc),ft);
  float vb=mix(trampVat(t1,a,rc),trampVat(t1+1.0,a,rc),ft);
  h+=g.z*mix(va,vb,ct);
 }
 return h;
}
`

export type Membrane=ReturnType<typeof createMembrane>

export function createMembrane(){
 const dents=Array.from({length:MAX_DENTS},()=>new Vector4())
 const rings=Array.from({length:MAX_RINGS},()=>new Vector4(0,0,0,99))
 // 読み込みが終わるまでの仮のテクスチャ（高さ 0）
 const blank=new DataTexture(new Uint16Array([0]),1,1,RedFormat,HalfFloatType)
 blank.needsUpdate=true
 const uniforms={uDent:{value:dents},uRing:{value:rings},uVat:{value:blank as DataTexture}}
 const material=new MeshStandardMaterial({color:'#3b414c',roughness:0.5,metalness:0,side:DoubleSide})
 material.onBeforeCompile=(shader)=>{
  Object.assign(shader.uniforms,uniforms)
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\n'+HEAD)
   .replace('#include <beginnormal_vertex>',/* glsl */`
    float trampH0=trampH(position.xz);
    vec3 objectNormal=normalize(vec3(trampH0-trampH(position.xz+vec2(0.04,0.0)),0.04,trampH0-trampH(position.xz+vec2(0.0,0.04))));
   `)
   .replace('#include <begin_vertex>',/* glsl */`
    vec3 transformed=vec3(position.x,trampH0,position.z);
    vTrampXZ=position.xz;
   `)
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>','#include <common>\nvarying vec2 vTrampXZ;')
   .replace('#include <color_fragment>',/* glsl */`#include <color_fragment>
    {
     float tr=length(vTrampXZ);
     float trw=max(fwidth(tr),0.0005);
     // 範囲の色分け: 中心は赤み、ふちは青み
     vec3 base=diffuseColor.rgb;
     base=mix(base,vec3(0.5,0.16,0.15),0.3*(1.0-smoothstep(${Z0.toFixed(2)}-0.01,${Z0.toFixed(2)}+0.01,tr)));
     base=mix(base,vec3(0.14,0.28,0.55),0.3*smoothstep(${Z1.toFixed(2)}-0.01,${Z1.toFixed(2)}+0.01,tr));
     // 布目（4.5cm の格子）。遠くでは細かすぎてちらつくので消す
     vec2 gp=vTrampXZ/0.045;
     vec2 gw=max(fwidth(gp),vec2(0.0001));
     vec2 gd=abs(fract(gp-0.5)-0.5)/gw;
     float weave=(1.0-min(min(gd.x,gd.y),1.0))*(1.0-smoothstep(0.2,0.55,max(gw.x,gw.y)));
     base*=1.0-0.4*weave;
     // 範囲の境の線・ふちの線・真ん中の十字
     float l0=1.0-smoothstep(0.02,0.02+trw,abs(tr-${Z0.toFixed(2)}));
     float l1=1.0-smoothstep(0.02,0.02+trw,abs(tr-${Z1.toFixed(2)}));
     float l2=1.0-smoothstep(0.025,0.025+trw,abs(tr-${(TRAMP.R-0.12).toFixed(2)}));
     vec2 ta=abs(vTrampXZ);
     float cross=max(step(ta.x,0.04)*step(ta.y,0.36),step(ta.y,0.04)*step(ta.x,0.36));
     base=mix(base,vec3(0.9,0.2,0.17),max(l0,cross));
     base=mix(base,vec3(0.88,0.9,0.92),max(l1,l2)*(1.0-cross));
     diffuseColor.rgb=base;
    }
   `)
 }
 material.customProgramCacheKey=()=>'tramp-membrane-v2'
 const geometry=buildGeometry()
 let vat:DataTexture|null=null
 let disposed=false

 /** VAT を読み込む（int16 の生データ → 半精度の1チャンネルテクスチャ） */
 function load(url:string){
  const loader=new FileLoader()
  loader.setResponseType('arraybuffer')
  loader.load(url,(buf)=>{
   if(disposed)return
   const src=new Int16Array(buf as ArrayBuffer)
   if(src.length!==meta.width*meta.height){console.warn('[trampoline] VAT の大きさが違います',src.length);return}
   const half=new Uint16Array(src.length)
   for(let i=0;i<src.length;i++)half[i]=DataUtils.toHalfFloat(src[i]/32767)
   const t=new DataTexture(half,meta.width,meta.height,RedFormat,HalfFloatType)
   t.magFilter=t.minFilter=LinearFilter
   t.wrapS=t.wrapT=ClampToEdgeWrapping
   t.generateMipmaps=false
   t.needsUpdate=true
   vat=t
   uniforms.uVat.value=t
  },undefined,(e)=>console.warn('[trampoline] VAT を読めませんでした',e))
 }

 function dispose(){
  disposed=true
  geometry.dispose()
  material.dispose()
  blank.dispose()
  vat?.dispose()
 }
 return{geometry,material,dents,rings,load,dispose,ready:()=>vat!==null}
}
