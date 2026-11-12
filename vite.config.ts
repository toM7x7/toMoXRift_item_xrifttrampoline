import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

// Shared modules always come from the host (same setup as items/head-pop).
const shared=['react','react-dom','react/jsx-runtime','three','@react-three/fiber','@react-three/drei','@react-three/rapier','@xrift/world-components']

export default defineConfig(({mode})=>({
 base:'./',
 plugins:[
  react(),
  federation({name:'xrift_trampoline',filename:'remoteEntry.js',exposes:{'./Item':'./src/index.tsx'},shared:Object.fromEntries(shared.map(name=>[name,{requiredVersion:'*',...(mode==='item'?{import:false,generate:false}:{})}]))}),
 ],
 build:{target:'esnext',minify:false,assetsDir:'',...(mode==='item'?{rollupOptions:{input:'./src/item-entry.ts'}}:{})},
 define:{global:'globalThis'},
}))
