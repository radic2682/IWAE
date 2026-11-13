import { TextT } from '@phosphor-icons/react'
import { runAppCommand } from '../ui/documentContextMenu'
import { usePdfToolJob } from './pdfToolJobs'
import { t } from '../i18n'
import '../ui/pdf-tools.css'

/**
 * 글자 층이 없는 PDF 의 오른쪽 아래 표시. 누르면 OCR 로 원본에 글자를 입힌다(백업은 남는다).
 * 하는 동안에는 같은 자리에 진행이 보인다.
 */
export function ScanBadge({ docId }: { readonly docId: string }) {
  const job = usePdfToolJob(docId)
  if (job !== undefined) {
    return (
      <button type="button" className="pdf-scan pdf-scan-action" disabled aria-live="polite">
        <span>{t(job.label)}{job.total > 0 ? ` ${job.done}/${job.total}` : ''}</span>
        {job.total > 0 ? <span className="pdf-scan-meter" aria-hidden="true"><span style={{ width: `${(job.done / job.total) * 100}%` }} /></span> : null}
      </button>
    )
  }
  return (
    <button
      type="button"
      className="pdf-scan pdf-scan-action"
      title={t('스캔 쪽을 이 PC에서 읽어 보이지 않는 글자로 입힙니다. 글자 선택, 검색, 형광펜을 쓸 수 있고 원본은 백업됩니다.')}
      onClick={() => runAppCommand('ocrDocument', { docId })}
    >
      <span>{t('스캔본 · 텍스트 없음')}</span>
      <span className="pdf-scan-cta"><TextT size={12} weight="bold" aria-hidden="true" />{t('OCR 실행')}</span>
    </button>
  )
}
