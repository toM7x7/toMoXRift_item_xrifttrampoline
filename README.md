# トランポリン（XRift アイテム）

跳ねるたびに高く上がるトランポリンです。直径 6m、最高 15m。真ん中ほど高く跳べます。

## 仕組み

- **跳ねる動き**: 膜と同じ大きさの見えない足場が、降りてくる体に位置と速度を合わせて受け止め、沈んでから打ち上げます。飛んでいる間は足場を休ませ、体は本体のふつうのジャンプと同じ動きで飛びます。
- **高さ**: 続けて跳ねると 1.0 → 1.8 → 2.8 → 4.0 → 5.5 → 7.5 → 9.5 → 12 → 15m と上がります。
- **範囲**: どこでも跳ねます。上がれる上限は、中心（1.0m まで）が 15m、中間（2.2m まで）が約 7m、ふちが約 2m です。
- **膜の見た目**: 足元のくぼみは膜の上にいる人の足の位置から計算します。足が離れたあとの揺れ戻しは、波のシミュレーションを焼いた VAT（`public/tramp_vat.bin`）で流します。部屋での同期は使いません。

計算の中身は `src/tramp/bounce.mjs`（three にも React にも依存しません）にあります。

## 開発

```bash
npm ci
npm run dev        # http://127.0.0.1:5313
```

- `?spawn=x,y,z` 出る場所、`?cam=px,py,pz,tx,ty,tz` 固定カメラ
- `?lab=<Hz>` 物理を固定の刻みにして、描画のコマとずらして試すラボ（`&carry=1` で足場が体を運ぶ予備の方式）

## 検査

```bash
npm run check:logic            # 足場の計算だけ（Node）
node scripts/smooth-check.mjs  # ラボの実物理で高さとがたつき（dev サーバーが要ります）
node scripts/bounce-check.mjs  # 開発用プレイヤーで跳ねるか（dev サーバーが要ります）
npm run bake                   # VAT を焼き直す
```

## ビルドとアップロード

```bash
npm run build
npx @xrift/cli@latest check item
npx @xrift/cli@latest upload item
```
