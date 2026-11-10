import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bug, X } from '@phosphor-icons/react'
import { copyText, readAppLogTail, saveReportFile } from '../bridge/support'
import { requestExternalLink } from '../bridge/external'
import { recordedErrors } from '../core/errorBuffer'
import { buildIssueUrl, buildReport, osLabel } from '../core/supportReport'
import { t } from '../i18n'
import { announceAction } from './actionFeedback'
import '../ui/sidebar-dialog.css'
import '../ui/report-problem.css'

interface ReportProblemDialogProps {
  readonly version: string
  readonly vaultRoot: string | null
  readonly onClose: () => void
}

/**
 * 문제 보고. 아무것도 자동으로 보내지 않는다: 가려진 내용을 미리 보여 주고,
 * 사용자가 「GitHub 이슈로 열기」(브라우저로 이동) 또는 「파일로 저장」을 눌러야 밖으로 나간다.
 */
export function ReportProblemDialog({ version, vaultRoot, onClose }: ReportProblemDialogProps) {
  const [description, setDescription] = useState('')
  const [includeLogs, setIncludeLogs] = useState(true)
  const [logLines, setLogLines] = useState<readonly string[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const errors = useMemo(() => recordedErrors(), [])

  useEffect(() => { textRef.current?.focus() }, [])
  useEffect(() => {
    let active = true
    void readAppLogTail(200).then((lines) => { if (active) setLogLines(lines) }, () => { if (active) setLogLines([]) })
    return () => { active = false }
  }, [])

  const input = useMemo(() => ({
    description,
    appVersion: version,
    os: osLabel(navigator.userAgent, navigator.platform),
    includeLogs,
    logLines: logLines ?? [],
    errors,
    vaultRoot,
  }), [description, version, includeLogs, logLines, errors, vaultRoot])
  const report = useMemo(() => buildReport(input), [input])
  const shownLines = Math.min(logLines?.length ?? 0, 120)

  const openIssue = async () => {
    const link = buildIssueUrl(report, input)
    if (link.needsPaste) {
      try {
        await copyText(report.body)
        setMessage(t('기록이 길어 클립보드에 복사했습니다. 열린 이슈 본문에 붙여 넣으세요.'))
      } catch {
        setMessage(t('기록이 길어 주소에 담지 못했습니다. 「파일로 저장」으로 저장해 이슈에 첨부하세요.'))
      }
    }
    requestExternalLink(link.url)
  }

  const saveFile = async () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const path = await saveReportFile(`iwae-report-${stamp}.txt`, report.body)
      if (path !== null) {
        announceAction(t('보고서를 저장했습니다'))
        onClose()
      }
    } catch {
      setMessage(t('파일을 저장하지 못했습니다.'))
    }
  }

  return createPortal(
    <div
      className="side-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        className="side-dialog report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('문제 보고')}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <div className="side-dialog-head">
          <span className="side-dialog-icon"><Bug size={18} aria-hidden="true" /></span>
          <div className="side-dialog-titles">
            <h2>{t('문제 보고')}</h2>
            <p>{t('아무것도 자동으로 보내지 않습니다. 아래 내용을 확인하고 직접 내세요.')}</p>
          </div>
          <button type="button" className="side-dialog-close" aria-label={t('닫기')} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="report-body">
          <label className="side-dialog-field">
            {t('무슨 문제인가요?')}
            <textarea
              ref={textRef}
              className="report-description"
              rows={3}
              value={description}
              placeholder={t('예: PDF 를 열면 멈춥니다. 어떻게 하면 생기는지 적어 주세요.')}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </label>

          <label className="report-check">
            <input type="checkbox" checked={includeLogs} onChange={(event) => setIncludeLogs(event.currentTarget.checked)} />
            <span>{t('앱 기록(로그) 첨부')}</span>
          </label>

          <ul className="report-included" aria-label={t('포함되는 내용')}>
            <li>{t('앱 버전: {version}', { version })}</li>
            <li>{t('운영체제: {os}', { os: input.os })}</li>
            {includeLogs ? <li>{t('최근 앱 기록 {count}줄 · 화면 오류 {errors}건', { count: logLines === null ? 0 : shownLines, errors: errors.length })}</li> : null}
          </ul>
          <p className="report-note">
            {t('문서 내용·키·토큰은 담지 않습니다. 폴더 경로와 파일 이름은 <path>, <file> 같은 자리표시자로 바뀝니다.')}
          </p>

          <div className="report-preview-head">{t('보내질 내용 미리 보기')}</div>
          <pre className="report-preview" tabIndex={0} aria-label={t('보내질 내용 미리 보기')}>{report.body}</pre>

          {message === null ? null : <p className="report-message" role="status">{message}</p>}
        </div>
        <div className="side-dialog-foot report-actions">
          <button type="button" className="side-dialog-secondary" onClick={() => { void saveFile() }}>{t('파일로 저장')}</button>
          <button type="button" className="side-dialog-primary" onClick={() => { void openIssue() }}>{t('GitHub 이슈로 열기')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
