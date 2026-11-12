// 実際の物理（DevEnvironment の体）で跳ねるかを GPU 付き Chrome で確かめる。dev サーバー 5313 を先に起動。
//   node scripts/bounce-check.mjs [shot]
import {chromium} from 'playwright'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'

const BASE='http://127.0.0.1:5313/'
const OUT=join(import.meta.dirname,'..','docs','shots')
mkdirSync(OUT,{recursive:true})
const exe=join(process.env.LOCALAPPDATA??'','ms-playwright','chromium-1243','chrome-win64','chrome.exe')
const H=1.0,WANT=[1.0,1.8,2.8,4.0,5.5,7.5,9.5,12,15]
const tol=(h)=>Math.max(0.2,h*0.07)
const browser=await chromium.launch({executablePath:exe,args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']})
const errors=[]
let fail=0
const expect=(name,ok,info)=>{console.log(ok?'PASS':'FAIL',name,info??'');if(!ok)fail++}

async function open(query){
 const page=await browser.newPage({viewport:{width:1280,height:720}})
 page.on('pageerror',e=>errors.push(String(e)))
 page.on('console',m=>{if(m.type()==='error'&&!/favicon/.test(m.location().url))errors.push(m.text()+' '+m.location().url)})
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)})
 await page.goto(BASE+query)
 await page.waitForFunction(()=>!!window.__tramp&&(window.__trampLog?.length??0)>5,null,{timeout:60000})
 return page
}
/** 記録から、膜より上の山の頂点（膜からの高さ）を取り出す */
const apexes=(log)=>{
 const out=[];let top=-9,up=false
 for(const s of log){
  const y=s.y-H
  if(y>0.3){up=true;top=Math.max(top,y)}
  else if(up&&y<0.1){out.push(+top.toFixed(2));up=false;top=-9}
 }
 return out
}

// 1) 真ん中の上に出て落ちる → 何もしなくても段々高くなる
{
 const page=await open('?spawn=0,2.6,0&cam=11,6.5,12.5,0,5.5,0')
 await page.waitForTimeout(36000)
 const log=await page.evaluate(()=>window.__trampLog)
 const a=apexes(log).slice(1)
 const fps=log.length/(log[log.length-1].t-log[0].t)
 console.log('fps',fps.toFixed(0),'apex',JSON.stringify(a))
  // 1回目は読み込み中の長いコマで落ちてくるので高さが揃わない。2回目から見る
 expect('真ん中: 跳ねるたびに高くなる（2段目から）',a.length>=9&&WANT.every((h,i)=>i===0||Math.abs(a[i]-h)<=tol(h)),JSON.stringify(a.slice(0,9)))
 expect('真ん中: 15m で頭打ち',a.length>9&&Math.abs(a[a.length-1]-15)<0.8)
 expect('VAT が読めている',await page.evaluate(()=>window.__tramp.membrane.ready()))
 expect('物理上の体を見つけて自由に飛ばしている',await page.evaluate(()=>window.__tramp.bounce.free&&!window.__tramp.bounce.carryOnly))
 if(process.argv[2]==='shot'){
  const wait=(fn)=>page.waitForFunction(fn,null,{timeout:30000,polling:'raf'})
  await wait(()=>window.__trampLog.at(-1).y>14.5)
  await page.screenshot({path:join(OUT,'apex.png')})
  // 近くから: 沈んだ瞬間と、足が離れた直後の揺れ戻し（中心から外れた所）
  const near=await open('?spawn=1.2,2.6,0.5&cam=5.2,3.6,6.2,0.4,0.7,0')
  const waitN=(fn)=>near.waitForFunction(fn,null,{timeout:40000,polling:'raf'})
  await waitN(()=>window.__tramp.bounce.level>=5&&window.__tramp.bounce.mode==='press'&&window.__tramp.bounce.y<-0.45)
  await near.screenshot({path:join(OUT,'near-press.png')})
  await waitN(()=>window.__tramp.bounce.mode==='rest'&&window.__trampLog.at(-1).y>2.2)
  await near.screenshot({path:join(OUT,'near-ring.png')})
  await near.close()
 }
 await page.close()
}
// 2) 中間・ふちに落ちる → その範囲の上限で止まる（ふちでもちゃんと跳ねる）
for(const [name,x,cap] of [['中間（1.6m）',1.6,7.5*(1-0.3*(1.6/3)**2)],['ふち（2.6m）',2.6,2.8*(1-0.3*(2.6/3)**2)]]){
 const page=await open(`?spawn=${x},2.6,0`)
 await page.waitForTimeout(name.startsWith('中')?26000:10000)
 const a=apexes(await page.evaluate(()=>window.__trampLog)).slice(1)
 expect(`${name}: 上限 ${cap.toFixed(2)}m で止まる`,a.length>=4&&Math.abs(Math.max(...a)-cap)<=tol(cap)+0.1&&Math.abs(a[a.length-1]-cap)<=tol(cap)+0.1,JSON.stringify(a.slice(0,9)))
 await page.close()
}
// 3) 外に出たまま → 足場は動かない
{
 const page=await open('?spawn=0,0.9,7.2')
 await page.waitForTimeout(2500)
 const st=await page.evaluate(()=>({mode:window.__tramp.bounce.mode,y:window.__tramp.bounce.y}))
 expect('外にいる間は足場が休んでいる',st.mode==='rest'&&Math.abs(st.y)<1e-6,JSON.stringify(st))
 await page.close()
}
console.log('errors:',errors.filter(e=>!/Pointer ?Lock|pointer lock/i.test(e)).slice(0,8))
await browser.close()
process.exit(fail?1:0)
