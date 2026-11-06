import {
  parseCanvasBlock,
  type ArrowCanvasBlock,
  type CanvasBlockData,
  type ShapeCanvasBlock,
  type TextCanvasBlock,
} from './canvasDocument'
import { t } from '../i18n'

export type PresettableCanvasBlock = TextCanvasBlock | ShapeCanvasBlock | ArrowCanvasBlock

export interface UserBlockPreset {
  readonly id: string
  readonly name: string
  readonly block: PresettableCanvasBlock
}

interface UserBlockPresetFile {
  readonly version: 1
  readonly presets: readonly UserBlockPreset[]
}

const KIND_LABELS: Readonly<Record<PresettableCanvasBlock['kind'], string>> = {
  title: '제목',
  paragraph: '본문',
  code: '코드',
  rectangle: '사각형',
  square: '정사각형',
  ellipse: '타원',
  diamond: '마름모',
  arrow: '화살표',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPresettableCanvasBlock(block: CanvasBlockData): block is PresettableCanvasBlock {
  return block.kind !== 'pdfExcerpt' && block.kind !== 'markdownExcerpt' && block.kind !== 'translation' && block.kind !== 'image'
}

export function createUserBlockPreset(
  id: string,
  block: CanvasBlockData,
  existing: readonly UserBlockPreset[],
): UserBlockPreset {
  if (!isPresettableCanvasBlock(block)) throw new Error(t('출처에 종속된 블록은 프리셋으로 저장할 수 없습니다.'))
  const sequence = existing.filter((preset) => preset.block.kind === block.kind).length + 1
  return {
    id,
    name: `${t(KIND_LABELS[block.kind])} ${sequence}`,
    block: structuredClone(block),
  }
}

export function parseUserBlockPresets(raw: unknown): UserBlockPreset[] {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.presets)) {
    throw new Error(t('블록 프리셋 형식을 읽을 수 없습니다.'))
  }
  const ids = new Set<string>()
  const presets: UserBlockPreset[] = []
  for (const value of raw.presets) {
    if (!isRecord(value)
      || typeof value.id !== 'string'
      || value.id.length === 0
      || typeof value.name !== 'string'
      || value.name.length === 0
      || ids.has(value.id)) continue
    try {
      const block = parseCanvasBlock(value.block)
      if (!isPresettableCanvasBlock(block)) continue
      ids.add(value.id)
      presets.push({ id: value.id, name: value.name, block })
    } catch {
      continue
    }
  }
  return presets
}

export function userBlockPresetFile(presets: readonly UserBlockPreset[]): UserBlockPresetFile {
  return { version: 1, presets: structuredClone(presets) }
}
