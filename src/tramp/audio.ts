// 合成音（外部ファイルなし）。膜が跳ね返す「ぼよん」だけ。
// AudioContext はページ内で1つを共有し、失敗しても（非対応・自動再生制限）見た目や動きには影響させない。

type WindowWithWebkitAudio=Window&{webkitAudioContext?:typeof AudioContext}
let shared:AudioContext|null=null

function context(){
 if(shared)return shared
 try{
  const Ctor=window.AudioContext||(window as WindowWithWebkitAudio).webkitAudioContext
  shared=Ctor?new Ctor():null
 }catch{shared=null}
 return shared
}

/**
 * @param power 0〜1。沈みの深さに応じた強さ（深いほど低く長い）
 * @param distance 聞く人からの距離（m）
 */
export function playBoing(power:number,distance:number){
 const ctx=context()
 if(!ctx)return
 if(ctx.state==='suspended'){ctx.resume().catch(()=>{});if(ctx.state==='suspended')return}
 const gain=0.22*(0.35+0.65*power)/(1+(distance/5)**2)
 if(gain<0.004)return
 const t=ctx.currentTime
 const dur=0.28+0.3*power
 const osc=ctx.createOscillator(),amp=ctx.createGain()
 osc.type='sine'
 // 低いところから持ち上がって戻る
 const base=150-55*power
 osc.frequency.setValueAtTime(base*0.7,t)
 osc.frequency.exponentialRampToValueAtTime(base*1.9,t+dur*0.35)
 osc.frequency.exponentialRampToValueAtTime(base*1.2,t+dur)
 amp.gain.setValueAtTime(0.0001,t)
 amp.gain.exponentialRampToValueAtTime(gain,t+0.015)
 amp.gain.exponentialRampToValueAtTime(0.0001,t+dur)
 osc.connect(amp).connect(ctx.destination)
 osc.start(t)
 osc.stop(t+dur+0.02)
}
