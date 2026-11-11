import { op, type McpAppDeps, type OpContext, type OpDef } from './types'

const TEXT_LIMIT = 4000

function needApp(ctx: OpContext): McpAppDeps {
  if (ctx.deps.app === undefined) throw new Error('app UI not available (번역을 쓸 수 없습니다).')
  return ctx.deps.app
}

const isExternal = (app: McpAppDeps) => app.translation.executionMode === 'external-api'
const providerOf = (app: McpAppDeps) => (isExternal(app) ? app.translation.externalProvider : 'local')

/** 키·주소는 돌려주지 않는다 */
const translationStatus = (_args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  return {
    mode: !app.translation.enabled ? 'off' : isExternal(app) ? 'external' : 'local',
    provider: providerOf(app),
    external: isExternal(app),
    ready: app.translation.enabled && app.translation.ready,
  }
}

const translateText = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.text !== 'string' || args.text.trim() === '') throw new Error('text 가 필요합니다.')
  if (args.text.length > TEXT_LIMIT) throw new Error(`text 는 ${TEXT_LIMIT}자 이하여야 합니다.`)
  if (!app.translation.enabled) throw new Error('translation is turned off in the app settings (번역이 꺼져 있습니다).')
  if (isExternal(app) && args.allow_external !== true) {
    throw new Error(`The translation provider is external (${app.translation.externalProvider}): the text would leave this computer. Refused. Only the user may approve this: ask them, then call again with allow_external:true.`)
  }
  const source = typeof args.source === 'string' && args.source !== '' ? args.source : undefined
  const target = typeof args.target === 'string' && args.target !== '' ? args.target : app.translation.targetLanguage
  const translation = await app.translation.translate(args.text, source, target)
  return { translation, provider: providerOf(app), source: source ?? 'auto', target, external: isExternal(app) }
}

export const translateOps: Record<string, OpDef> = {
  translate_text: op('read', translateText),
  translation_status: op('read', translationStatus),
}
