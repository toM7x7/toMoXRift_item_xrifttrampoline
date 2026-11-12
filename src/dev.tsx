import {Canvas,useFrame} from '@react-three/fiber'
import {CapsuleCollider,Physics,RigidBody,useAfterPhysicsStep,type RapierRigidBody} from '@react-three/rapier'
import {DevEnvironment,ItemProvider,XRiftProvider,useUsers,type ItemPlacer,type PlayerMovement,type UsersContextValue} from '@xrift/world-components'
import {useMemo,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import type {Group} from 'three'
import {Item} from './Item'

// ?spawn=x,y,z  出る場所（既定はのぼり坂の手前）。膜の真上に出すと落ちてきてそのまま跳ね始める
// ?cam=px,py,pz,tx,ty,tz  カメラを固定して外から撮る（自分の位置に人形を出す）
// ?lab=<Hz>  本番に近い条件の再現用。物理を固定の刻み（例: 30, 60, 120。0 ならコマごと）にして、
//            入力のいらない体（落ちてくるだけ）で跳ねさせる。描画のコマと物理の刻みがずれた状態を作れる
// ?drive=frame  足場を描画のコマで進める旧方式（比べる用）
const params=new URLSearchParams(location.search)
const nums=(k:string)=>params.get(k)?.split(',').map(Number)
const lab=params.has('lab')
const spawn=(nums('spawn')??(lab?[0,2.6,0]:[0,0.9,7.2])) as [number,number,number]
const cam=nums('cam')
const ME:ItemPlacer={id:'user-me',displayName:'me',avatarUrl:null,isLocalUser:true}
const OTHER:ItemPlacer={id:'user-other',displayName:'other',avatarUrl:null,isLocalUser:false}
if(params.get('drive')==='frame')(globalThis as {__trampDrive?:string}).__trampDrive='frame'
// ?carry=1  物理上の体を探さず、足元の位置だけで動かす（体が見つからない場合の動きを確かめる）
if(params.has('carry'))(globalThis as {__trampNoExact?:boolean}).__trampNoExact=true

type Sample={t:number;y:number;grounded:boolean;mode:string;level:number;plat:number}
type StepSample={y:number;plat:number;mode:string;dt:number}
declare global{interface Window{__trampLog?:Sample[];__trampSteps?:StepSample[];__tramp?:{bounce:{mode:string;level:number;y:number;free:boolean;carryOnly:boolean;g:number;c:number}}}}

function CameraPin({pose}:{pose:number[]}){
 useFrame((s)=>{
  s.camera.position.set(pose[0],pose[1],pose[2])
  s.camera.lookAt(pose[3],pose[4],pose[5])
  s.camera.updateMatrixWorld()
  s.gl.render(s.scene,s.camera)
 },1)
 return null
}

function Doll(){
 return(
  <>
   <mesh position={[0,0.75,0]} castShadow><capsuleGeometry args={[0.2,0.9,6,14]}/><meshStandardMaterial color="#ffb347" roughness={0.6}/></mesh>
   <mesh position={[0,1.45,0]} castShadow><sphereGeometry args={[0.17,16,12]}/><meshStandardMaterial color="#ffd9a8" roughness={0.6}/></mesh>
  </>
 )
}

/** 自分の足元に人形を出し、高さの記録を取る */
function Probe({marker}:{marker:boolean}){
 const {getLocalMovement}=useUsers()
 const ref=useRef<Group>(null)
 const t=useRef(0)
 useFrame((_,dt)=>{
  const m=getLocalMovement()
  t.current+=dt
  ref.current?.position.set(m.position.x,m.position.y,m.position.z)
  const b=window.__tramp?.bounce
  const log=(window.__trampLog??=[])
  log.push({t:t.current,y:m.position.y,grounded:m.isGrounded,mode:b?.mode??'',level:b?.level??0,plat:b?.y??0})
  if(log.length>9000)log.shift()
 })
 if(!marker)return null
 return <group ref={ref}><Doll/></group>
}

function Scenery(){
 return(
  <>
   <color attach="background" args={['#a9c4dc']}/>
   <hemisphereLight args={['#eaf2ff','#6d6a5c',0.75]}/>
   <directionalLight position={[6,10,4]} intensity={1.8} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-bias={-0.0004}/>
   <RigidBody type="fixed" colliders="cuboid">
    <mesh position={[0,-0.1,0]} receiveShadow>
     <boxGeometry args={[60,0.2,60]}/>
     <meshStandardMaterial color="#6f8f5f" roughness={0.95}/>
    </mesh>
   </RigidBody>
  </>
 )
}

/** ラボ用の体。DevEnvironment の体と同じ作り（動的な剛体、毎コマ速度を入れ直す）で、入力はない */
const FEET=0.8
function LabBody({movement}:{movement:PlayerMovement}){
 const rb=useRef<RapierRigidBody>(null)
 useFrame(()=>{
  const b=rb.current
  if(!b)return
  const v=b.linvel()
  b.setLinvel({x:0,y:v.y,z:0},true)
  const p=b.translation()
  movement.position.x=p.x;movement.position.y=p.y-FEET;movement.position.z=p.z
  movement.verticalSpeed=v.y
 })
 // 物理の1刻みごとの記録（描画のコマに左右されない、体そのものの動き）
 useAfterPhysicsStep((world)=>{
  const b=rb.current
  if(!b)return
  const s=(window.__trampSteps??=[])
  const st=window.__tramp?.bounce
  s.push({y:b.translation().y-FEET,plat:st?.y??0,mode:st?.mode??'',dt:world.timestep})
  if(s.length>20000)s.shift()
 })
 return(
  <RigidBody ref={rb} type="dynamic" position={[spawn[0],spawn[1]+FEET,spawn[2]]} lockRotations friction={0} restitution={0} linearDamping={0.2}>
   <CapsuleCollider args={[0.4,0.4]}/>
   <group position={[0,-FEET,0]}><Doll/></group>
  </RigidBody>
 )
}

function Lab(){
 const hz=Number(params.get('lab'))
 const movement=useMemo<PlayerMovement>(()=>({position:{x:spawn[0],y:spawn[1],z:spawn[2]},direction:{x:0,z:0},horizontalSpeed:0,verticalSpeed:0,rotation:{yaw:0,pitch:0},isGrounded:false,isJumping:false}),[])
 const users=useMemo<UsersContextValue>(()=>({localUser:null,remoteUsers:[],getMovement:()=>undefined,getLocalMovement:()=>movement}),[movement])
 const pose=cam&&cam.length===6?cam:[7.5,4.2,8.5,0,3,0]
 return(
  <XRiftProvider baseUrl="/" usersImplementation={users}>
   <div style={{width:'100vw',height:'100vh'}}>
    <Canvas shadows camera={{fov:60,near:0.05,far:300}}>
     <Physics timeStep={hz>0?1/hz:'vary'} gravity={[0,-9.81,0]}>
      <CameraPin pose={pose}/>
      <Probe marker={false}/>
      <Scenery/>
      <LabBody movement={movement}/>
      <ItemProvider id="tramp-lab"><Item/></ItemProvider>
     </Physics>
    </Canvas>
   </div>
  </XRiftProvider>
 )
}

function App(){
 if(lab)return <Lab/>
 return(
  <XRiftProvider baseUrl="/">
   <div style={{width:'100vw',height:'100vh'}}>
    <DevEnvironment spawnPosition={spawn} camera={{position:spawn,fov:70}} physicsConfig={{allowInfiniteJump:false}}>
     {cam&&cam.length===6&&<CameraPin pose={cam}/>}
     <Probe marker={!!cam}/>
     <Scenery/>
     <ItemProvider id="tramp-dev" placedBy={ME}><Item/></ItemProvider>
     {/* ?copies=1: 自分がもう2個、他の人が1個置いた状態。自分の2個目以降は出ず、他の人の1個は出る */}
     {params.has('copies')&&<>
      <ItemProvider id="tramp-dev-b" placedBy={ME}><Item position={[9,0,0]}/></ItemProvider>
      <ItemProvider id="tramp-dev-c" placedBy={ME}><Item position={[-9,0,0]}/></ItemProvider>
      <ItemProvider id="tramp-other" placedBy={OTHER}><Item position={[0,0,-9]}/></ItemProvider>
     </>}
    </DevEnvironment>
   </div>
  </XRiftProvider>
 )
}

const host=window as unknown as {__trampRoot?:ReturnType<typeof createRoot>}
host.__trampRoot??=createRoot(document.getElementById('root')!)
host.__trampRoot.render(<App/>)
