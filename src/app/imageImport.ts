const MAX_SIDE = 1600
import { t } from '../i18n'
const MAX_DATA_URL_LENGTH = 1_500_000

export interface ImportedImage {
  readonly src: string
  readonly width: number
  readonly height: number
}

export async function importImageFile(file: File): Promise<ImportedImage> {
  if (!file.type.startsWith('image/')) throw new Error(t('이미지 파일을 선택해 주세요.'))
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error(t('이미지를 처리할 수 없습니다.'))
    context.drawImage(bitmap, 0, 0, width, height)
    let src = canvas.toDataURL('image/webp', 0.82)
    if (!src.startsWith('data:image/webp;')) src = canvas.toDataURL('image/jpeg', 0.82)
    if (src.length > MAX_DATA_URL_LENGTH) throw new Error(t('이미지가 너무 커서 저장할 수 없습니다.'))
    return { src, width, height }
  } finally {
    bitmap.close()
  }
}
