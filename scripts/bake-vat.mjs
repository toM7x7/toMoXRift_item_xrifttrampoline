// 膜の揺れ戻しを波のシミュレーションで焼いて VAT にする。
//   node scripts/bake-vat.mjs  →  public/tramp_vat.bin と src/tramp/vat-meta.json
//
// 中身: 足が離れた直後の膜（平らで、踏まれていた所だけ上向きに動いている）から、減衰する波を解く。
// 踏んだ場所は中心からの距離で K 通り。向きは実行時に回して合わせるので +X 方向の分だけ焼く。
// 置き方: 1コマ = 横 SECTORS+1（最後の列は最初の列の写し。角度の継ぎ目をまたいで補間できる）× 縦 RINGS のタイル。
// タイル番号 = クリップ番号 × FRAMES + コマ を、横 COLS 枚ずつ並べる。値は int16（±1 に正規化）。
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'

const R=3.0
const K=8,QS=Array.from({length:K},(_,k)=>k*0.125)
const FRAMES=36,FPS=30
const SECTORS=64,RINGS=28,COLS=16
const N=129,DX=(2*R)/(N-1)
const C=14.1        // 波の速さ。基本の揺れが約 1.8Hz になる
const DAMP=3.0      // 減衰（1/秒）
const SUB=20        // 1コマあたりの細かい刻み
const DT=1/(FPS*SUB)

const idx=(i,j)=>j*N+i
const mask=new Uint8Array(N*N)
for(let j=0;j<N;j++)for(let i=0;i<N;i++){
 const x=-R+i*DX,z=-R+j*DX
 mask[idx(i,j)]=Math.hypot(x,z)<R-DX*0.5?1:0
}

function sample(u,x,z){
 const fx=(x+R)/DX,fz=(z+R)/DX
 const i=Math.max(0,Math.min(N-2,Math.floor(fx))),j=Math.max(0,Math.min(N-2,Math.floor(fz)))
 const a=fx-i,b=fz-j
 return u[idx(i,j)]*(1-a)*(1-b)+u[idx(i+1,j)]*a*(1-b)+u[idx(i,j+1)]*(1-a)*b+u[idx(i+1,j+1)]*a*b
}

const clips=[]
let peak=0
for(let k=0;k<K;k++){
 const px=QS[k]*R
 let u=new Float32Array(N*N),v=new Float32Array(N*N)
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  if(!mask[idx(i,j)])continue
  const x=-R+i*DX,z=-R+j*DX
  const d=Math.hypot(x-px,z)
  const rim=1-(x*x+z*z)/(R*R)
  v[idx(i,j)]=rim*(0.55/Math.pow(1+(d/0.4)**2,1.2)+0.45/(1+(d/1.3)**2))
 }
 const frames=[]
 for(let f=0;f<FRAMES;f++){
  for(let s=0;s<SUB;s++){
   for(let j=1;j<N-1;j++)for(let i=1;i<N-1;i++){
    const p=idx(i,j)
    if(!mask[p])continue
    const lap=(u[p-1]+u[p+1]+u[p-N]+u[p+N]-4*u[p])/(DX*DX)
    v[p]+=(C*C*lap-DAMP*v[p])*DT
   }
   for(let p=0;p<N*N;p++)if(mask[p])u[p]+=v[p]*DT
  }
  // 最後は 0 へ消す（クリップが終わったとき段差が出ないように）
  const fade=Math.min(1,(FRAMES-1-f)/8)
  const tile=new Float32Array(SECTORS*RINGS)
  for(let j=0;j<RINGS;j++){
   const rr=(j/(RINGS-1))*R*0.999
   for(let i=0;i<SECTORS;i++){
    const th=(i/SECTORS)*Math.PI*2
    const val=j===RINGS-1?0:sample(u,rr*Math.cos(th),rr*Math.sin(th))*fade
    tile[j*SECTORS+i]=val
    peak=Math.max(peak,Math.abs(val))
   }
  }
  frames.push(tile)
 }
 clips.push(frames)
}

const TW=SECTORS+1,W=TW*COLS,ROWS=Math.ceil((K*FRAMES)/COLS),HH=ROWS*RINGS
const out=new Int16Array(W*HH)
for(let k=0;k<K;k++)for(let f=0;f<FRAMES;f++){
 const n=k*FRAMES+f,ox=(n%COLS)*TW,oy=Math.floor(n/COLS)*RINGS
 const t=clips[k][f]
 for(let j=0;j<RINGS;j++)for(let i=0;i<TW;i++)out[(oy+j)*W+ox+i]=Math.round((t[j*SECTORS+(i%SECTORS)]/peak)*32767)
}
const root=join(import.meta.dirname,'..')
writeFileSync(join(root,'public','tramp_vat.bin'),Buffer.from(out.buffer))
const meta={R,K,QSTEP:0.125,FRAMES,FPS,SECTORS,RINGS,COLS,width:W,height:HH}
writeFileSync(join(root,'src','tramp','vat-meta.json'),JSON.stringify(meta,null,1)+String.fromCharCode(10))
console.log('vat',meta,'bytes',out.byteLength,'peak',peak.toFixed(4))
