import { useEffect, useState } from 'react'
import { Printer, X } from '@phosphor-icons/react'
import { parsePageRange } from '../core/printRange'
import { pageImageUrl } from '../bridge/pdf'
import { t } from '../i18n'
import { paperSizeMm, readPrintOptions, resolveOrientation, writePrintOptions, type PrintOptions, type PrintOrientation, type PrintPaper } from './pdfPrint'

interface PdfPrintDialogProps {
  readonly pageCount: number
  /** 지금 보는 쪽(1-기반) */
  readonly page: number
  /** 미리보기용. 없으면 미리보기를 그리지 않는다 */
  readonly docId?: string
  readonly pageSizes?: readonly (readonly [number, number])[]
  readonly onPrint: (pages: number[], options: PrintOptions) => void
  readonly onClose: () => void
}

type Scope = 'all' | 'current' | 'range'

const MARGIN_PRESETS: readonly { readonly label: string; readonly mm: number }[] = [
  { label: '없음', mm: 0 },
  { label: '좁게', mm: 5 },
  { label: '보통', mm: 10 },
  { label: '넓게', mm: 20 },
]
/** 미리보기 용지 긴 변 px */
const PREVIEW_LONG = 200

/**
 * 인쇄 범위·용지 방향·여백(네 방향 같게)을 고르는 창. 왼쪽 미리보기가 고른 첫 쪽을 용지 위에 그 여백으로 보여 준다.
 * 프린터·용지 크기는 다음에 뜨는 시스템 인쇄 창에서 고른다. 방향·여백은 다음에도 기억한다.
 */
export function PdfPrintDialog({ pageCount, page, docId, pageSizes, onPrint, onClose }: PdfPrintDialogProps) {
  const [scope, setScope] = useState<Scope>('all')
  const [rangeText, setRangeText] = useState(`${page}-${Math.min(page + 4, pageCount)}`)
  const [options, setOptions] = useState<PrintOptions>(readPrintOptions)
  const ranged = parsePageRange(rangeText, pageCount)
  const pages = scope === 'all'
    ? Array.from({ length: pageCount }, (_, index) => index)
    : scope === 'current' ? [page - 1] : ranged
  const canPrint = pages !== null && pages.length > 0
  const print = () => {
    if (pages === null || pages.length === 0) return
    writePrintOptions(options)
    onPrint(pages, options)
  }
  // Esc 로 닫고, Enter 로 인쇄한다(창 안에 포커스가 없어도). 매번 새 값을 보도록 그릴 때마다 다시 단다
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        print()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const setOption = (patch: Partial<PrintOptions>) => setOptions((current) => ({ ...current, ...patch }))

  // 미리보기: 고른 첫 쪽을 용지 위, 여백 안 가운데에
  const firstPage = pages?.[0] ?? page - 1
  const orientation = resolveOrientation(options.orientation, pageSizes?.[firstPage])
  const [paperW, paperH] = paperSizeMm(options.paper, orientation)
  const scale = PREVIEW_LONG / Math.max(paperW, paperH)
  const paper = { width: paperW * scale, height: paperH * scale }
  const marginPx = options.marginMm * scale

  return (
    <div className="pdf-print-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="pdf-print-dialog" role="dialog" aria-modal="true" aria-label={t('인쇄')}>
        <header>
          <h2>{t('인쇄')}</h2>
          <button type="button" className="pdf-print-close" aria-label={t('인쇄 닫기')} onClick={onClose}><X size={16} aria-hidden="true" /></button>
        </header>
        <div className="pdf-print-body">
          {docId === undefined ? null : (
            <figure className="pdf-print-preview" aria-label={t('인쇄 미리보기')}>
              <div className="pdf-print-paper" style={{ width: `${paper.width}px`, height: `${paper.height}px`, padding: `${marginPx}px` }}>
                <div className="pdf-print-area">
                  <img src={pageImageUrl(docId, firstPage, 480)} alt="" />
                </div>
              </div>
              <figcaption>{pages === null ? t('쪽 번호를 확인해 주세요') : `${pages.length > 1 ? t('{page}쪽 외 {more}쪽', { page: firstPage + 1, more: pages.length - 1 }) : t('{page}쪽', { page: firstPage + 1 })} · ${options.paper} ${orientation === 'landscape' ? t('가로') : t('세로')} · ${t('여백 {mm}mm', { mm: options.marginMm })}`}</figcaption>
            </figure>
          )}
          <div className="pdf-print-options">
            <div className="pdf-print-field">
              <span className="pdf-print-label" id="pdf-print-scope-label">{t('범위')}</span>
              <div className="pdf-print-segments" role="radiogroup" aria-labelledby="pdf-print-scope-label">
                <button type="button" role="radio" aria-checked={scope === 'all'} onClick={() => setScope('all')}>{t('전체 {count}쪽', { count: pageCount })}</button>
                <button type="button" role="radio" aria-checked={scope === 'current'} onClick={() => setScope('current')}>{t('지금 쪽 ({page})', { page })}</button>
                <button type="button" role="radio" aria-checked={scope === 'range'} onClick={() => setScope('range')}>{t('쪽 지정')}</button>
              </div>
              {scope === 'range' ? (
                <input
                  type="text"
                  className="pdf-print-range"
                  aria-label={t('인쇄할 쪽')}
                  value={rangeText}
                  placeholder="1-5, 8, 10-"
                  autoFocus
                  onChange={(event) => setRangeText(event.target.value)}
                />
              ) : null}
              {scope === 'range' && ranged === null ? <p className="pdf-print-error" role="alert">{t('쪽 번호를 1-5, 8 처럼 적어 주세요')}</p> : null}
            </div>
            <div className="pdf-print-field">
              <span className="pdf-print-label" id="pdf-print-paper-label">{t('용지')}</span>
              <div className="pdf-print-segments" role="radiogroup" aria-labelledby="pdf-print-paper-label">
                {(['A4', 'Letter', 'A3'] as const).map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={options.paper === value} onClick={() => setOption({ paper: value as PrintPaper })}>{value}</button>
                ))}
              </div>
            </div>
            <div className="pdf-print-field">
              <span className="pdf-print-label" id="pdf-print-orientation-label">{t('방향')}</span>
              <div className="pdf-print-segments" role="radiogroup" aria-labelledby="pdf-print-orientation-label">
                {([['auto', '자동'], ['portrait', '세로'], ['landscape', '가로']] as const).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={options.orientation === value} onClick={() => setOption({ orientation: value as PrintOrientation })}>{t(label)}</button>
                ))}
              </div>
            </div>
            <div className="pdf-print-field">
              <span className="pdf-print-label" id="pdf-print-margin-label">{t('여백 (위·아래·왼쪽·오른쪽 같게)')}</span>
              <div className="pdf-print-segments" role="radiogroup" aria-labelledby="pdf-print-margin-label">
                {MARGIN_PRESETS.map((preset) => (
                  <button key={preset.mm} type="button" role="radio" aria-checked={options.marginMm === preset.mm} onClick={() => setOption({ marginMm: preset.mm })}>{t(preset.label)}</button>
                ))}
                <label className="pdf-print-mm">
                  <input
                    type="number"
                    min={0}
                    max={40}
                    step={1}
                    aria-label={t('여백 mm')}
                    value={options.marginMm}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) setOption({ marginMm: Math.min(Math.max(Math.round(value), 0), 40) })
                    }}
                  />
                  mm
                </label>
              </div>
            </div>
          </div>
        </div>
        <footer>
          <span className="pdf-print-hint">{t('프린터는 다음 창에서 고릅니다')}</span>
          <button type="button" onClick={onClose}>{t('취소')}</button>
          <button type="button" className="pdf-print-go" disabled={!canPrint} onClick={print}>
            <Printer size={15} aria-hidden="true" />
            {pages === null ? t('인쇄') : t('인쇄 ({count}쪽)', { count: pages.length })}
          </button>
        </footer>
      </section>
    </div>
  )
}
