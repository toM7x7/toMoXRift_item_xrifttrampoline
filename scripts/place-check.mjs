// 1人1個までの確認。dev サーバー 5313 を先に起動。
// ?copies=1 は「自分が3個、他の人が1個」置いた状態。自分の分は配置IDがいちばん小さい1個だけ出て、他の人の1個も出る。
import {chromium} from 'playwright'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
const exe=join(process.env.LOCALAPPDATA??'','ms-playwright','chromium-1243','chrome-win64','chrome.exe')
const OUT=join(import.meta.dirname,'..','docs','shots')
mkdirSync(OUT,{recursive:true})
const browser=await chromium.launch({executablePath:exe,args:['--use-angle=d3d11','--ignore-gpu-blocklist','--enable-gpu']})
let fail=0
const expect=(name,ok,info)=>{console.log(ok?'PASS':'FAIL',name,info??'');if(!ok)fail++}
const page=await browser.newPage({viewport:{width:1280,height:720}})
const errors=[]
page.on('pageerror',e=>errors.push(String(e)))
await page.goto('http://127.0.0.1:5313/?copies=1&spawn=0,2.6,0&cam=0,22,24,0,0,-1')
await page.waitForFunction(()=>window.__tramp&&Object.keys(window.__trampLive??{}).length>=4,null,{timeout:60000})
await page.waitForTimeout(6000)
const live=await page.evaluate(()=>window.__trampLive)
expect('自分の1個目（tramp-dev）は出る',live['tramp-dev']===true)
expect('自分の2個目・3個目は出ない',live['tramp-dev-b']===false&&live['tramp-dev-c']===false,JSON.stringify(live))
expect('他の人が置いた1個は出る',live['tramp-other']===true)
const log=await page.evaluate(()=>window.__trampLog)
expect('残った1個でふつうに跳ねる',Math.max(...log.slice(-200).map(s=>s.y))>2.5)
await page.screenshot({path:join(OUT,'copies.png')})
console.log('errors:',errors.slice(0,5))
await browser.close()
process.exit(fail?1:0)
