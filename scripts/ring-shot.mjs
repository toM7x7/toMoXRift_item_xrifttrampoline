// VAT の揺れ戻しだけを流して撮る（振幅を大きくして形を見る）。dev サーバー 5313
import {chromium} from 'playwright'
import {join} from 'node:path'
const exe=join(process.env.LOCALAPPDATA??'','ms-playwright','chromium-1243','chrome-win64','chrome.exe')
const OUT=join(import.meta.dirname,'..','docs','shots')
const browser=await chromium.launch({executablePath:exe,args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']})
const page=await browser.newPage({viewport:{width:1280,height:720}})
await page.goto('http://127.0.0.1:5313/?spawn=0,0.9,6&cam=2.4,1.5,2.7,0,0.6,0')
await page.waitForFunction(()=>window.__tramp?.membrane.ready(),null,{timeout:60000})
await page.waitForTimeout(1500)
for(const [name,clip,age] of [['c0-a',0,0.07],['c0-b',0,0.23],['c3-a',3,0.07],['c3-b',3,0.2]]){
 // 毎コマ同じ経過時間に戻して止める
 await page.evaluate(([clip,age])=>{
  cancelAnimationFrame(window.__ringHold)
  const hold=()=>{window.__tramp.membrane.rings[0].set(0.6,clip,0.5,age);window.__ringHold=requestAnimationFrame(hold)}
  hold()
 },[clip,age])
 await page.waitForTimeout(300)
 await page.screenshot({path:join(OUT,`ring-${name}.png`),clip:{x:240,y:120,width:800,height:450}})
}
await browser.close()
