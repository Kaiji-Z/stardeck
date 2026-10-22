/** D33 浮窗尺寸钳制纯逻辑回归（client/panel-size.ts）：min 下限/视口上限/取整/
 *  小视口让位/storage 坏值回落默认——resize 手柄持久化链路的数据面守卫。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { PANEL_KEY, PANEL_MIN_W, PANEL_MIN_H, clampPanelSize, storedPanelSize } from '../src/client/panel-size.ts'

const win = new Window()
Object.assign(globalThis, { window: win, localStorage: win.localStorage })

function viewport(w: number, h: number): void {
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true })
}

test('clampPanelSize：常规值取整且原样通过', () => {
  viewport(1920, 1080)
  assert.deepEqual(clampPanelSize({ w: 460.4, h: 680.6 }), { w: 460, h: 681 })
})

test('clampPanelSize：低于最小值托到 min（360×420）', () => {
  viewport(1920, 1080)
  assert.deepEqual(clampPanelSize({ w: 10, h: 5 }), { w: PANEL_MIN_W, h: PANEL_MIN_H })
})

test('clampPanelSize：超过视口-16 封顶', () => {
  viewport(800, 600)
  assert.deepEqual(clampPanelSize({ w: 9999, h: 9999 }), { w: 784, h: 584 })
})

test('clampPanelSize：视口小于最小值时下限让位最小值（不塌成负数/零）', () => {
  viewport(200, 100)
  const v = clampPanelSize({ w: 50, h: 50 })
  assert.equal(v.w, PANEL_MIN_W)
  assert.equal(v.h, PANEL_MIN_H)
})

test('storedPanelSize：无存储回落默认 460×680（钳后）', () => {
  viewport(1920, 1080)
  win.localStorage.removeItem(PANEL_KEY)
  assert.deepEqual(storedPanelSize(), { w: 460, h: 680 })
})

test('storedPanelSize：坏 JSON/非正数一律回落默认，不炸不采信', () => {
  viewport(1920, 1080)
  win.localStorage.setItem(PANEL_KEY, '{oops')
  assert.deepEqual(storedPanelSize(), { w: 460, h: 680 })
  win.localStorage.setItem(PANEL_KEY, '{"w":-3,"h":0}')
  assert.deepEqual(storedPanelSize(), { w: 460, h: 680 })
})

test('storedPanelSize：合法存储被钳制采信（旧屏拖出的超大尺寸收进新视口）', () => {
  viewport(800, 600)
  win.localStorage.setItem(PANEL_KEY, '{"w":1200,"h":900}')
  assert.deepEqual(storedPanelSize(), { w: 784, h: 584 })
})
