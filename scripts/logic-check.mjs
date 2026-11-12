// 足場の動きだけを Node で確かめる（物理エンジンなし）。体のモデルは3通り:
//   free   … 物理上の正確な状態が分かり、足場の速度を引き継いで飛ぶ体（本番で想定している形）
//   carry  … 正確な状態が分からない体（足元の位置だけで動かす。足場が運ぶ）
//   noinh  … 正確な状態は分かるが、上向きの速度を引き継がない体（途中で運ぶ方式に切り替わる）
// 段ごとの高さ、範囲ごとの上限、着地・打ち上げで体ががくっとしないことを見る。
import {TRAMP,createBounce,observe,setExact,stepBounce,powerAt} from '../src/tramp/bounce.mjs'

const DT=1/60
function run(kind,xs,{seconds=60,g=9.81,c=0.2}={}){
 const s=createBounce()
 let y=1.2,vy=0,prev,maxAcc=0
 const apex=[]
 let top=-9,wasUp=false
 const pos=typeof xs==='function'?xs:()=>xs
 for(let t=0;t<seconds;t+=DT){
  observe(s,{x:pos(apex.length),y,z:0},DT)
  if(kind!=='carry')setExact(s,y,vy)
  const plat=stepBounce(s,DT)
  const platV=prev===undefined?0:(plat-prev)/DT
  prev=plat
  const v0=vy
  // 物理エンジンと同じ形: 重力、速度に比例する減速、足場との当たり
  vy=(vy-g*DT)/(1+c*DT)
  y+=vy*DT
  if(y<=plat){
   y=plat
   vy=kind==='noinh'?Math.min(0,platV):kind==='carry'?(platV>0?Math.max(vy,platV):Math.min(0,platV)):Math.max(vy,platV)
  }
  maxAcc=Math.max(maxAcc,Math.abs(vy-v0)/DT)
  if(y>0.3){wasUp=true;top=Math.max(top,y)}
  else if(wasUp&&y<0.1){apex.push(+top.toFixed(2));wasUp=false;top=-9}
 }
 return{apex:apex.slice(1),maxAcc,s}
}

let fail=0
const expect=(name,ok,info)=>{console.log(ok?'PASS':'FAIL',name,info??'');if(!ok)fail++}
const near=(a,b,tol)=>Math.abs(a-b)<=tol
const want=TRAMP.heights
// 高さの許容: 5% か 0.15m
const tol=(h)=>Math.max(0.15,h*0.05)

{
 const {apex:a,maxAcc,s}=run('free',0)
 expect('free・中心: 段ごとの高さ',want.every((h,i)=>near(a[i],h,tol(h))),JSON.stringify(a.slice(0,10)))
 expect('  最高段のあとは 15m で続く',a.length>want.length+2&&near(a[a.length-1],15,0.5),`${a[a.length-1]}m`)
 // 止まった足場に落ちると 1刻みで速度が 0 になる（15m/s なら 900 m/s²）。打ち上げの加速（v²/D ≒ 410）までに収まること
 expect('  着地・打ち上げでがくっとしない',maxAcc<480,`体の加速度の最大 ${maxAcc.toFixed(0)} m/s²`)
 expect('  運ぶ方式に切り替わっていない',!s.carryOnly)
}
{
 // 重力と空気抵抗が想定と違う部屋でも、飛びながら測って合わせる
 const {apex:a,s}=run('free',0,{g:6,c:0,seconds:90})
 const last=a.slice(-3)
 expect('free・重力6/抵抗なし: 測って 15m に合わせる',last.every(h=>near(h,15,0.75)),`${JSON.stringify(last)} g=${s.g.toFixed(2)} c=${s.c.toFixed(3)}`)
}
{
 const {apex:a,maxAcc}=run('carry',0)
 expect('carry・中心: 段ごとの高さ',want.every((h,i)=>near(a[i],h,tol(h))),JSON.stringify(a.slice(0,10)))
 expect('  最高段のあとは 15m で続く',near(a[a.length-1],15,0.5))
 console.log('    （参考）体の加速度の最大',maxAcc.toFixed(0),'m/s²')
}
{
 const {apex:a,s}=run('noinh',0)
 expect('noinh・中心: 運ぶ方式に切り替わって上がる',s.carryOnly&&near(a[a.length-1],15,0.5),JSON.stringify(a.slice(0,10)))
}
{
 const {apex:a}=run('free',1.6)
 const cap=want[5]*powerAt(1.6)
 expect('中間（中心から1.6m）: 6段目で止まる',near(Math.max(...a),cap,tol(cap))&&near(a[a.length-1],cap,tol(cap)),`上限 ${cap.toFixed(2)} ${JSON.stringify(a.slice(0,8))}`)
}
{
 const {apex:a}=run('free',2.6)
 const cap=want[2]*powerAt(2.6)
 expect('ふち（中心から2.6m）: 3段目で止まる',near(Math.max(...a),cap,tol(cap))&&a.length>4,`上限 ${cap.toFixed(2)} ${JSON.stringify(a.slice(0,6))}`)
 expect('  ふちでも1.5m以上は跳ねる',a[2]>1.5)
}
{
 // 中心で9段まで上げてから、ふちへ移る → 1回ごとに段が下がる
 const {apex:a}=run('free',(n)=>n<11?0:2.6,{seconds:80})
 const tail=a.slice(11,20)
 const cap=want[2]*powerAt(2.6)
 expect('高い段からふちへ: 少しずつ下がる',tail[0]<15&&tail.every((h,i)=>i===0||h<=tail[i-1]+0.15)&&near(tail[tail.length-1],cap,tol(cap)),JSON.stringify(tail))
}
process.exit(fail?1:0)
