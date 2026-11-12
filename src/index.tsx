export {Item,Item as default} from './Item'
export type {ItemProps} from './Item'

// singlePlace は本体が読まない（公式の docs・テンプレート・world-components に無い）。
// 1人1個までは Item 側で守っている（src/tramp/placements.mjs）。ここは意図を残すための値
export const config={defaultScale:1,alignToSurface:false,singlePlace:true}
