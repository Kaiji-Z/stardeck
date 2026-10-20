/**
 * 舰桥频道（D26，v0.3.0 对话范式）：聊天窗=默认脸面。舰长和一个经理人
 * （大副正典）对话——下令、问战况、问概念；机械战报与请示卡都推到这里。
 * 读投影红线内：消息流是 bridge.jsonl 的 fold 投影（SSE rev 驱动刷新），
 * 一切写走既有通道（/bridge/messages 入账、/commands/answer、/commands/plan、
 * tools/call war_close_task）；决策卡词汇复用 focusPage 词典（一处正典）。
 * 决策卡是独立组件实例（各持自己的编辑态）——hooks 不落在 map 回调里。
 * @module stardeck/client/bridge
 */

import { createElement, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { answerCommand, closeTask, createCommand, decidePlan, sendBridgeMessage, useWar, warBoardStore, type BoardCommand, type BoardTask, type BridgeChatMessage } from './data.ts'
import { activeCopy, subscribeSkin, skinId, subscribeLang, langId } from './copy.ts'
import { collectInbox, type InboxItem } from './inbox.ts'
import { reportBody } from './views.tsx'

/** 频道消息 store：与 WarBoardStore 同纪律（SSE rev 驱动 + 15s 兜底轮询）。 */
class BridgeStore {
  private snapshot: BridgeChatMessage[] | null = null
  private error: string | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  private source: EventSource | undefined
  private lastRev: string | undefined
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      void this.tick()
      this.openStream()
      this.timer = setInterval(() => { void this.tick() }, 15_000)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
        this.closeStream()
      }
    }
  }

  getSnapshot = (): BridgeChatMessage[] | null => this.snapshot
  getError = (): string | null => this.error
  refresh = (): void => { void this.tick() }

  private openStream(): void {
    if (typeof EventSource === 'undefined') return
    try {
      const es = new EventSource('/warroom/api/events')
      es.onmessage = (ev: MessageEvent<string>) => {
        try {
          const rev = (JSON.parse(ev.data) as { rev?: string }).rev
          if (rev !== undefined && rev !== this.lastRev) {
            this.lastRev = rev
            void this.tick()
          }
        } catch { /* malformed frame — poll covers */ }
      }
      this.source = es
    } catch { /* EventSource refused — poll stays */ }
  }

  private closeStream(): void {
    this.source?.close()
    this.source = undefined
    this.lastRev = undefined
  }

  private async tick(): Promise<void> {
    try {
      const res = await fetch('/warroom/api/bridge/messages')
      if (!res.ok) throw new Error(`bridge HTTP ${res.status}`)
      const body = await res.json() as { ok?: boolean; messages?: BridgeChatMessage[]; revision?: string }
      if (body.ok !== true || body.messages === undefined) throw new Error('bridge payload malformed')
      this.snapshot = body.messages
      if (body.revision !== undefined) this.lastRev = body.revision
      this.error = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    }
    for (const l of this.listeners) l()
  }
}

export const bridgeStore = new BridgeStore()

function useBridge(): { messages: BridgeChatMessage[] | null; error: string | null } {
  const messages = useSyncExternalStore(bridgeStore.subscribe, bridgeStore.getSnapshot, bridgeStore.getSnapshot)
  const error = useSyncExternalStore(bridgeStore.subscribe, bridgeStore.getError, bridgeStore.getError)
  return { messages, error }
}

function hhmm(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- 决策卡组件（各自持编辑态） ----------

interface CardProps {
  item: InboxItem
  busy: boolean
  /** 卡内动作统一出口：忙碌守卫+失败出声+双 store 刷新。 */
  act: (refId: string, fn: () => Promise<{ ok: boolean }>) => void
  onOpenBoard?: (commandId?: string) => void
}

function cardHead(label: string, title: string, refId: string): ReactNode {
  return createElement('div', { className: 'war-bcard-head' },
    createElement('span', { className: 'war-bcard-tag' }, label),
    createElement('span', { className: 'war-bcard-title', title: title }, title),
    createElement('span', { className: 'war-bcard-id' }, refId))
}

/** 澄清答复卡：选择题药丸（1A;2B 拼装与板会议室同款）+ 自由输入兜底。 */
function ClarifyCard(props: CardProps & { cmd: BoardCommand }): ReactNode {
  const { item, cmd, busy, act } = props
  const bc = activeCopy().bridge
  const fp = activeCopy().focusPage
  const clar = cmd.clarification
  const [text, setText] = useState('')
  const pick = (qi: number, letter: string): void => {
    setText(t => {
      const cleaned = t.replace(new RegExp(`(?:^|\\s)${qi + 1}[A-Z];?`, 'g'), '').trim()
      const addition = `${qi + 1}${letter};`
      return cleaned === '' ? addition : `${cleaned} ${addition}`
    })
  }
  const sendAnswer = (): void => {
    if (text.trim() === '' || busy) return
    act(item.refId, () => answerCommand(item.refId, text.trim(), 'bridge'))
  }
  return createElement('div', { className: 'war-bcard', 'data-bridge-card': 'clarify' },
    cardHead(bc.cardClarify, item.title, item.refId),
    createElement('ol', { className: 'war-clarify-q' },
      ...(clar?.questions ?? []).map((q, qi) => {
        const stem = q.split(/(?=A[.、::]?\s)/)[0] ?? q
        const options = clar?.options?.[qi] ?? []
        return createElement('li', { key: qi },
          createElement('span', { className: 'war-clarify-stem' }, stem),
          options.length > 0
            ? createElement('span', { className: 'war-clarify-opts' }, ...options.map((opt, oj) => createElement('button', {
                key: oj, className: `war-btn war-clarify-opt${text.includes(`${qi + 1}${String.fromCharCode(65 + oj)}`) ? ' war-clarify-opt-on' : ''}`,
                type: 'button', title: fp.clarifyPickNote,
                onClick: () => { pick(qi, String.fromCharCode(65 + oj)) },
              }, opt)))
            : null,
        )
      })),
    createElement('textarea', {
      className: 'war-cd-answer war-bcard-input', rows: 2, placeholder: fp.answerPh, value: text,
      onChange: e => { setText(String(e.target.value ?? '')) },
      onKeyDown: e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendAnswer() } },
    }),
    createElement('div', { className: 'war-bcard-actions' },
      createElement('button', { className: 'war-btn primary', type: 'button', disabled: busy || text.trim() === '', 'data-bridge-act': 'answer', onClick: sendAnswer }, busy ? bc.actionBusy : fp.answerBtn)),
  )
}

/** 任务书签发卡（D24 签发权绝对化在聊天内的对位物）：五项可编辑+附言。 */
function SignCard(props: CardProps & { cmd: BoardCommand }): ReactNode {
  const { item, cmd, busy, act } = props
  const bc = activeCopy().bridge
  const fp = activeCopy().focusPage
  const src = cmd.brief ?? { goal: '', background: '', acceptance: '', nonGoals: '', deliverables: '' }
  const [five, setFive] = useState({ goal: src.goal, background: src.background, acceptance: src.acceptance, nonGoals: src.nonGoals, deliverables: src.deliverables })
  const [note, setNote] = useState('')
  const complete = five.goal.trim() !== '' && five.background.trim() !== '' && five.acceptance.trim() !== '' && five.nonGoals.trim() !== '' && five.deliverables.trim() !== ''
  const decide = (decision: 'approve' | 'reject'): void => {
    if (busy) return
    if (decision === 'reject' && note.trim() === '') return
    act(item.refId, () => decidePlan(item.refId, decision, note.trim() === '' ? undefined : note.trim(), decision === 'approve' ? five : undefined))
  }
  const fields: Array<[keyof typeof five, string]> = [
    ['goal', fp.briefGoal], ['background', fp.briefBackground], ['acceptance', fp.briefAcceptance], ['nonGoals', fp.briefNonGoals], ['deliverables', fp.briefDeliverables],
  ]
  return createElement('div', { className: 'war-bcard', 'data-bridge-card': 'sign' },
    cardHead(bc.cardSign, item.title, item.refId),
    ...fields.map(([k, label]) => createElement('label', { key: k, className: 'war-bcard-field' },
      createElement('span', { className: 'war-bcard-flabel' }, label),
      createElement('textarea', {
        className: 'war-bcard-input', rows: k === 'goal' || k === 'acceptance' ? 2 : 3, value: five[k],
        onChange: e => { setFive({ ...five, [k]: String(e.target.value ?? '') }) },
      }))),
    createElement('textarea', { className: 'war-bcard-input war-bcard-note', rows: 2, placeholder: fp.signNotePh, value: note, onChange: e => { setNote(String(e.target.value ?? '')) } }),
    createElement('div', { className: 'war-bcard-actions' },
      createElement('button', { className: 'war-btn primary', type: 'button', disabled: busy || !complete, 'data-bridge-act': 'sign', title: fp.signEditableNote, onClick: () => { decide('approve') } }, busy ? bc.actionBusy : fp.signBtn),
      createElement('button', { className: 'war-btn war-btn-warn', type: 'button', disabled: busy || note.trim() === '', 'data-bridge-act': 'redraft', onClick: () => { decide('reject') } }, fp.redraftBtn)),
  )
}

/** 验收卡：证据摘要（战报节选+机械核对）+ 验收/打回——定夺归舰长（红线①）。 */
function ReviewCard(props: CardProps & { task: BoardTask }): ReactNode {
  const { item, task, busy, act } = props
  const bc = activeCopy().bridge
  const fp = activeCopy().focusPage
  const last = task.reports.length > 0 ? task.reports[task.reports.length - 1] : null
  const ev = last?.evidence ?? null
  const checks = ev?.checks ?? []
  const passed = checks.filter(c => c.passed).length
  const accept = (): void => {
    if (busy) return
    act(item.refId, () => closeTask(item.refId, '通过收官——舰桥频道一键验收'))
  }
  const knock = (): void => {
    if (busy) return
    act(item.refId, async () => {
      const out = await createCommand(activeCopy().taskCard.rejectTemplate(item.refId))
      const cmdId = out.ok === true && out.commandId !== undefined ? out.commandId : null
      return closeTask(item.refId, cmdId !== null ? `打回——续接令 ${cmdId}` : '打回——舰桥频道')
    })
  }
  return createElement('div', { className: 'war-bcard', 'data-bridge-card': 'review' },
    cardHead(bc.cardReview, item.title, item.refId),
    last !== null
      ? createElement('div', { className: 'war-bcard-body' }, reportBody(last.text.slice(0, 600)))
      : createElement('p', { className: 'war-bcard-hint' }, fp.historyEmpty),
    createElement('div', { className: 'war-bcard-evi' },
      `${checks.length > 0 ? `${passed}/${checks.length} 项验收核对通过` : '无机械核对项'}${ev?.tests !== undefined ? ` · 测试退出码 ${ev.tests.exitCode}` : ''}${task.deliverables.length > 0 ? ` · 交付物 ${task.deliverables.length} 件` : ''}`),
    createElement('div', { className: 'war-bcard-actions' },
      createElement('button', { className: 'war-btn primary', type: 'button', disabled: busy, 'data-bridge-act': 'accept', title: fp.acceptTitle, onClick: accept }, busy ? bc.actionBusy : fp.acceptBtn),
      createElement('button', { className: 'war-btn war-btn-warn', type: 'button', disabled: busy, 'data-bridge-act': 'knock', onClick: knock }, bc.knockBtn)),
  )
}

/** 重试卡：失败任务一键下重试令（打回播种同款——续接令自动定性旧账）。 */
function RetryCard(props: CardProps & { task: BoardTask }): ReactNode {
  const { item, task, busy, act } = props
  const bc = activeCopy().bridge
  const retry = (): void => {
    if (busy) return
    act(item.refId, async () => {
      const out = await createCommand(activeCopy().taskCard.retryTemplate(item.refId))
      const cmdId = out.ok === true && out.commandId !== undefined ? out.commandId : null
      return closeTask(item.refId, cmdId !== null ? `重试——续接令 ${cmdId}` : '重试——舰桥频道')
    })
  }
  return createElement('div', { className: 'war-bcard', 'data-bridge-card': 'retry' },
    cardHead(bc.cardRetry, item.title, item.refId),
    task.lastError !== null && task.lastError !== ''
      ? createElement('p', { className: 'war-bcard-hint' }, task.lastError)
      : null,
    createElement('div', { className: 'war-bcard-actions' },
      createElement('button', { className: 'war-btn primary', type: 'button', disabled: busy, 'data-bridge-act': 'retry', onClick: retry }, busy ? bc.actionBusy : bc.retryBtn)),
  )
}

// ---------- 聊天面 ----------

/** 舰桥频道聊天面。onOpenBoard=点穿回调（壳层切视图并带聚焦页 hash）。 */
export function BridgePane(props: { onOpenBoard?: (commandId?: string) => void }): ReactNode {
  const { onOpenBoard } = props
  const { data } = useWar()
  const { messages, error } = useBridge()
  useSyncExternalStore(subscribeSkin, skinId)
  useSyncExternalStore(subscribeLang, langId)
  const bc = activeCopy().bridge
  const commands = data?.commands ?? []
  const tasks = data?.tasks ?? []
  // D27 代理舰长席在役判定：bridge 面缺席（旗 OFF 面）不出现在本组件；显式
  // proxy:false=降级态（输入停用+诚实文案——战报与决策卡照常，只没了对话者）。
  const proxyAway = data?.bridge?.enabled === true && data.bridge.proxy === false
  // 任务 → 源命令（战报/验收卡点穿聚焦页用）。
  const lineageOf = (taskId: string): BoardCommand | null => commands.find(c => c.taskId === taskId) ?? null
  const inbox = collectInbox(commands, tasks).slice(0, 4)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendNote, setSendNote] = useState('')
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const msgsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = msgsRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [messages])
  useEffect(() => {
    if (sendNote === '' && actionNote === null) return
    const t = setTimeout(() => { setSendNote(''); setActionNote(null) }, 6000)
    return () => { clearTimeout(t) }
  }, [sendNote, actionNote])

  /** 卡内动作统一出口：忙碌守卫+失败出声+双 store 刷新。 */
  const act = (refId: string, fn: () => Promise<{ ok: boolean }>): void => {
    if (busyRef !== null) return
    setBusyRef(refId)
    void fn().then(ok => {
      setBusyRef(null)
      setActionNote(ok ? null : bc.actionFail)
      if (ok) { warBoardStore.refresh(); bridgeStore.refresh() }
    })
  }

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (text === '' || sending) return
    setSending(true)
    setSendNote('')
    const out = await sendBridgeMessage(text)
    setSending(false)
    if (out.ok) { setInput(''); setSendNote(bc.sentNote); bridgeStore.refresh() }
    else setActionNote(out.error ?? bc.actionFail)
  }

  const openFocusBtn = (commandId: string, key: string): ReactNode =>
    createElement('button', { key, className: 'war-btn war-bref', type: 'button', onClick: () => { onOpenBoard?.(commandId) } }, bc.openFocus)
  const msgRow = (m: BridgeChatMessage, i: number): ReactNode => {
    const role = m.kind === 'user' ? bc.roleYou : m.kind === 'agent' ? bc.roleManager : bc.roleSystem
    const refs: ReactNode[] = []
    if (onOpenBoard !== undefined) {
      const cmdId = m.refs?.commandId ?? (m.commandRefs !== undefined && m.commandRefs.length > 0 ? m.commandRefs[0] : undefined)
      if (cmdId !== undefined) refs.push(openFocusBtn(cmdId, 'ref-cmd'))
      const taskId = m.refs?.taskId
      if (taskId !== undefined && m.refs?.commandId === undefined) {
        const owner = lineageOf(taskId)
        if (owner !== null) refs.push(openFocusBtn(owner.commandId, 'ref-task'))
      }
    }
    if (m.kind === 'system') {
      return createElement('div', { key: i, className: `war-bmsg war-bmsg-system war-bnotice-${m.noticeKind ?? 'info'}`, 'data-bridge-notice': m.noticeKind ?? 'info' },
        createElement('div', { className: 'war-bmsg-meta' }, `${role} · ${hhmm(m.ts)}`),
        createElement('div', { className: 'war-bmsg-body' }, m.text),
        refs.length > 0 ? createElement('div', { className: 'war-bmsg-refs' }, ...refs) : null,
      )
    }
    return createElement('div', { key: i, className: `war-bmsg war-bmsg-${m.kind}` },
      createElement('div', { className: 'war-bmsg-meta' }, `${role} · ${hhmm(m.ts)}`),
      m.kind === 'agent'
        ? createElement('div', { className: 'war-bmsg-body' }, reportBody(m.text))
        : createElement('div', { className: 'war-bmsg-body war-bmsg-plain' }, m.text),
      m.kind === 'agent' && m.commandRefs !== undefined && m.commandRefs.length > 0 && onOpenBoard !== undefined
        ? createElement('div', { className: 'war-bmsg-refs' },
            createElement('span', { className: 'war-bmsg-chips' }, ...m.commandRefs.map((c, j) => openFocusBtn(c, `c-${j}`))))
        : null,
    )
  }

  const dockCard = (item: InboxItem): ReactNode => {
    const cardProps: CardProps = { item, busy: busyRef !== null, act, onOpenBoard }
    if (item.kind === 'clarify' || item.kind === 'plan') {
      const cmd = commands.find(c => c.commandId === item.refId)
      if (cmd === undefined) return null
      return item.kind === 'clarify' ? createElement(ClarifyCard, { key: item.refId, ...cardProps, cmd }) : createElement(SignCard, { key: item.refId, ...cardProps, cmd })
    }
    const task = tasks.find(t => t.taskId === item.refId)
    if (task === undefined) return null
    return item.kind === 'review' ? createElement(ReviewCard, { key: item.refId, ...cardProps, task }) : createElement(RetryCard, { key: item.refId, ...cardProps, task })
  }

  return createElement('div', { className: 'war-root war-bridge', 'data-bridge': '1' },
    createElement('div', { className: 'war-bridge-head' },
      createElement('span', { className: 'war-bridge-title' }, bc.title),
      createElement('span', { className: 'war-bridge-motto' }, bc.motto),
    ),
    createElement('div', { className: 'war-bridge-msgs', ref: msgsRef, 'data-bridge-msgs': '1' },
      error !== null && messages === null ? createElement('p', { className: 'war-bridge-err' }, bc.loadFail) : null,
      messages !== null && messages.length === 0 ? createElement('p', { className: 'war-bridge-welcome' }, bc.welcome) : null,
      ...(messages ?? []).map(msgRow),
    ),
    createElement('div', { className: 'war-bridge-dock', 'data-bridge-dock': inbox.length > 0 ? 'pending' : 'empty' },
      createElement('div', { className: 'war-bridge-dockhead' }, bc.dockTitle),
      inbox.length === 0
        ? createElement('p', { className: 'war-bcard-hint' }, bc.dockEmpty)
        : inbox.map(dockCard),
    ),
    createElement('div', { className: 'war-bridge-input' },
      actionNote !== null ? createElement('p', { className: 'war-bridge-err', role: 'alert' }, actionNote) : null,
      sendNote !== '' ? createElement('p', { className: 'war-bcard-hint', role: 'status' }, sendNote) : null,
      proxyAway ? createElement('p', { className: 'war-bcard-hint', 'data-bridge-proxy-away': '1' }, bc.proxyAway) : null,
      createElement('textarea', {
        className: 'war-bridge-ta', rows: 2, placeholder: proxyAway ? bc.proxyAway : bc.inputPh, value: input, 'data-bridge-input': '1',
        disabled: proxyAway,
        onChange: e => { setInput(String(e.target.value ?? '')) },
        onKeyDown: e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void send() } },
      }),
      createElement('div', { className: 'war-bridge-sendrow' },
        createElement('button', { className: 'war-btn primary', type: 'button', disabled: proxyAway || sending || input.trim() === '', 'data-bridge-send': '1', onClick: () => { void send() } }, sending ? bc.sending : bc.send)),
    ),
  )
}
