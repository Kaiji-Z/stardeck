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

// ── D40 角标数字（1-9）：任务栏 overlay 徽标——信号蓝圆饼 + 白字 3×5 点阵数字。
// Windows 无原生托盘角标，win.setOverlayIcon 吃预渲染小图；纯点阵零依赖。
const BADGE_S = 36
const FONT = { // 3×5 点阵（行串，'1'=亮）
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '101', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '110'],
}
for (const digit of Object.keys(FONT)) {
  const bx = new Uint8Array(BADGE_S * BADGE_S * 4)
  const bset = (x, y, r, g, b, a = 255) => {
    const i = (y * BADGE_S + x) * 4
    bx[i] = r; bx[i + 1] = g; bx[i + 2] = b; bx[i + 3] = a
  }
  const c = BADGE_S / 2
  const rr = BADGE_S / 2 - 1
  const glyph = FONT[digit]
  const gw = 3, gh = 5, scale = 4
  const ox = Math.round(c - (gw * scale) / 2), oy = Math.round(c - (gh * scale) / 2)
  for (let y = 0; y < BADGE_S; y++) {
    for (let x = 0; x < BADGE_S; x++) {
      const d = Math.hypot(x - c + 0.5, y - c + 0.5)
      if (d <= rr - 1.5) bset(x, y, 14, 116, 214) // 信号蓝（--war-run 同族）
      else if (d <= rr) bset(x, y, 10, 80, 150, 255) // 描边深蓝
      else { bset(x, y, 0, 0, 0, 0); continue }
      const gx = Math.floor((x - ox) / scale), gy = Math.floor((y - oy) / scale)
      if (gx >= 0 && gx < gw && gy >= 0 && gy < gh && glyph[gy][gx] === '1') bset(x, y, 255, 255, 255)
    }
  }
  const braw = Buffer.alloc(BADGE_S * (BADGE_S * 4 + 1))
  for (let y = 0; y < BADGE_S; y++) {
    braw[y * (BADGE_S * 4 + 1)] = 0
    Buffer.from(bx.buffer, y * BADGE_S * 4, BADGE_S * 4).copy(braw, y * (BADGE_S * 4 + 1) + 1)
  }
  const bihdr = Buffer.alloc(13)
  bihdr.writeUInt32BE(BADGE_S, 0)
  bihdr.writeUInt32BE(BADGE_S, 4)
  bihdr[8] = 8
  bihdr[9] = 6
  const bpng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', bihdr),
    chunk('IDAT', deflateSync(braw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  const out = join(dirname(OUT), 'badge-' + digit + '.png')
  writeFileSync(out, bpng)
  console.log('badge 已生成：' + out + '（' + bpng.length + ' bytes）')
}
