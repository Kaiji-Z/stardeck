/** 澄清答复防错闸（D38.2 批判轮 P1 收口，bridge 浮窗卡与板会议室 composer
 *  共用）：两问只答一问即可送达=半答入账翻 pending，代理舰长须再开一轮——
 *  CLARIFY_ROUNDS_CAP=2 下一次漏答烧一半轮数预算。闸=「带选项的问题全被
 *  药丸覆盖」或「舰长另有自由作答」（bridge 面看附言框；板面看拼装码之外
 *  的正文）。无选项的问题不参与覆盖判定（只能自由作答）。纯前端启用态闸，
 *  与出口协议/收割管线无涉。 */

/** 从答复文本剥掉 1A;2B 拼装码，剩自由作答正文（板面单框形态用）。 */
export function clarifyProse(text: string): string {
  return text.replace(/(?:^|\s)\d{1,2}[A-Z];?/g, ' ').trim()
}

/** 带选项的问题是否全被覆盖（每问至少一枚药丸被选）。options 为空数组
 *  （无挂起澄清/无选项数据）恒 true——闸退化为原有的非空检查，向后兼容。 */
export function clarifyCovered(text: string, optionSets: ReadonlyArray<ReadonlyArray<string>>): boolean {
  const picked = new Set<number>()
  for (const m of text.matchAll(/(\d{1,2})([A-Z]);/g)) {
    const qi = parseInt(m[1]!, 10) - 1
    if (qi >= 0 && qi < optionSets.length && (optionSets[qi]?.length ?? 0) > 0) picked.add(qi)
  }
  return optionSets.every((opts, qi) => opts.length === 0 || picked.has(qi))
}
