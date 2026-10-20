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

/** D29 critique P1：跨挂载草稿仓——chat/split/看板三态切换会重挂 BridgePane，
 *  在途输入/签发五项/澄清答复/打回理由若无仓则静默归零（决策面数据丢失：
 *  舰长签任务书切去分屏核对一眼，切回来五项全变回原稿且无提示）。模块级
 *  对象跨挂载存活；页面刷新即失（会话级草稿，不入账不越红线）。 */
const draftStore: {
  input: string
  cards: Record<string, { five?: Record<string, string>; note?: string; text?: string }>
} = { input: '', cards: {} }

/** 澄清答复卡：选择题药丸（1A;2B 拼装与板会议室同款）+ 自由输入兜底。 */
function ClarifyCard(props: CardProps & { cmd: BoardCommand }): ReactNode {
  const { item, cmd, busy, act } = props
  const bc = activeCopy().bridge
  const fp = activeCopy().focusPage
  const clar = cmd.clarification
  const [text, setText] = useState(() => draftStore.cards[item.refId]?.text ?? '')
  const setTextBoth = (v: string): void => {
    setText(v)
    const slot = draftStore.cards[item.refId] ?? {}
    slot.text = v
    draftStore.cards[item.refId] = slot
  }
  const pick = (qi: number, letter: string): void => {
    setText(t => {
      const cleaned = t.replace(new RegExp(`(?:^|\\s)${qi + 1}[A-Z];?`, 'g'), '').trim()
      const addition = `${qi + 1}${letter};`
      const next = cleaned === '' ? addition : `${cleaned} ${addition}`
      setTextBoth(next)
      return next
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
      onChange: e => { setTextBoth(String(e.target.value ?? '')) },
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
  const saved = draftStore.cards[item.refId]
  const [five, setFive] = useState(() => saved?.five !== undefined
    ? { goal: saved.five.goal ?? src.goal, background: saved.five.background ?? src.background, acceptance: saved.five.acceptance ?? src.acceptance, nonGoals: saved.five.nonGoals ?? src.nonGoals, deliverables: saved.five.deliverables ?? src.deliverables }
    : { goal: src.goal, background: src.background, acceptance: src.acceptance, nonGoals: src.nonGoals, deliverables: src.deliverables })
  const [note, setNote] = useState(() => saved?.note ?? '')
  const setFiveBoth = (next: typeof five): void => {
    setFive(next)
    const slot = draftStore.cards[item.refId] ?? {}
    slot.five = { ...next }
    draftStore.cards[item.refId] = slot
  }
  const setNoteBoth = (v: string): void => {
    setNote(v)
    const slot = draftStore.cards[item.refId] ?? {}
    slot.note = v
    draftStore.cards[item.refId] = slot
  }
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
        onChange: e => { setFiveBoth({ ...five, [k]: String(e.target.value ?? '') }) },
      }))),
    createElement('textarea', { className: 'war-bcard-input war-bcard-note', rows: 2, placeholder: fp.signNotePh, value: note, onChange: e => { setNoteBoth(String(e.target.value ?? '')) } }),
    createElement('div', { className: 'war-bcard-actions' },
      createElement('button', { className: 'war-btn primary', type: 'button', disabled: busy || !complete, 'data-bridge-act': 'sign', title: fp.signEditableNote, onClick: () => { decide('approve') } }, busy ? bc.actionBusy : fp.signBtn),
      createElement('button', { className: 'war-btn war-btn-warn', type: 'button', disabled: busy || note.trim() === '', 'data-bridge-act': 'redraft', onClick: () => { decide('reject') } }, fp.redraftBtn)),
  )
}

/** 验收卡：证据摘要（战报节选+机械核对）+ 验收/打回——定夺归舰长（红线①）。
 *  D29 critique P1：打回必附言（与签发卡驳回纪律对齐）——空理由的打回令会让
 *  外勤小队拿着一句悬空冒号重做同样的错。 */
function ReviewCard(props: CardProps & { task: BoardTask }): ReactNode {
  const { item, task, busy, act } = props
  const bc = activeCopy().bridge
  const fp = activeCopy().focusPage
  const last = task.reports.length > 0 ? task.reports[task.reports.length - 1] : null
  const ev = last?.evidence ?? null
  const checks = ev?.checks ?? []
  const passed = checks.filter(c => c.passed).length
  const [knockNote, setKnockNote] = useState(() => draftStore.cards[item.refId]?.note ?? '')
  const [confirming, setConfirming] = useState(false)
  const setKnockNoteBoth = (v: string): void => {
    setKnockNote(v)
    const slot = draftStore.cards[item.refId] ?? {}
    slot.note = v
    draftStore.cards[item.refId] = slot
  }
  // D29 critique：全站权限最高的按钮（终局定夺不可逆）不再裸单击——两步确认，
  // 5s 不续击自动回落；两击间隔 <800ms 视为手抖连击不认（防误触双击直达终局）。
  const confirmTimer = useRef<number | null>(null)
  const armedAt = useRef(0)
  useEffect(() => () => { if (confirmTimer.current !== null) clearTimeout(confirmTimer.current) }, [])
  const accept = (): void => {
    if (busy) return
    if (!confirming) {
      setConfirming(true)
      armedAt.current = Date.now()
      confirmTimer.current = window.setTimeout(() => { setConfirming(false); confirmTimer.current = null }, 5000)
      return
    }
    if (Date.now() - armedAt.current < 800) return
    if (confirmTimer.current !== null) { clearTimeout(confirmTimer.current); confirmTimer.current = null }
    act(item.refId, () => closeTask(item.refId, '通过（舰桥频道一键验收）'))
  }
  const knock = (): void => {
    const reason = knockNote.trim()
    if (busy || reason === '') return
    act(item.refId, async () => {
      const out = await createCommand(`${activeCopy().taskCard.rejectTemplate(item.refId)}${reason}`)
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
    createElement('textarea', { className: 'war-bcard-input war-bcard-note', rows: 2, placeholder: bc.knockNotePh, value: knockNote, 'data-bridge-knock-note': '1', onChange: e => { setKnockNoteBoth(String(e.target.value ?? '')) } }),
    createElement('div', { className: 'war-bcard-actions' },
      createElement('button', { className: `war-btn${confirming ? ' war-btn-warn' : ' primary'}`, type: 'button', disabled: busy, 'data-bridge-act': 'accept', title: confirming ? fp.acceptConfirm : fp.acceptTitle, onClick: accept }, busy ? bc.actionBusy : confirming ? fp.acceptConfirm : fp.acceptBtn),
      createElement('button', { className: 'war-btn war-btn-warn', type: 'button', disabled: busy || knockNote.trim() === '', 'data-bridge-act': 'knock', onClick: knock }, bc.knockBtn)),
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
  const [input, setInput] = useState(() => draftStore.input)
  const [sending, setSending] = useState(false)
  const [sendNote, setSendNote] = useState('')
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const msgsRef = useRef<HTMLDivElement | null>(null)
  // D29 critique P1：阅读位置保护——只在已近底时跟随新消息；往上翻历史不再被
  // 15s 轮询拽回底部。发送后强制回底（自己的消息自己看得见）。
  const nearBottomRef = useRef(true)
  useEffect(() => {
    const el = msgsRef.current
    if (el !== null && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])
  // D29 critique：成功提示照旧自清；**失败提示常驻**——「操作失败」与「已发送」
  // 同寿 6 秒的话，慢读者看到的是「什么都没发生」。失败只在下一次动作时清。
  useEffect(() => {
    if (sendNote === '') return
    const t = setTimeout(() => { setSendNote('') }, 6000)
    return () => { clearTimeout(t) }
  }, [sendNote])

  /** 卡内动作统一出口：忙碌守卫+失败出声（常驻至下次动作）+双 store 刷新。 */
  const act = (refId: string, fn: () => Promise<{ ok: boolean }>): void => {
    if (busyRef !== null) return
    setBusyRef(refId)
    setActionNote(null)
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
    setActionNote(null)
    const out = await sendBridgeMessage(text)
    setSending(false)
    if (out.ok) {
      draftStore.input = ''
      setInput('')
      nearBottomRef.current = true
      setSendNote(bc.sentNote)
      bridgeStore.refresh()
    } else setActionNote(out.error ?? bc.actionFail)
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
      // D28 图景附件：已对账图页（沙箱 iframe，sandbox=''禁一切脚本+API——服务端
      // CSP 再关一道；零脚本单文件，新窗可开全图）。
      m.kind === 'agent' && m.artifact !== undefined
        ? createElement('div', { className: 'war-bmsg-scenewrap', 'data-bridge-scene': m.artifact.id },
            createElement('div', { className: 'war-bmsg-scenehead' },
              createElement('span', { className: 'war-bmsg-scenetag' }, bc.sceneCaption(m.artifact.title)),
              createElement('a', { href: `/warroom/api/artifact/${m.artifact.id}`, target: '_blank', rel: 'noreferrer', className: 'war-bref' }, bc.sceneOpen)),
            createElement('iframe', {
              src: `/warroom/api/artifact/${m.artifact.id}`, title: m.artifact.title,
              sandbox: '', loading: 'lazy', className: 'war-bmsg-scene',
            }))
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
      // D29 critique：加速器不可见等于不存在——聊天头常驻一行键位提示。
      createElement('span', { className: 'war-bridge-kbd' }, bc.kbdHint),
    ),
    createElement('div', {
      className: 'war-bridge-msgs', ref: msgsRef, 'data-bridge-msgs': '1', 'aria-live': 'polite',
      onScroll: () => {
        const el = msgsRef.current
        if (el !== null) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      },
    },
      error !== null && messages === null ? createElement('p', { className: 'war-bridge-err' }, bc.loadFail) : null,
      messages !== null && messages.length === 0 ? createElement('p', { className: 'war-bridge-welcome' }, bc.welcome) : null,
      // D29 语调刀：跨日分隔条——HH:MM 时间戳不孤读，隔天回看有锚。
      ...(() => {
        const out: ReactNode[] = []
        let lastDay = ''
        let i = 0
        for (const m of messages ?? []) {
          const day = m.ts.slice(0, 10)
          if (day !== '' && day !== lastDay) {
            const d = Date.parse(m.ts)
            const dt = Number.isFinite(d) ? new Date(d) : null
            out.push(createElement('div', { key: `day-${m.ts}`, className: 'war-bmsg-day' }, dt !== null ? `${dt.getMonth() + 1}月${dt.getDate()}日` : day))
            lastDay = day
          }
          out.push(msgRow(m, i))
          i++
        }
        return out
      })(),
      // D29 critique P1：等待死区治理——末条是舰长话轮=代理舰长在途，常驻
      // 处理中指示（回话即被消息流顶走）。15s 轮询+SSE 双路驱动，无需额外状态。
      messages !== null && messages.length > 0 && messages[messages.length - 1]!.kind === 'user'
        ? createElement('div', { className: 'war-bmsg war-bmsg-typing', 'data-bridge-typing': '1' },
            createElement('span', { className: 'war-typing-dots', 'aria-hidden': 'true' }, '●●●'),
            createElement('span', { className: 'war-typing-label' }, bc.processing))
        : null,
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
        onChange: e => {
          const v = String(e.target.value ?? '')
          draftStore.input = v
          setInput(v)
        },
        onKeyDown: e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void send() } },
      }),
      createElement('div', { className: 'war-bridge-sendrow' },
        createElement('button', { className: 'war-btn primary', type: 'button', disabled: proxyAway || sending || input.trim() === '', 'data-bridge-send': '1', onClick: () => { void send() } }, sending ? bc.sending : bc.send)),
    ),
  )
}
