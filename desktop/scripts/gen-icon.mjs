/**
 * stardeck 桌面图标生成器（纯 node，零依赖）：512×512 PNG——深蓝夜空圆角方 +
 * 金色五角星（甲板罗经星）+ 下弦甲板弧线。PNG 手编码：IHDR+IDAT(zlib deflate)+IEND。
 * @module stardeck-desktop/gen-icon
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.png')
const S = 512

// ── CRC32 ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = buf => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// ── 像素画 ──
const px = new Uint8Array(S * S * 4)
const set = (x, y, r, g, b, a = 255) => {
  const i = (y * S + x) * 4
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
}
const R = 88 // 圆角半径
const inRounded = (x, y) => {
  const cx = Math.min(Math.max(x, R), S - R)
  const cy = Math.min(Math.max(y, R), S - R)
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R || (x >= R && x <= S - R) || (y >= R && y <= S - R)
}
// 五角星（罗经星）：显式 10 顶点多边形 + 射线法（真直边，不是极角插值花瓣）。
const STAR_VERTS = (() => {
  const cx = S / 2, cy = 226, rOut = 172, rIn = 68
  const v = []
  for (let k = 0; k < 10; k++) {
    const ang = -Math.PI / 2 + k * (Math.PI / 5)
    const r = k % 2 === 0 ? rOut : rIn
    v.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)])
  }
  return v
})()
const star = (_cx, _cy, _rOut, _rIn, x, y) => {
  let inside = false
  for (let i = 0, j = STAR_VERTS.length - 1; i < STAR_VERTS.length; j = i++) {
    const [xi, yi] = STAR_VERTS[i]
    const [xj, yj] = STAR_VERTS[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (!inRounded(x, y)) { set(x, y, 0, 0, 0, 0); continue }
    // 夜空垂直渐变 #0b1d33 → #16304f
    const t = y / S
    const r = Math.round(11 + 21 * t), g = Math.round(29 + 19 * t), b = Math.round(51 + 28 * t)
    set(x, y, r, g, b)
    // 甲板弧（下弦）：以画布上方远点为圆心的浅色弧带
    const dx = x - S / 2, dy = y - (-260)
    const d = Math.hypot(dx, dy)
    if (d > 620 && d < 640) set(x, y, 246, 196, 83, px[(y * S + x) * 4 + 3]) // 金弧
    else if (d >= 640 && d < 700 && (x + y) % 24 < 5) set(x, y, 90, 120, 160) // 铆钉刻度
    // 罗经星（金色，柔边 1px）
    if (star(S / 2, 226, 172, 68, x, y)) set(x, y, 246, 196, 83)
  }
}

// ── PNG 编码 ──
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filter none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`icon 已生成：${OUT}（${png.length} bytes）`)
