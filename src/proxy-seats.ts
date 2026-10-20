/**
 * D29 外接代理舰长席：座席签发与身份面。
 *
 * 「代理舰长是席位不是进程」（D27 宣言）的第二个坐席形态：用户自己的 agent
 * 经 HTTP/MCP 限定面坐进来（内置 spawn 席与内置 loop 之外）。座席=seatId+
 * token；token 只在签发响应出现一次——落盘只存 sha256 哈希，校验恒哈希比对。
 * proxy-seats.json tmp+rename 原子写（state.ts 家法）；坏文件读作空表（诚实
 * 降级不炸启动）。授权口径：本机回环信任，principal/鉴权另案（D27 声明不变）。
 * @module stardeck/proxy-seats
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ProxySeatRecord {
  seatId: string
  /** sha256(token) hex——明文永不落盘。 */
  tokenHash: string
  createdAt: string
}

export const proxySeatsPath = (stateDir: string): string => join(stateDir, 'proxy-seats.json')

export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex')

export function loadProxySeats(stateDir: string): ProxySeatRecord[] {
  const file = proxySeatsPath(stateDir)
  if (!existsSync(file)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const seats = (parsed as { seats?: unknown }).seats
    if (!Array.isArray(seats)) return []
    return seats.filter((s): s is ProxySeatRecord => {
      if (s === null || typeof s !== 'object') return false
      const r = s as Partial<ProxySeatRecord>
      return typeof r.seatId === 'string' && r.seatId !== '' && typeof r.tokenHash === 'string' && r.tokenHash !== '' && typeof r.createdAt === 'string'
    })
  } catch {
    return [] // 坏文件=空表：座席身份失效属安全侧（宁可拒签旧席也不带病装载）
  }
}

export function saveProxySeats(stateDir: string, seats: ProxySeatRecord[]): void {
  mkdirSync(dirname(proxySeatsPath(stateDir)), { recursive: true })
  const tmp = `${proxySeatsPath(stateDir)}.tmp-${Date.now().toString(36)}`
  writeFileSync(tmp, `${JSON.stringify({ seats }, null, 2)}\n`, 'utf8')
  renameSync(tmp, proxySeatsPath(stateDir))
}

/** 签发一座：seatId=proxyx-<ts36>（与内置 proxy-<ts36> 可视区分），token 48hex
 *  只出现在返回值。落盘即追加（既有座席不失效）。 */
export function issueProxySeat(stateDir: string, now = new Date()): { seatId: string; token: string; record: ProxySeatRecord } {
  const seatId = `proxyx-${now.getTime().toString(36)}`
  const token = randomBytes(24).toString('hex')
  const record: ProxySeatRecord = { seatId, tokenHash: hashToken(token), createdAt: now.toISOString() }
  saveProxySeats(stateDir, [...loadProxySeats(stateDir), record])
  return { seatId, token, record }
}

/** 哈希比对查座（token 缺/错 → null——调用侧 403）。 */
export function seatByToken(stateDir: string, token: string): ProxySeatRecord | null {
  if (token === '') return null
  const h = hashToken(token)
  return loadProxySeats(stateDir).find(s => s.tokenHash === h) ?? null
}
