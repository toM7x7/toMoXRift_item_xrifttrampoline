// 見えない足場の動き。three にも React にも依存しない（Node でそのまま検証できる）。
//
// 座標はトランポリンのローカル。膜の休み位置が y=0、中心が x=z=0。
// 足場は「押し込み → 打ち上げ → 放物線で上がって降りる」をくり返し、乗っている人をその軌道で運ぶ。
// 放物線の加速度は本物の重力より少し弱くしてある。そうすると上りも下りも足場が体を下から支え続けるので、
// 本体のジャンプの仕組みがどうなっていても（速度が引き継がれても引き継がれなくても）同じ高さになる。
//
// 体の正確な状態（物理エンジン上の高さと速度）が分かるときは、もっと素直な方式を使う（free）:
//   飛行中は足場を休ませて体を自由に飛ばし、降りてくる体に足場の位置と速度を合わせて受け止める。
//   飛んでいる間は本体のふつうのジャンプと同じ動きになる。重力と空気抵抗は飛行中の体から測って、
//   狙った高さになる打ち上げの速さを決める。
// 体が速度を引き継がない（打ち上げても付いてこない）と分かったら、上の「運ぶ」方式に切り替える。
//
// 呼び方:
//   setExact / clearExact … 物理の1刻みごと、stepBounce の前。体の正確な高さと速度
//   observe … 描画のコマごと。自分の足元の位置を渡す（落下の速さもここで測る）
//   stepBounce … 物理の1刻みごと。足場を dt だけ進める
// 足場を描画のコマで進めると、物理の刻みとずれたとき（1コマに0回や2回の刻み）に足場の速度が
// 0 になったり2倍になったりして、乗っている体ががくがくする。

export const TRAMP={
 /** 膜の半径 */
 R:3.0,
 /** 地面から膜までの高さ */
 H:1.0,
 /** 足場の放物線の加速度（本物の重力 9.81 の 0.92 倍） */
 A:9.81*0.92,
 /** 段ごとの高さ（膜から足元まで、中心に降りたとき） */
 heights:[1.0,1.8,2.8,4.0,5.5,7.5,9.5,12,15],
 /** 範囲。to=外側の半径、cap=その範囲で上がれる段の上限 */
 zones:[{to:1.0,cap:9},{to:2.2,cap:6},{to:3.0,cap:3}],
 /** 立っているだけで沈む量 */
 sag:0.06,
 /** これより速く降りてきたら跳ね始める */
 landSpeed:1.6,
 /** 足場を離れてからこの秒数のうちに降りれば段が続く */
 chainWindow:1.2,
 /** いちばん深い沈み */
 maxDepth:0.9,
}

export function zoneOf(r){
 const z=TRAMP.zones
 for(let i=0;i<z.length;i++)if(r<z[i].to)return i
 return z.length-1
}
/** 中心からの距離で決まる高さの割合（中心 1、ふちで 0.7） */
export function powerAt(r){const q=Math.min(1,r/TRAMP.R);return 1-0.3*q*q}
/** 中心からの距離で決まる沈みの割合（ふちの近くは浅い） */
export function depthAt(r){return Math.min(1,Math.max(0.35,(TRAMP.R-r)/1.0))}

export function createBounce(){
 return{
  mode:'rest',level:0,
  /** 足場の高さ（膜の休み位置から） */
  y:0,
  t:0,D:0,w1:0,w2:0,t1:0,v:0,
  /** 直近の落下の速さ（負）。着地した瞬間は速度がもう 0 になっていることがあるので、少し前の値を残す */
  fall:0,
  /** observe で受け取った足元（膜の外・不明のときは has=false） */
  feet:{x:0,y:0,z:0,has:false},
  prevY:null,clock:0,lastEnd:-99,away:0,
  /** 体の正確な状態（物理エンジンから）。has=false なら observe の値だけで動かす */
  exact:{has:false,y:0,vy:0},
  /** この跳ねは free（体を自由に飛ばす）か */
  free:false,
  /** 体が速度を引き継がないと分かった → 以後は運ぶ方式だけ */
  carryOnly:false,
  /** 飛行中の体から測った重力と空気抵抗（速度に比例する減速の係数） */
  g:9.81,c:0.2,pvy:null,
  followSteps:0,chainUntil:-99,obsVy:0,dtNom:1/60,
  /** 運ぶ方式で飛んでいるときの足場の速度 */
  fv:0,
  /** 直近の着地（表示・検証用） */
  lastZone:0,lastPower:1,
 }
}

export function setExact(s,y,vy){s.exact.has=true;s.exact.y=y;s.exact.vy=vy}
export function clearExact(s){s.exact.has=false;s.pvy=null}

/** 重力 g・空気抵抗 c のもとで、速さ v で打ち上げた体が届く高さ */
function reach(v,g,c){return c<1e-3?v*v/(2*g):v/c-(g/(c*c))*Math.log(1+c*v/g)}
/** 高さ h に届く打ち上げの速さ */
function speedFor(h,g,c){
 let lo=0,hi=90
 for(let i=0;i<40;i++){const m=(lo+hi)/2;if(reach(m,g,c)<h)lo=m;else hi=m}
 return(lo+hi)/2
}

/** 描画のコマごとに自分の足元（ローカル座標）を渡す。分からないときは null */
export function observe(s,feet,dt){
 if(!feet){s.feet.has=false;s.prevY=null;return}
 if(s.prevY!==null&&dt>1e-5){
  const vy=(feet.y-s.prevY)/dt
  s.obsVy=vy
  s.fall=Math.min(vy,s.fall*Math.exp(-dt/0.08))
 }else s.obsVy=0
 s.prevY=feet.y
 s.feet.x=feet.x;s.feet.y=feet.y;s.feet.z=feet.z;s.feet.has=true
}

function startPress(s,u,r,chained){
 const zone=zoneOf(r),cap=TRAMP.zones[zone].cap
 if(chained)s.level=s.level<cap?s.level+1:s.level>cap?s.level-1:s.level
 else s.level=1
 const power=powerAt(r)
 s.lastZone=zone
 s.lastPower=power
 const h=TRAMP.heights[s.level-1]*power
 s.free=s.exact.has&&!s.carryOnly
 if(s.free){
  // 打ち上げのあと足場が同じ速さで少し押し続けるので、その分の高さ（実測で約1刻みぶん）を引いて速さを決める
  const v0=speedFor(h,s.g,s.c)
  s.v=speedFor(Math.max(0.3*h,h-s.dtNom*v0),s.g,s.c)
 }else s.v=Math.sqrt(2*TRAMP.A*h)
 s.D=Math.min(TRAMP.maxDepth,0.3+0.075*s.level)*depthAt(r)
 // 沈み始めの速さは降りてきた速さに合わせる（合わないと着地でがくっとする）
 const uu=Math.min(24,Math.max(2.5,u))
 s.w1=uu/s.D
 s.t1=Math.PI/(2*s.w1)
 s.w2=s.v/s.D
 s.mode='press'
 s.t=0
 s.fall=0
 s.away=0
}

function toRest(s,keepChain){
 s.mode='rest'
 s.y=0
 s.away=0
 if(keepChain)s.lastEnd=s.clock
 else{s.lastEnd=-99;s.level=0}
}

/**
 * 物理の1刻みぶん進める。
 * @returns 足場の高さ（膜の休み位置から）
 */
export function stepBounce(s,dt){
 dt=Math.min(Math.max(dt,0),0.1)
 s.clock+=dt
 if(dt>1e-4)s.dtNom=dt
 const f=s.feet,e=s.exact
 const r=f.has?Math.hypot(f.x,f.z):99
 // 高さは正確な値があればそれを使う（observe の値は1コマ古いことがある）
 const fy=e.has?e.y:f.y
 const inside=f.has&&r<TRAMP.R-0.1&&fy>-1.2&&fy<40

 // 自由に飛んでいる体から重力と空気抵抗を測る（足場が休んでいて、体が膜より上にいる間）
 if(e.has){
  if(s.pvy!==null&&dt>1e-4&&s.mode==='rest'&&e.y>0.4){
   const a=(e.vy-s.pvy)/dt
   if(a<-1&&a>-60){
    if(Math.abs(e.vy)<1.5)s.g+=(Math.min(30,Math.max(2,-a))-s.g)*0.1
    else if(e.vy>4)s.c+=(Math.min(1,Math.max(0,(-a-s.g)/e.vy))-s.c)*0.05
   }
  }
  s.pvy=e.vy
 }

 if(s.mode==='rest'){
  const q=Math.min(1,r/TRAMP.R)
  const target=inside&&fy<0.25?-TRAMP.sag*(1-q*q):0
  const step=0.6*dt
  s.y+=Math.max(-step,Math.min(step,target-s.y))
  if(e.has&&!s.carryOnly){
   // 降りてくる体がこの刻みで膜に届くなら、足場を体のすぐ下・同じ速さに合わせて沈み始める
   const y1=e.y+e.vy*dt
   if(inside&&e.vy<-TRAMP.landSpeed&&y1<=s.y+0.01&&e.y>s.y-0.3){
    startPress(s,-e.vy,r,s.clock<s.chainUntil)
    const ph=Math.asin(Math.min(0.95,Math.max(0,(0.01-y1)/s.D)))
    s.t=ph/s.w1
    s.y=-s.D*Math.sin(ph)
   }
  }else if(inside&&fy<=s.y+0.1&&s.fall<-TRAMP.landSpeed){
   startPress(s,-s.fall,r,s.clock-s.lastEnd<TRAMP.chainWindow)
  }
  return s.y
 }

 // 押し込み・飛行中に膜の外へ出たら、足場をすぐ戻す（外へ歩いて降りられる）
 s.away=inside?0:s.away+dt
 if(s.away>0.15){toRest(s,false);return s.y}

 s.t+=dt
 if(s.mode==='press'){
  if(s.t<s.t1){s.y=-s.D*Math.sin(s.w1*s.t);return s.y}
  const tau=s.t-s.t1
  const end=Math.PI/(2*s.w2)
  if(tau<end){s.y=-s.D*Math.cos(s.w2*tau);return s.y}
  s.mode=s.free?'follow':'flight'
  s.t=tau-end
  s.followSteps=0
  if(!s.free){
   // 運ぶ方式の飛び始め。行きすぎた時間の分だけ先に進めておく
   s.fv=s.v-TRAMP.A*s.t
   s.y=s.v*s.t-0.5*TRAMP.A*s.t*s.t
   return s.y
  }
 }
 if(s.mode==='follow'){
  // 打ち上げた直後。足場を同じ速さで2刻みだけ押し上げてから休ませる（体は自分で飛んでいく）
  if(++s.followSteps<=2){s.y=s.v*s.t;return s.y}
  if(e.has&&e.vy<0.5*s.v){
   // 体が付いてこない＝速度を引き継がない体。運ぶ方式に切り替えて、この跳ねもそのまま運ぶ
   s.carryOnly=true
   s.free=false
   s.v=Math.sqrt(2*TRAMP.A*TRAMP.heights[s.level-1]*s.lastPower)
   s.mode='flight'
   s.fv=s.v
   s.y=0
   return s.y
  }
  s.mode='rest'
  s.y=0
  s.away=0
  // 飛んで戻ってくるまでの時間＋余裕のうちに降りれば段が続く
  s.chainUntil=s.clock+2.2*s.v/s.g+TRAMP.chainWindow
  return s.y
 }
 // flight（運ぶ方式）。上りは重力より少し弱く減速して、体を下から押し続ける。
 // 下りは空気抵抗のぶん体の落ち方が遅くなるので、足場はそれよりさらに遅く落とす
 //（速く落とすと体が置いていかれ、あとから止まった足場に激突する）
 const fv0=s.fv
 s.fv-=(fv0>0?TRAMP.A:0.92*Math.max(0,9.81-0.3*-fv0))*dt
 s.y+=0.5*(fv0+s.fv)*dt
 const vy=s.fv
 if(s.y<=0&&vy<0){
  // 足元の位置は1コマ古いことがあるので、落ちる速さのぶん広めに見る
  const riding=inside&&fy-s.y<0.6-vy*0.05
  if(riding){
   // 行きすぎた分の時間を次の押し込みに繰り越す（つなぎ目で速度が跳ばないように）
   const over=Math.min(dt,s.y/vy)
   startPress(s,-vy,r,true)
   s.t=over
   s.y=-s.D*Math.sin(s.w1*s.t)
  }else toRest(s,true)
 }
 return s.y
}
