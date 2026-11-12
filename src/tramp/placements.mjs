// 1人1個までを、アイテム自身で守る。
//
// XRift 本体には「1個しか置けない」設定がない（公式の docs・テンプレート・world-components のどこにも無く、
// アイテムの読み込みは Item だけを見る。index.tsx の config.singlePlace は効かない）。
// そこで、置かれたコピーがここへ登録し、同じ人（useItem().placedBy.id、サーバーが決める）が置いたものの中で
// 配置IDがいちばん小さい1個だけを本物として動かす。残りは何も出さない（見た目も当たり判定もなし）。
// どの人の画面にも同じコピーと同じ置いた人が見えるので、全員が同じ1個を選ぶ。
// 置く前のプレビューは数に入れない。すでに1個置いている人のプレビューは出さない（置いても出ないと分かるように）。
const KEY=Symbol.for('xrift.trampoline.placements.v1')

function registry(){
 return globalThis[KEY]??={entries:new Map(),listeners:new Set(),version:0}
}
function notify(r){r.version++;for(const l of [...r.listeners])l()}
const group=placer=>typeof placer==='string'&&placer?placer:''

/** このコピーを出してよいか */
export function isLive(id){
 const r=registry(),entry=r.entries.get(id)
 if(!entry)return true
 const g=group(entry.placer)
 const placed=[...r.entries].filter(([,e])=>!e.preview&&group(e.placer)===g).map(([other])=>other).sort()
 return entry.preview?placed.length===0:placed[0]===id
}

/**
 * @param {string} id 配置ID
 * @param {boolean} preview 置く前のプレビューか
 * @param {string|null} placer useItem().placedBy?.id
 */
export function registerPlacement(id,preview,placer=null){
 const r=registry(),token={preview:!!preview,placer}
 r.entries.set(id,token);notify(r)
 return ()=>{if(r.entries.get(id)===token){r.entries.delete(id);notify(r)}cleanup(r)}
}

export function subscribePlacements(listener){
 const r=registry();r.listeners.add(listener)
 return ()=>{r.listeners.delete(listener);cleanup(r)}
}
function cleanup(r){if(!r.entries.size&&!r.listeners.size&&globalThis[KEY]===r)delete globalThis[KEY]}
