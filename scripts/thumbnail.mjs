// サムネイル（512x512）を dev サーバー 5313 から撮る
import {chromium} from 'playwright'
import {join} from 'node:path'
const exe=join(process.env.LOCALAPPDATA??'','ms-playwright','chromium-1243','chrome-win64','chrome.exe')
const browser=await chromium.launch({executablePath:exe,args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']})
const page=await browser.newPage({viewport:{width:512,height:512}})
await page.goto('http://127.0.0.1:5313/?spawn=0.9,2.6,0.4&cam=5.6,4.4,7.4,0.2,1.3,0.6')
await page.waitForFunction(()=>window.__tramp?.membrane.ready(),null,{timeout:60000})
await page.evaluate(()=>{for(const el of document.querySelectorAll('body div')){if(el.querySelector('canvas'))continue;el.style.display='none'}})
// 3段目で沈んだ瞬間
await page.waitForFunction(()=>{const b=window.__tramp.bounce;return b.level>=5&&b.mode==='press'&&b.y<-0.5},null,{timeout:30000,polling:'raf'})
await page.screenshot({path:join(import.meta.dirname,'..','public','thumbnail.png')})
await browser.close()
