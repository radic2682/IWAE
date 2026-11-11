import { isValidSourceTarget, normalizeSourceTarget, type DocSource } from '../../core/docSources'
import { t } from '../../i18n'
import { recordUndo } from '../undoStack'
import { op, type McpDeps, type OpContext, type OpDef } from './types'

type Sources = NonNullable<McpDeps['docSources']>

function requireSources(ctx: OpContext): Sources {
  if (ctx.deps.docSources === undefined) throw new Error('문서 출처를 다룰 수 없습니다(Vault 가 열려 있지 않습니다).')
  return ctx.deps.docSources
}

const sourceList = (args: Record<string, unknown>, ctx: OpContext) => {
  const store = requireSources(ctx)
  const docId = typeof args.doc_id === 'string' ? args.doc_id : undefined
  const entries = Object.entries(store.all()).filter(([id]) => docId === undefined || id === docId)
  return {
    documents: entries.map(([id, list]) => ({ doc_id: id, sources: list })),
    sources: entries.flatMap(([id, list]) => list.map((source) => ({ doc_id: id, ...source }))),
  }
}

const sourceAdd = (args: Record<string, unknown>, ctx: OpContext) => {
  const store = requireSources(ctx)
  if (typeof args.doc_id !== 'string') throw new Error('doc_id 가 필요합니다.')
  const docId = args.doc_id
  if (!Array.isArray(args.sources) || args.sources.length === 0) throw new Error('sources 배열이 필요합니다.')
  const added: string[] = []
  const skipped: { target: string; reason: string }[] = []
  for (const input of args.sources as Record<string, unknown>[]) {
    const target = typeof input.target === 'string' ? normalizeSourceTarget(input.target) : ''
    if (!isValidSourceTarget(target)) { skipped.push({ target, reason: '주소(https://…)나 경로가 올바르지 않습니다.' }); continue }
    const before = (store.all()[docId] ?? []).map((item) => item.id)
    const ok = store.add(docId, { target, label: typeof input.label === 'string' ? input.label : '', note: typeof input.note === 'string' ? input.note : '' })
    if (!ok) { skipped.push({ target, reason: '이미 있습니다.' }); continue }
    added.push(target)
    const made = (store.all()[docId] ?? []).find((item) => !before.includes(item.id))
    if (made !== undefined) {
      const snapshot = made
      let currentId = made.id
      recordUndo({
        key: `source:${docId}:${snapshot.id}`,
        undo: () => store.remove(docId, currentId),
        redo: () => {
          const again = store.all()[docId]?.length ?? 0
          store.add(docId, { target: snapshot.target, label: snapshot.label, note: snapshot.note })
          const list = store.all()[docId] ?? []
          if (list.length > again) currentId = list[list.length - 1]!.id
        },
      })
    }
  }
  ctx.change.target = docId
  ctx.change.count += added.length
  ctx.change.summary = t('출처 {count}개 추가', { count: added.length })
  return { added, ...(skipped.length > 0 ? { skipped } : {}) }
}

const sourceUpdate = (args: Record<string, unknown>, ctx: OpContext) => {
  const store = requireSources(ctx)
  if (typeof args.doc_id !== 'string' || typeof args.id !== 'string') throw new Error('doc_id 와 id 가 필요합니다.')
  const docId = args.doc_id
  const id = args.id
  const previous = (store.all()[docId] ?? []).find((item) => item.id === id)
  if (previous === undefined) throw new Error(`없는 출처입니다: ${id}`)
  const target = typeof args.target === 'string' ? normalizeSourceTarget(args.target) : undefined
  if (target !== undefined && !isValidSourceTarget(target)) throw new Error('target 이 올바르지 않습니다.')
  const patch = {
    ...(target === undefined ? {} : { target }),
    ...(typeof args.label === 'string' ? { label: args.label } : {}),
    ...(typeof args.note === 'string' ? { note: args.note } : {}),
  }
  store.update(docId, id, patch)
  recordUndo({
    key: `source:${docId}:${id}`,
    undo: () => store.update(docId, id, { target: previous.target, label: previous.label, note: previous.note }),
    redo: () => store.update(docId, id, patch),
  })
  ctx.change.target = docId
  ctx.change.count += 1
  ctx.change.summary = t('출처 고침')
  return { updated: id }
}

const sourceRemove = (args: Record<string, unknown>, ctx: OpContext) => {
  const store = requireSources(ctx)
  if (typeof args.doc_id !== 'string' || !Array.isArray(args.ids)) throw new Error('doc_id 와 ids 배열이 필요합니다.')
  const docId = args.doc_id
  const have = new Map<string, DocSource>((store.all()[docId] ?? []).map((item) => [item.id, item]))
  const removed = (args.ids as unknown[]).filter((id): id is string => typeof id === 'string' && have.has(id))
  for (const id of removed) {
    const snapshot = have.get(id)!
    store.remove(docId, id)
    // 지운 출처는 기록에 남기고, 되돌리면 같은 내용으로 다시 단다(id 는 새로 붙는다)
    recordUndo({
      key: `source:${docId}:${id}`,
      undo: () => { store.add(docId, { target: snapshot.target, label: snapshot.label, note: snapshot.note }) },
      redo: () => {
        const again = (store.all()[docId] ?? []).find((item) => item.target === snapshot.target)
        if (again !== undefined) store.remove(docId, again.id)
      },
    })
  }
  ctx.change.target = docId
  ctx.change.count += removed.length
  ctx.change.summary = t('출처 {count}개 뺌', { count: removed.length })
  return { removed, note: 'Soft delete: ai_undo restores them.' }
}

export const sourceOps: Record<string, OpDef> = {
  source_list: op('read', sourceList),
  source_add: op('write', sourceAdd),
  source_update: op('write', sourceUpdate),
  source_remove: op('write', sourceRemove),
}
