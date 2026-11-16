import { File, FileCode, FileHtml, FileMd, FilePdf, FileTxt } from '@phosphor-icons/react'
import { documentFormatOf, type DocumentFormat } from '../../core/documentFormat'

/** 형식마다 파일 아이콘 하나: 목록·검색·최근 문서·명령 팔레트가 같은 아이콘을 쓰게 한다 */
export function DocumentFormatIcon({ format, path, size = 14, className }: {
  /** 형식을 바로 주거나, 경로로 알아낸다(둘 다 없거나 모르는 확장자면 빈 파일 아이콘) */
  readonly format?: DocumentFormat | null
  readonly path?: string
  readonly size?: number
  readonly className?: string
}) {
  const resolved = format ?? (path === undefined ? null : documentFormatOf(path))
  const props = { size, className, 'aria-hidden': true as const }
  switch (resolved) {
    case 'pdf': return <FilePdf {...props} />
    case 'markdown': return <FileMd {...props} />
    case 'text': return <FileTxt {...props} />
    case 'html': return <FileHtml {...props} />
    case 'xml': return <FileCode {...props} />
    default: return <File {...props} />
  }
}
