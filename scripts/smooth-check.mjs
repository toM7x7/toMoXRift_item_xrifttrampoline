// がたつきの確認。ラボ（?lab=<Hz>）で物理の刻みと描画のコマをずらし、実際の物理で
// 段ごとの高さと、体の加速度の最大（止まった足場に激突すると 900 m/s² 前後になる）を見る。
//   node scripts/smooth-check.mjs [old]   dev サーバー 5313 を先に起動。old を付けると旧方式（コマごと）も測る
import {chromium} from 'playwright'
import {join} from 'node:path'

const BASE='http://127.0.0.1:5313/'
const exe=join(process.env.LOCALAPPDATA??'','ms-playwright','chromium-1243','chrome-win64','chrome.exe')
const browser=await chromium.launch({executablePath:exe,args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']})
let fail=0
const expect=(name,ok,info)=>{console.log(ok?'PASS':'FAIL',name,info??'');if(!ok)fail++}
const WANT=[1.0,1.8,2.8,4.0,5.5,7.5,9.5,12,15]
/** 膜の高さ（記録はワールド座標の足元） */
const H=1.0

async function measure(hz,kind){
 const page=await browser.newPage({viewport:{width:960,height:540}})
 const errors=[]
 page.on('pageerror',e=>errors.push(String(e)))
 await page.goto(`${BASE}?lab=${hz}${kind==='carry'?'&carry=1':kind==='old'?'&carry=1&drive=frame':''}`)
 await page.waitForFunction(()=>(window.__trampSteps?.length??0)>10,null,{timeout:60000})
 await page.waitForTimeout(34000)
 const {steps,frames,st}=await page.evaluate(()=>({steps:window.__trampSteps,frames:window.__trampLog.length,st:{free:window.__tramp.bounce.free,carryOnly:window.__tramp.bounce.carryOnly,g:window.__tramp.bounce.g,c:window.__tramp.bounce.c}}))
 await page.close()
 const apex=[]
 let top=-9,up=false,maxAcc=0,pv=null
 for(let i=1;i<steps.length;i++){
  const s=steps[i],v=(s.y-steps[i-1].y)/s.dt
  if(pv!==null)maxAcc=Math.max(maxAcc,Math.abs(v-pv)/s.dt)
  pv=v
  const h=s.y-H
  if(h>0.3){up=true;top=Math.max(top,h)}
  else if(up&&h<0.1){apex.push(+top.toFixed(2));up=false;top=-9}
 }
 return{hz,kind,stepsPerFrame:+(steps.length/frames).toFixed(2),apex:apex.slice(1),maxAcc:Math.round(maxAcc),st,errors}
}

const kinds=process.argv[2]==='old'?['free','carry','old']:['free','carry']
const jobs=[]
// 0 = 刻みがコマごと（開発環境と同じ）。30 / 60 / 120 = 固定の刻み（描画は約60コマ）
for(const hz of[0,30,60,120])for(const kind of kinds)jobs.push([hz,kind])
const rows=[]
for(let i=0;i<jobs.length;i+=2)rows.push(...await Promise.all(jobs.slice(i,i+2).map(j=>measure(...j))))
for(const r of rows){
 const name=`刻み ${r.hz||'コマごと'}・${r.kind}`
 console.log(`${name}: 1コマあたり ${r.stepsPerFrame} 刻み  高さ ${JSON.stringify(r.apex)}  加速度の最大 ${r.maxAcc}  ${JSON.stringify(r.st)}`)
 if(r.errors.length)console.log('  errors',r.errors.slice(0,3))
 if(r.kind==='old')continue
 const tol=(h)=>Math.max(0.2,h*0.07)
 expect(`${name}: 段ごとの高さ`,r.apex.length>=9&&WANT.every((h,i)=>Math.abs(r.apex[i]-h)<=tol(h)))
 expect(`${name}: 着地でがくっとしない（加速度 550 m/s² 未満）`,r.maxAcc<550)
 if(r.kind==='free')expect(`${name}: 体を見つけて自由に飛ばしている`,r.st.free&&!r.st.carryOnly)
}
await browser.close()
process.exit(fail?1:0)
