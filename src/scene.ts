/**
 * 图景渲染器（D28 百事通·图景面）：代理舰长终答里的【图景】草稿 → 单文件
 * HTML 图页。三权分立（answer-me-with-html 思路）：模型只写 Markdown 草稿
 * （标题+摘要+timeline/stats/cards 三组件围栏），布局、配色、转义、对账全由
 * 本模块代码算——**零 `<script>`、零外部资源**（CSP default-src 'none' 可配）。
 * cards 里的命令号/任务号逐一对账 context：对不上即整页拒收（数字可溯源，
 * 幻觉图景进不了聊天窗）。纯函数：不碰文件系统、不碰时钟。
 * @module stardeck/scene
 */

/** 对账上下文：在册命令/任务（id → 当前状态）。由调用方从账本快照装填。 */
export interface SceneContext {
  commands: ReadonlyMap<string, { status: string }>
  tasks: ReadonlyMap<string, { status: string }>
}

export type SceneRender =
  | { ok: true; html: string; title: string }
  | { ok: false; reason: string }

interface SceneCard { id: string; status: string; text: string }
interface ParsedScene {
  title: string
  summary: string
  timeline: Array<{ when: string; text: string }>
  stats: Array<{ key: string; value: string }>
  cards: SceneCard[]
}

/** 剥 markdown 强调包裹（`**粗体**`/`*斜*`——glm-5.3 实弹风格变体）。 */
function stripEmphasis(s: string): string {
  return s.replace(/^\*{1,3}|_{1,3}/, '').replace(/\*{1,3}|_{1,3}$/, '').trim()
}

export function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** 草稿解析（纯）：`# 标题` + 摘要段 + ```timeline/```stats/```cards 围栏组件。
 * 至少一个组件，缺标题/零组件=拒收；组件行畸形者跳过（宽进），cards 编号
 * 对账在渲染层严出。 */
export function parseSceneDraft(draft: string): { ok: true; scene: ParsedScene } | { ok: false; reason: string } {
  const lines = draft.split(/\r?\n/)
  let title = ''
  const summaryParts: string[] = []
  let fence: 'timeline' | 'stats' | 'cards' | null = null
  const timeline: ParsedScene['timeline'] = []
  const stats: ParsedScene['stats'] = []
  const cards: SceneCard[] = []
  for (const raw of lines) {
    const line = stripEmphasis(raw.trim())
    const fenceMatch = /^```(timeline|stats|cards)\s*$/.exec(stripEmphasis(line))
    if (fenceMatch !== null) {
      fence = fenceMatch[1] as typeof fence
      continue
    }
    if (line === '```') {
      fence = null
      continue
    }
    if (fence === 'timeline') {
      const m = /^[-*•]\s*(\S+)\s+(.+)$/.exec(stripEmphasis(line))
      if (m !== null) timeline.push({ when: m[1]!, text: m[2]! })
      continue
    }
    if (fence === 'stats') {
      const m = /^([^:：]{1,30})[:：]\s*(.+)$/.exec(stripEmphasis(line))
      if (m !== null) stats.push({ key: m[1]!.trim(), value: m[2]!.trim() })
      continue
    }
    if (fence === 'cards') {
      const seg = stripEmphasis(line).replace(/^[-*•]\s*/, '').split('|').map(s => s.trim())
      if (seg.length === 3 && seg.every(s => s !== '')) cards.push({ id: seg[0]!, status: seg[1]!, text: seg[2]! })
      continue
    }
    if (title === '' && line.startsWith('# ')) {
      title = stripEmphasis(line.slice(2))
      continue
    }
    if (title !== '' && line !== '') summaryParts.push(stripEmphasis(line))
  }
  if (title === '') return { ok: false, reason: '草稿缺 `# 标题` 行——图景必须有标题。' }
  if (timeline.length === 0 && stats.length === 0 && cards.length === 0) return { ok: false, reason: '草稿没有任何可用组件（timeline/stats/cards 至少一个，围栏内行要合格式）。' }
  return { ok: true, scene: { title, summary: summaryParts.join(' '), timeline, stats, cards } }
}

const SCENE_STATUS_HUE: Readonly<Record<string, string>> = {
  draft: '#8a93a6', talking: '#c9a227', pending: '#c9a227', approved: '#3f7fbf',
  published: '#3f7fbf', in_progress: '#3f7fbf', reported: '#b07d2b', failed: '#b03a3a',
  closed: '#3f8f5f', cancelled: '#6b7280',
}

function statusChip(status: string): string {
  const hue = SCENE_STATUS_HUE[status] ?? '#8a93a6'
  return `<span class="chip" style="border-color:${hue};color:${hue}">${escapeHtml(status)}</span>`
}

/** 渲染（纯）：解析+对账+出 HTML。cards 编号必须在 context 在册（命令或任务），
 * 对不上=整页拒收并列出未知编号——账本为源，图景不编造。 */
export function renderScene(draft: string, context: SceneContext): SceneRender {
  const parsed = parseSceneDraft(draft)
  if (!parsed.ok) return parsed
  const { title, summary, timeline, stats, cards } = parsed.scene
  const unknown = cards.filter(c => !context.commands.has(c.id) && !context.tasks.has(c.id)).map(c => c.id)
  if (unknown.length > 0) return { ok: false, reason: `cards 编号不在册（对账失败）：${unknown.join('、')}——图景里的编号必须来自速览/日志/只读通道的真实条目。` }
  const e = escapeHtml
  const sections: string[] = []
  if (timeline.length > 0) {
    sections.push('<section class="panel"><h2>时间线</h2><ol class="timeline">' +
      timeline.map(t => `<li><span class="when">${e(t.when)}</span><span class="what">${e(t.text)}</span></li>`).join('') +
      '</ol></section>')
  }
  if (stats.length > 0) {
    sections.push('<section class="panel"><h2>数据</h2><dl class="stats">' +
      stats.map(s => `<div class="stat"><dt>${e(s.key)}</dt><dd>${e(s.value)}</dd></div>`).join('') +
      '</dl></section>')
  }
  if (cards.length > 0) {
    sections.push('<section class="panel"><h2>条目</h2><ul class="cards">' +
      cards.map(c => `<li class="card"><div class="cardhead"><code class="cid">${e(c.id)}</code>${statusChip(c.status)}</div><p>${e(c.text)}</p></li>`).join('') +
      '</ul></section>')
  }
  const html = [
    '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${e(title)} · stardeck 图景</title>`,
    '<style>',
    ':root{color-scheme:dark}',
    'body{margin:0;padding:20px;background:#0d1117;color:#d6dde6;font:14px/1.65 ui-sans-serif,system-ui,"Segoe UI",sans-serif}',
    'h1{margin:0 0 4px;font-size:19px;color:#f0f4f8}',
    '.sum{margin:0 0 18px;color:#9aa7b5}',
    '.panel{background:#151b24;border:1px solid #232c38;border-radius:10px;padding:14px 16px;margin:0 0 14px}',
    '.panel h2{margin:0 0 10px;font-size:13px;letter-spacing:.12em;color:#7f8ea3;text-transform:uppercase}',
    'ol.timeline{list-style:none;margin:0;padding:0}',
    '.timeline li{display:flex;gap:12px;padding:5px 0;border-bottom:1px dashed #1e2733}',
    '.timeline li:last-child{border-bottom:0}',
    '.when{flex:0 0 auto;font-variant-numeric:tabular-nums;color:#6fb3d2;min-width:4.5em}',
    '.what{flex:1}',
    'dl.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0}',
    '.stat{flex:1 1 30%;background:#0f151d;border:1px solid #232c38;border-radius:8px;padding:8px 12px}',
    '.stat dt{font-size:12px;color:#7f8ea3;margin:0 0 2px}',
    '.stat dd{margin:0;font-size:17px;font-weight:600;color:#e8eef5}',
    'ul.cards{list-style:none;margin:0;padding:0}',
    '.card{padding:8px 0;border-bottom:1px dashed #1e2733}',
    '.card:last-child{border-bottom:0}',
    '.cardhead{display:flex;align-items:center;gap:10px;margin-bottom:2px}',
    '.cid{font-size:12px;color:#8fa3b8}',
    '.chip{font-size:11px;border:1px solid;border-radius:99px;padding:0 8px}',
    '.card p{margin:0}',
    '</style></head><body>',
    `<h1>${e(title)}</h1>`,
    summary !== '' ? `<p class="sum">${e(summary)}</p>` : '',
    ...sections,
    '</body></html>',
  ].join('')
  return { ok: true, html, title }
}
