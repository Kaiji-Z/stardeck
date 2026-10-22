/** D33 舰长令：聊天浮窗可自主调整大小——尺寸钳制与持久化的纯逻辑层。
 *  从 client-standalone.tsx 抽出以便单测（钳制读 window 视口、持久化读 localStorage，
 *  均在调用时取值，模块自身零副作用）。 */

export const PANEL_KEY = 'warroom-tg-panel-size'
export const PANEL_MIN_W = 360
export const PANEL_MIN_H = 420

/** 浮窗尺寸（w/h，钳在视口与最小值内）。 */
export type PanelSize = { w: number; h: number }

/** 钳进 [最小值, 视口-16] 区间并取整；视口过小（<最小值+16）时下限让位最小值。 */
export function clampPanelSize(v: { w: number; h: number }): PanelSize {
  const w = Math.min(Math.max(PANEL_MIN_W, Math.round(v.w)), Math.max(PANEL_MIN_W, window.innerWidth - 16))
  const h = Math.min(Math.max(PANEL_MIN_H, Math.round(v.h)), Math.max(PANEL_MIN_H, window.innerHeight - 16))
  return { w, h }
}

/** 读持久化尺寸；缺省/坏值/越界一律回落钳制后的默认 460×680。 */
export function storedPanelSize(): PanelSize {
  try {
    const v = JSON.parse(localStorage.getItem(PANEL_KEY) ?? '') as PanelSize
    if (typeof v?.w === 'number' && typeof v?.h === 'number' && v.w > 0 && v.h > 0) return clampPanelSize(v)
  } catch { /* 缺省/坏值 → 默认 */ }
  return clampPanelSize({ w: 460, h: 680 })
}
