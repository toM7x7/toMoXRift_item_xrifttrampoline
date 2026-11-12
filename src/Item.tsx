import {useFrame} from '@react-three/fiber'
import {CylinderCollider,RigidBody,useBeforePhysicsStep,type RapierRigidBody} from '@react-three/rapier'
import {useItem,usePlacementState,useUsers,useXRift} from '@xrift/world-components'
import {useEffect,useLayoutEffect,useMemo,useRef,useSyncExternalStore} from 'react'
import {DoubleSide,LatheGeometry,Matrix4,Vector2,Vector3,type Group} from 'three'
import {playBoing} from './tramp/audio'
import {TRAMP,clearExact,createBounce,observe,setExact,stepBounce} from './tramp/bounce.mjs'
import {MAX_DENTS,MAX_RINGS,VAT_FILE,VAT_META,createMembrane} from './tramp/membrane'
import {isLive,registerPlacement,subscribePlacements} from './tramp/placements.mjs'

export type ItemProps={position?:[number,number,number];rotation?:[number,number,number];scale?:number}

const {R,H}=TRAMP
/** 見えない足場の厚みの半分 */
const HALF=0.05
const PAD_W=0.42
const RIM=R+PAD_W
const PAD_TOP=H+0.075
const PANELS=16
const LEGS=8
/** のぼり坂（踏み板）。ジャンプしなくても歩いて上がれる */
const RAMP_RUN=2.4
const RAMP_ANGLE=Math.atan2(PAD_TOP,RAMP_RUN)
const RAMP_LEN=Math.hypot(PAD_TOP,RAMP_RUN)
const STEEL={color:'#aeb6c2',roughness:0.35,metalness:0.85}

type Track={peak:number;x:number;z:number}
type DevGlobal={__tramp?:unknown;__trampDrive?:string;__trampNoExact?:boolean}
type StepWorld=Parameters<Parameters<typeof useBeforePhysicsStep>[0]>[0]

/** まわりのクッション1枚ぶん（断面を回して作る。16枚を回して並べる） */
function padGeometry(){
 const pts=[[R-0.01,H-0.03],[R-0.01,H+0.05],[R+0.03,PAD_TOP],[RIM,PAD_TOP],[RIM+0.04,H+0.04],[RIM+0.04,H-0.03],[R-0.01,H-0.03]].map(([x,y])=>new Vector2(x,y))
 const span=(Math.PI*2)/PANELS
 return new LatheGeometry(pts,5,0.006,span-0.012)
}

/**
 * 1人1個まで。同じ人が2個目以降を置いても、そのコピーは何も出さない（placements.mjs）。
 * 本体に「1個だけ」の設定がないので、アイテム側で守る。
 */
export function Item(props:ItemProps){
 const {id,placedBy}=useItem()
 const preview=usePlacementState().mode==='preview'
 const placer=placedBy?.id??null
 useLayoutEffect(()=>registerPlacement(id,preview,placer),[id,preview,placer])
 const live=useSyncExternalStore(subscribePlacements,()=>isLive(id),()=>true)
 useEffect(()=>{
  if(!import.meta.env.DEV)return
  const g=globalThis as {__trampLive?:Record<string,boolean>}
  ;(g.__trampLive??={})[id]=live
  return ()=>{delete g.__trampLive?.[id]}
 },[id,live])
 return live?<Trampoline {...props}/>:null
}

function Trampoline({position=[0,0,0],rotation=[0,0,0],scale=1}:ItemProps){
 const {baseUrl}=useXRift()
 const users=useUsers()
 const usersRef=useRef(users)
 usersRef.current=users
 const group=useRef<Group>(null)
 const body=useRef<RapierRigidBody>(null)
 const membrane=useMemo(()=>createMembrane(),[])
 const pad=useMemo(()=>padGeometry(),[])
 const bounce=useMemo(()=>createBounce(),[])
 const work=useMemo(()=>({
  inv:new Matrix4(),mat:new Matrix4(),hasMat:false,feet:new Vector3(),world:new Vector3(),center:new Vector3(),
  tracks:new Map<string,Track>(),ringNext:0,
  /** 直近の描画コマの長さ・物理の刻みが一定かどうかの見張り */
  frameDt:1/60,lastStep:-1,sameSteps:0,
  /** 物理エンジン上の自分の体（見つかれば正確な高さと速度が読める） */
  mine:null as RapierRigidBody|null,mineOff:0.8,mineWait:0,probe:new Vector3(),
 }),[])

 useEffect(()=>{membrane.load(`${baseUrl}${VAT_FILE}`)},[membrane,baseUrl])
 useEffect(()=>()=>{membrane.dispose();pad.dispose()},[membrane,pad])
 useEffect(()=>{
  if(!import.meta.env.DEV)return
  ;(globalThis as DevGlobal).__tramp={bounce,membrane}
 },[bounce,membrane])

 /** 足場を dt だけ進めて、物理へ次の位置を渡す */
 const advance=(dt:number)=>{
  const y=stepBounce(bounce,dt)
  if(!body.current||!work.hasMat)return
  work.world.set(0,H+y-HALF,0).applyMatrix4(work.mat)
  body.current.setNextKinematicTranslation(work.world)
 }

 /**
  * 物理エンジン上の自分の体を探して、正確な高さと速度を足場の計算へ渡す。
  * 公式の API が返す足元の位置は描画のコマごとの値で、速く落ちているときは 1 コマで 20cm 以上ずれる。
  * 体は「動的な剛体で、足元の位置の真上にあるもの」で見分ける。見つからなければ足元の位置だけで動かす。
  */
 const readExact=(world:StepWorld)=>{
  const f=bounce.feet
  if(!f.has||!work.hasMat||(import.meta.env.DEV&&(globalThis as DevGlobal).__trampNoExact)){work.mine=null;clearExact(bounce);return}
  const local=(b:RapierRigidBody)=>{
   const p=b.translation()
   work.probe.set(p.x,p.y,p.z).applyMatrix4(work.inv)
   work.probe.y-=H
   return work.probe
  }
  try{
   if(work.mine&&!work.mine.isValid())work.mine=null
   // 探すのは足元が落ち着いているときだけ（速く動いていると足元の位置が古く、体との高さの差を測り損なう）
   if(!work.mine&&--work.mineWait<=0&&Math.abs(bounce.obsVy)<0.5){
    work.mineWait=20
    let best:RapierRigidBody|null=null,bestD=0.09,off=0
    world.bodies.forEach((b)=>{
     if(!b.isDynamic())return
     const p=local(b as RapierRigidBody)
     const d=(p.x-f.x)**2+(p.z-f.z)**2,dy=p.y-f.y
     if(d<bestD&&dy>0.2&&dy<1.6){best=b as RapierRigidBody;bestD=d;off=dy}
    })
    work.mine=best
    work.mineOff=off
   }
   const b=work.mine
   if(!b){clearExact(bounce);return}
   const p=local(b)
   const fy=p.y-work.mineOff
   // 別の体をつかんでいないか（足元の位置と大きくずれたら手放す）
   if(Math.hypot(p.x-f.x,p.z-f.z)>1.5||Math.abs(fy-f.y)>3){work.mine=null;clearExact(bounce);return}
   setExact(bounce,fy,b.linvel().y)
  }catch{
   work.mine=null
   clearExact(bounce)
  }
 }

 // 足場は物理の1刻みごとに進める。描画のコマで進めると、刻みとコマがずれたとき
 //（1コマに刻みが0回や2回）に足場の速度が 0 や2倍になり、乗っている体ががくがくする。
 useBeforePhysicsStep((world)=>{
  if(import.meta.env.DEV&&(globalThis as DevGlobal).__trampDrive==='frame')return
  // 刻みが一定（固定）ならその長さ、コマごとに変わる設定なら直近のコマの長さで進める。
  // world.timestep はこの時点では前の刻みの値なので、同じ値が続いているかで見分ける
  const ts=world.timestep
  work.sameSteps=ts===work.lastStep?work.sameSteps+1:0
  work.lastStep=ts
  readExact(world)
  advance(work.sameSteps>=8?ts:work.frameDt)
 })

 useFrame((state,delta)=>{
  const g=group.current
  if(!g)return
  const dt=Math.min(Math.max(delta,0),0.1)
  work.frameDt=dt
  g.updateWorldMatrix(true,false)
  work.mat.copy(g.matrixWorld)
  work.hasMat=true
  work.inv.copy(g.matrixWorld).invert()
  const u=usersRef.current
  const toLocal=(p:{x:number;y:number;z:number})=>{
   work.feet.set(p.x,p.y,p.z).applyMatrix4(work.inv)
   work.feet.y-=H
   return work.feet
  }

  // 自分: 足元の位置を足場の計算へ渡す（足場は各自の画面で自分の体だけを運ぶ）
  observe(bounce,toLocal(u.getLocalMovement().position),dt)
  if(import.meta.env.DEV&&(globalThis as DevGlobal).__trampDrive==='frame')advance(dt)

  // 見た目: 膜の上にいる全員の足元をくぼませ、足が離れたら VAT の揺れ戻しを流す。
  // 位置だけで決まるので、部屋での同期は要らない
  let n=0
  const seen=(id:string,p:{x:number;y:number;z:number})=>{
   const f=toLocal(p)
   const r=Math.hypot(f.x,f.z)
   const depth=r<R&&f.y<0.02&&f.y>-1.2?Math.min(TRAMP.maxDepth+0.1,-f.y+0.01):0
   let t=work.tracks.get(id)
   if(!t){t={peak:0,x:0,z:0};work.tracks.set(id,t)}
   if(depth>0.02){
    if(depth>=t.peak){t.peak=depth;t.x=f.x;t.z=f.z}
    if(n<MAX_DENTS)membrane.dents[n++].set(f.x,f.z,depth,0)
   }else{
    if(t.peak>0.12){
     const ring=membrane.rings[work.ringNext]
     work.ringNext=(work.ringNext+1)%MAX_RINGS
     const q=Math.hypot(t.x,t.z)/R
     ring.set(Math.atan2(t.z,t.x),Math.min(VAT_META.K-1,q/VAT_META.QSTEP),0.3*t.peak,0)
     work.center.set(0,H,0).applyMatrix4(work.mat)
     playBoing(Math.min(1,t.peak/TRAMP.maxDepth),state.camera.position.distanceTo(work.center))
    }
    t.peak=0
   }
  }
  seen('local',u.getLocalMovement().position)
  for(const user of u.remoteUsers){
   const m=u.getMovement(user.id)
   if(m)seen(user.id,m.position)
  }
  for(let i=n;i<MAX_DENTS;i++)membrane.dents[i].set(0,0,0,0)
  for(const ring of membrane.rings)ring.w+=dt
 })

 return(
  <group ref={group} position={position} rotation={rotation} scale={scale}>
   {/* ふちのクッションとのぼり坂（動かない当たり判定） */}
   <RigidBody type="fixed" colliders="trimesh">
    {Array.from({length:PANELS},(_,k)=>(
     <mesh key={k} geometry={pad} rotation={[0,(k/PANELS)*Math.PI*2,0]} castShadow>
      <meshStandardMaterial color={k%2?'#1f6fd6':'#f2c230'} roughness={0.55} side={DoubleSide}/>
     </mesh>
    ))}
    <mesh position={[0,PAD_TOP/2-0.04,RIM+0.02+RAMP_RUN/2]} rotation={[RAMP_ANGLE,0,0]} castShadow receiveShadow>
     <boxGeometry args={[1.3,0.07,RAMP_LEN]}/>
     <meshStandardMaterial color="#2b3038" roughness={0.85}/>
    </mesh>
   </RigidBody>

   {/* 見えない足場。跳ねる軌道で上下して、乗っている人を運ぶ */}
   <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0,H-HALF,0]}>
    <CylinderCollider args={[HALF,R]} friction={0} restitution={0}/>
   </RigidBody>

   {/* 膜 */}
   <mesh geometry={membrane.geometry} material={membrane.material} position={[0,H,0]} receiveShadow/>

   {/* のぼり坂の滑り止め */}
   <group position={[0,PAD_TOP/2-0.04,RIM+0.02+RAMP_RUN/2]} rotation={[RAMP_ANGLE,0,0]}>
    {Array.from({length:7},(_,k)=>(
     <mesh key={k} position={[0,0.045,(k-3)*0.34]}>
      <boxGeometry args={[1.2,0.02,0.05]}/>
      <meshStandardMaterial color="#f2c230" roughness={0.7}/>
     </mesh>
    ))}
   </group>

   {/* 枠と脚 */}
   {[RIM-0.02,R+0.06].map((r,i)=>(
    <mesh key={i} position={[0,H-0.06,0]} rotation={[Math.PI/2,0,0]} castShadow>
     <torusGeometry args={[r,i?0.018:0.035,10,96]}/>
     <meshStandardMaterial {...STEEL}/>
    </mesh>
   ))}
   {Array.from({length:LEGS},(_,k)=>{
    const a=(k/LEGS)*Math.PI*2+Math.PI/LEGS
    return(
     <group key={k} rotation={[0,-a,0]}>
      {[-0.45,0.45].map((z)=>(
       <mesh key={z} position={[RIM-0.02,(H-0.06)/2,z]} castShadow>
        <cylinderGeometry args={[0.035,0.035,H-0.06,10]}/>
        <meshStandardMaterial {...STEEL}/>
       </mesh>
      ))}
      <mesh position={[RIM-0.02,0.035,0]} rotation={[Math.PI/2,0,0]} castShadow>
       <cylinderGeometry args={[0.035,0.035,1.3,10]}/>
       <meshStandardMaterial {...STEEL}/>
      </mesh>
     </group>
    )
   })}
  </group>
 )
}
