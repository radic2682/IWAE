import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Bug, Camera, X } from '@phosphor-icons/react'
import { captureWindowPng, copyCaptureToClipboard, copyText, readAppLogTail, saveCapturePng, saveReportFile } from '../bridge/support'
import { isDesktop } from '../bridge/window'
import { requestExternalLink } from '../bridge/external'
import { recordedErrors } from '../core/errorBuffer'
import { issueClipboardPlan, screenCaptureSupported } from '../core/reportCapture'
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
  const [hidden, setHidden] = useState(false)
  const [capture, setCapture] = useState<{ readonly png: Uint8Array; readonly url: string } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const captureUrlRef = useRef<string | null>(null)
  const canCapture = useMemo(() => screenCaptureSupported(isDesktop(), navigator.userAgent, navigator.platform), [])
  const errors = useMemo(() => recordedErrors(), [])

  useEffect(() => { textRef.current?.focus() }, [])
  useEffect(() => () => { if (captureUrlRef.current !== null) URL.revokeObjectURL(captureUrlRef.current) }, [])
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

  const takeCapture = async () => {
    if (capturing) return
    setCapturing(true)
    setMessage(null)
    try {
      // 이 대화상자가 사진에 찍히지 않게 숨기고, 화면이 다시 그려진 뒤에 찍는다
      flushSync(() => setHidden(true))
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      await new Promise<void>((resolve) => setTimeout(resolve, 60))
      let png: Uint8Array
      try {
        png = await captureWindowPng()
      } finally {
        setHidden(false)
      }
      if (captureUrlRef.current !== null) URL.revokeObjectURL(captureUrlRef.current)
      const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
      captureUrlRef.current = url
      setCapture({ png, url })
      try {
        await copyCaptureToClipboard()
        setMessage(t('화면을 찍어 클립보드에 복사했습니다.'))
      } catch {
        setMessage(t('화면은 찍었지만 클립보드에 복사하지 못했습니다. 「클립보드에 복사」를 다시 눌러 보세요.'))
      }
    } catch {
      setMessage(t('화면을 찍지 못했습니다.'))
    } finally {
      setCapturing(false)
    }
  }

  const recopyCapture = async () => {
    try {
      await copyCaptureToClipboard()
      setMessage(t('사진을 클립보드에 복사했습니다. 이슈 본문에 Ctrl+V 로 붙여 넣으세요.'))
    } catch {
      setMessage(t('클립보드에 복사하지 못했습니다.'))
    }
  }

  const saveCapture = async () => {
    if (capture === null) return
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const path = await saveCapturePng(`iwae-screenshot-${stamp}.png`, capture.png)
      if (path !== null) setMessage(t('PNG 파일로 저장했습니다.'))
    } catch {
      setMessage(t('파일을 저장하지 못했습니다.'))
    }
  }

  const openIssue = async () => {
    const link = buildIssueUrl(report, input)
    const plan = issueClipboardPlan(link.needsPaste, capture !== null)
    if (plan !== 'leave') {
      try {
        await copyText(report.body)
        setMessage(plan === 'copy-text-then-recopy-image'
          ? t('기록이 길어 본문을 클립보드에 복사했습니다. 이슈에 먼저 붙여 넣고, 사진은 「클립보드에 복사」를 다시 눌러 붙이세요.')
          : t('기록이 길어 클립보드에 복사했습니다. 열린 이슈 본문에 붙여 넣으세요.'))
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
      className={hidden ? 'side-dialog-backdrop report-capturing' : 'side-dialog-backdrop'}
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

          {canCapture ? (
            <section className="report-capture" aria-label={t('화면 캡처 첨부')}>
              <div className="report-capture-head">
                <span className="report-capture-title">{t('화면 캡처 첨부')}</span>
                <button type="button" className="side-dialog-secondary report-capture-button" disabled={capturing} onClick={() => { void takeCapture() }}>
                  <Camera size={14} aria-hidden="true" />
                  {capture === null ? t('화면 캡처') : t('다시 캡처')}
                </button>
              </div>
              {capture === null ? null : (
                <div className="report-capture-result">
                  <img className="report-capture-thumb" src={capture.url} alt={t('캡처한 화면 미리 보기')} />
                  <div className="report-capture-actions">
                    <button type="button" className="side-dialog-secondary" onClick={() => { void recopyCapture() }}>{t('클립보드에 복사')}</button>
                    <button type="button" className="side-dialog-secondary" onClick={() => { void saveCapture() }}>{t('PNG로 저장')}</button>
                  </div>
                </div>
              )}
              <p className="report-note">{t('GitHub 이슈 본문에 Ctrl+V 로 붙여 넣으면 사진이 첨부됩니다.')}</p>
              <p className="report-note">{t('캡처에는 열어 둔 문서 내용이 보일 수 있습니다. 붙여 넣기 전에는 어디로도 보내지 않습니다.')}</p>
            </section>
          ) : null}

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
