/**
 * stardeck 的 defineTool——对齐 dsh-tools 工具装配契约的子集实现：
 * 参数描述 → JSON Schema（{type:'object', properties, required}）+ 执行前
 * 参数校验。校验错误保持 dsh 的教学格式（`invalid arguments: …`）——外部
 * agent 靠这条错误自纠参数名（B2 契约案的教训：schema 与教学词不一致，
 * additionalProperties 静默剥参会让 agent 空转到死）。
 *
 * 覆盖面=war_* 工具面实际用到的子集：string/text/number/boolean/array
 * （items=标量）参数 + author JSON-Schema 输出（object/array 嵌套、
 * additionalProperties）。参数根是开放对象（未声明参数不拒收——与 dsh
 * 的隐式开放参数根一致）。
 * @module stardeck/tool
 */

type JsonSchema = Record<string, unknown>

const PARAM_TYPES = new Set(['string', 'text', 'number', 'boolean', 'array', 'object'])

function compileNode(spec: Record<string, unknown>, path: string): JsonSchema {
  const type = spec.type === 'text' ? 'string' : (spec.type as string)
  if (typeof type !== 'string' || !PARAM_TYPES.has(type)) throw new Error(`${path}: 不支持的参数类型 ${JSON.stringify(spec.type)}`)
  const node: JsonSchema = { type }
  if (typeof spec.description === 'string') node.description = spec.description
  if (type === 'array') {
    node.items = spec.items !== undefined ? compileNode(spec.items as Record<string, unknown>, `${path}[]`) : { type: 'string' }
  }
  if (type === 'object') {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [k, child] of Object.entries((spec.properties ?? {}) as Record<string, Record<string, unknown>>)) {
      properties[k] = compileNode(child, `${path}.${k}`)
      if (child.required === true) required.push(k)
    }
    node.properties = properties
    if (required.length > 0) node.required = required
    if (spec.additionalProperties === false) node.additionalProperties = false
  }
  return node
}

/** 平铺参数描述 → 对象根 JSON Schema（dsh parameterSchemaSpecToJsonSchema 同形）。 */
export function parameterSchemaSpecToJsonSchema(spec: Record<string, unknown> | undefined): JsonSchema {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, raw] of Object.entries(spec ?? {})) {
    const p = raw as Record<string, unknown>
    properties[key] = compileNode(p, `parameters.${key}`)
    if (p.required === true) required.push(key)
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

/** author 输出 schema 已是 JSON Schema 形状——深拷贝直通。 */
export function valueSchemaSpecToJsonSchema(spec: unknown): JsonSchema {
  return JSON.parse(JSON.stringify(spec ?? {})) as JsonSchema
}

const typeName: Record<string, string> = { string: 'a string', number: 'a number', boolean: 'a boolean', array: 'an array', object: 'an object' }

/** 候选值对 schema 的违规清单（空=合法）。可选属性缺席不算违规。 */
export function validateJsonSchemaValue(schema: JsonSchema, value: unknown, path = ''): string[] {
  const out: string[] = []
  const label = path === '' ? 'value' : path
  const type = schema.type as string | undefined
  if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`"${label}" must be an object`]
    const obj = value as Record<string, unknown>
    for (const key of ((schema.required as string[]) ?? [])) if (!(key in obj)) out.push(`"${key}" is required`)
    for (const [k, node] of Object.entries((schema.properties ?? {}) as Record<string, JsonSchema>)) {
      if (k in obj) out.push(...validateJsonSchemaValue(node, obj[k], path === '' ? k : `${path}.${k}`))
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys((schema.properties ?? {}) as Record<string, unknown>))
      const extra = Object.keys(obj).filter(k => !known.has(k))
      if (extra.length > 0) out.push(`"${extra[0]}" is not an allowed property`)
    }
    return out
  }
  if (value === undefined) return out
  if (type === 'string') { if (typeof value !== 'string') out.push(`"${label}" must be ${typeName[type]}`) }
  else if (type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value)) out.push(`"${label}" must be ${typeName[type]}`) }
  else if (type === 'boolean') { if (typeof value !== 'boolean') out.push(`"${label}" must be ${typeName[type]}`) }
  else if (type === 'array') {
    if (!Array.isArray(value)) return [`"${label}" must be an array`]
    const items = (schema.items ?? {}) as JsonSchema
    value.forEach((v, i) => out.push(...validateJsonSchemaValue(items, v, path === '' ? String(i) : `${path}.${i}`)))
  }
  return out
}

/** 模型参数违规（教学错误——文案格式与 dsh ToolArgsError 对齐）。 */
export class ToolArgsError extends Error {
  constructor(public readonly violations: string[]) {
    super(`invalid arguments: ${violations.join('; ')}`)
    this.name = 'ToolArgsError'
  }
}

export interface ToolDescriptor {
  name: string
  description: string
  parameters: JsonSchema
  output: { schema: JsonSchema; render(args: unknown, value: unknown): unknown[] }
  execute(args: Record<string, unknown>, exec: unknown): Promise<unknown>
  presentCall?(args: unknown): unknown
  [key: string]: unknown
}

/** 定义一个工具：schema 编译 + 执行前校验 + 渲染钩子（identity 形状）。 */
export function defineTool(options: {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: unknown; render(args: unknown, value: unknown): unknown[] }
  execute(args: Record<string, unknown>, exec: unknown): Promise<unknown>
  presentCall?(args: unknown): unknown
}): ToolDescriptor {
  const parameters = parameterSchemaSpecToJsonSchema(options.parameters)
  const userExecute = options.execute
  const userRender = options.output.render
  const userPresentCall = options.presentCall
  const tool: ToolDescriptor = {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: valueSchemaSpecToJsonSchema(options.output.schema),
      render: (args, value) => userRender(args, value),
    },
    async execute(args, exec) {
      const violations = validateJsonSchemaValue(parameters, args ?? {}, '')
      if (violations.length > 0) throw new ToolArgsError(violations)
      return userExecute(args ?? {}, exec)
    },
    ...(userPresentCall !== undefined
      ? {
          presentCall(args: unknown) {
            if (validateJsonSchemaValue(parameters, args ?? {}, '').length > 0) return undefined
            return userPresentCall(args)
          },
        }
      : {}),
  }
  return tool
}
