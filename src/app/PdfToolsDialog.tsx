import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowSquareOut, ArrowsClockwise, ArrowsInSimple, Broom, Copy, Crop, Eraser, FileImage, FileText, GitDiff, Hash, LockOpen, MagnifyingGlass, Rectangle, Scissors, SquaresFour, Stack, Stamp, TextT, Toolbox, X,
} from '@phosphor-icons/react'
import type { PdfToolOp } from '../bridge/pdf'
import { formatBytes } from '../bridge/vaultBackup'
import { chapterRanges, parsePageRanges, type FlattenChoice, type FlattenCounts } from '../core/pdfToolOps'
import type { DiffHunk } from '../core/pdfTextDiff'
import { errorText } from '../core/errorText'
import { usePdfToolJob } from '../pdf/pdfToolJobs'
import { t } from '../i18n'
import '../ui/pdf-tools.css'

export type PdfToolId =
  | 'ocr' | 'compare'
  | 'flatten' | 'redact'
  | 'extract' | 'split' | 'merge' | 'blanks' | 'orient'
  | 'numbers' | 'watermark' | 'crop' | 'nup' | 'compress'
  | 'images' | 'markdown' | 'unlock'

/** 도구 창이 App 에 부탁하는 일. 모두 끝나면 사람에게 보일 한 줄을 돌려준다 */
export interface PdfToolActions {
  /** 글자 없는 쪽을 OCR 해 원본에 글자 층을 입힌다 */
  readonly ocr: () => Promise<string>
  /** 원본에 적용(백업을 남긴다) */
  readonly applyInPlace: (op: PdfToolOp) => Promise<string>
  /** 원본 옆 새 PDF. 만든 파일 경로 */
  readonly saveCopy: (op: PdfToolOp, suffix: string, folder?: string) => Promise<string>
  /** 그림을 줄인 새 PDF 를 원본 옆에 만든다. 만든 경로와 전·후 크기. 줄지 않으면 만들지 않고 던진다 */
  readonly compress: (maxDpi: number, quality: number) => Promise<{ readonly path: string; readonly sizeBefore: number; readonly sizeAfter: number }>
  /** 쪽 빼기(쪽 편집과 같다: 형광펜·메모가 따라 옮겨진다) */
  readonly removePages: (pages: readonly number[]) => Promise<string>
  readonly findBlankPages: () => Promise<number[]>
  /** 글자 없는 스캔 쪽 가운데 옆으로 눕거나 거꾸로 선 쪽을 읽어 가려 돌린다. 사람에게 보일 한 줄 */
  readonly fixOrientation: () => Promise<string>
  readonly exportImages: (dpi: number) => Promise<string>
  readonly exportMarkdown: () => Promise<string>
  /** 다른 PDF 와 글자 비교 */
  readonly compare: (otherDocId: string) => Promise<{ hunks: readonly DiffHunk[]; truncated: boolean }>
  /** 방금 만든 파일 열기 */
  readonly openPath: (path: string) => void
  /** 그 문서의 그 쪽으로 가기 */
  readonly jump: (docId: string, page: number) => void
  /** 가리기 도구를 켠다(도구 창은 닫는다) */
  readonly startRedactTool: () => void
}

export interface PdfToolsDialogProps {
  readonly docId: string
  readonly title: string
  readonly pageCount: number
  readonly hasText: boolean
  /** 암호로 연 PDF 인가(암호 풀기를 보인다) */
  readonly passwordProtected: boolean
  readonly outline: readonly { readonly title: string; readonly page: number | null; readonly depth: number }[]
  /** 합치기·비교에 고를 다른 PDF(같은 버전 묶음이 앞) */
  readonly otherPdfs: readonly { readonly docId: string; readonly title: string; readonly path: string; readonly sibling?: boolean }[]
  readonly marks: FlattenCounts
  readonly buildFlatten: (choice: FlattenChoice) => PdfToolOp
  readonly initialTool?: PdfToolId
  readonly actions: PdfToolActions
  readonly onClose: () => void
}

interface ToolInfo { readonly id: PdfToolId; readonly label: string; readonly icon: ReactNode }
const GROUPS: readonly { readonly title: string; readonly tools: readonly ToolInfo[] }[] = [
  { title: '글자', tools: [
    { id: 'ocr', label: 'OCR 로 글자 입히기', icon: <TextT size={16} /> },
    { id: 'compare', label: '다른 판과 글자 비교', icon: <GitDiff size={16} /> },
  ] },
  { title: '내 표시', tools: [
    { id: 'flatten', label: '표시 넣은 사본', icon: <Stamp size={16} /> },
    { id: 'redact', label: '가린 사본', icon: <Rectangle size={16} weight="fill" /> },
  ] },
  { title: '쪽', tools: [
    { id: 'extract', label: '쪽 뽑아 새 PDF', icon: <Copy size={16} /> },
    { id: 'split', label: '목차 단위로 나누기', icon: <Scissors size={16} /> },
    { id: 'merge', label: '다른 PDF 와 합치기', icon: <Stack size={16} /> },
    { id: 'blanks', label: '빈 쪽 빼기', icon: <Broom size={16} /> },
    { id: 'orient', label: '스캔 쪽 방향 바로잡기', icon: <ArrowsClockwise size={16} /> },
  ] },
  { title: '모양', tools: [
    { id: 'numbers', label: '쪽 번호 넣기', icon: <Hash size={16} /> },
    { id: 'watermark', label: '워터마크', icon: <Stamp size={16} weight="duotone" /> },
    { id: 'crop', label: '여백 자르기', icon: <Crop size={16} /> },
    { id: 'nup', label: '모아찍기', icon: <SquaresFour size={16} /> },
    { id: 'compress', label: '압축', icon: <ArrowsInSimple size={16} /> },
  ] },
  { title: '내보내기', tools: [
    { id: 'images', label: '쪽 그림(PNG)으로', icon: <FileImage size={16} /> },
    { id: 'markdown', label: '글을 Markdown 으로', icon: <FileText size={16} /> },
    { id: 'unlock', label: '암호 푼 사본', icon: <LockOpen size={16} /> },
  ] },
]

const MM = 72 / 25.4

type Status = { readonly kind: 'idle' } | { readonly kind: 'busy'; readonly text: string } | { readonly kind: 'done'; readonly text: string; readonly path?: string } | { readonly kind: 'error'; readonly text: string }

/**
 * PDF 도구 창. 왼쪽에서 도구를 고르고 오른쪽에서 고른 뒤 실행한다.
 * 원본에 적용하는 도구는 늘 덮기 전 원본을 .iwae/history/pdf-edits 에 남기고, 사본을 만드는 도구는 원본 옆에 새 PDF 를 둔다.
 */
export function PdfToolsDialog(props: PdfToolsDialogProps) {
  const { docId, title, onClose, initialTool } = props
  const [tool, setTool] = useState<PdfToolId>(initialTool ?? (props.hasText ? 'flatten' : 'ocr'))
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const job = usePdfToolJob(docId)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { dialogRef.current?.focus() }, [])
  useEffect(() => setStatus({ kind: 'idle' }), [tool])

  const run = async (busyText: string, work: () => Promise<string | { text: string; path?: string }>) => {
    setStatus({ kind: 'busy', text: busyText })
    try {
      const result = await work()
      setStatus(typeof result === 'string' ? { kind: 'done', text: result } : { kind: 'done', ...result })
    } catch (cause) {
      setStatus({ kind: 'error', text: errorText(cause) })
    }
  }
  const busy = status.kind === 'busy' || job !== undefined
  // 작업 중 눌렀던 단추가 잠겨 포커스를 잃으면 Esc 가 안 먹으므로, 끝나면 창으로 되돌린다
  useEffect(() => {
    if (!busy && document.activeElement === document.body) dialogRef.current?.focus()
  }, [busy])
  const info = GROUPS.flatMap((group) => group.tools).find((item) => item.id === tool)!

  return (
    <div className="pdf-tools-backdrop" onClick={busy ? undefined : onClose}>
      <div
        ref={dialogRef}
        className="pdf-tools"
        role="dialog"
        aria-modal="true"
        aria-label={t('PDF 도구 — {title}', { title })}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || busy) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <header className="pdf-tools-head">
          <Toolbox size={17} aria-hidden="true" />
          <h2 className="pdf-tools-title">{t('PDF 도구')} <small>{title}</small></h2>
          <button type="button" className="pdf-tools-close" aria-label={t('닫기')} disabled={busy} onClick={onClose}><X size={14} aria-hidden="true" /></button>
        </header>
        <div className="pdf-tools-body">
          <nav className="pdf-tools-list" aria-label={t('도구')}>
            {GROUPS.map((group) => (
              <div key={group.title} className="pdf-tools-group">
                <div className="pdf-tools-group-title">{t(group.title)}</div>
                {group.tools.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`pdf-tools-item${item.id === tool ? ' pdf-tools-item-on' : ''}`}
                    aria-current={item.id === tool ? 'true' : undefined}
                    disabled={busy}
                    onClick={() => setTool(item.id)}
                  >
                    <span className="pdf-tools-item-icon" aria-hidden="true">{item.icon}</span>
                    <span>{t(item.label)}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <section className="pdf-tools-pane" aria-label={t(info.label)}>
            <h3 className="pdf-tools-pane-title"><span aria-hidden="true">{info.icon}</span>{t(info.label)}</h3>
            <ToolPane key={tool} tool={tool} props={props} busy={busy} run={run} setTool={setTool} />
            {job !== undefined ? (
              <div className="pdf-tools-status" role="status">
                <span>{t(job.label)} {job.total > 0 ? `${job.done}/${job.total}` : ''}</span>
                {job.total > 0 ? <span className="pdf-tools-meter"><span style={{ width: `${(job.done / job.total) * 100}%` }} /></span> : null}
              </div>
            ) : status.kind === 'busy' ? (
              <div className="pdf-tools-status" role="status"><span>{status.text}</span></div>
            ) : status.kind === 'done' ? (
              <div className="pdf-tools-status pdf-tools-status-done" role="status">
                <span>{status.text}</span>
                {status.path !== undefined ? (
                  <button type="button" className="pdf-tools-link" onClick={() => { props.actions.openPath(status.path!); onClose() }}>
                    <ArrowSquareOut size={13} aria-hidden="true" />{t('열기')}
                  </button>
                ) : null}
              </div>
            ) : status.kind === 'error' ? (
              <div className="pdf-tools-status pdf-tools-status-error" role="alert">{status.text}</div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}

type Run = (busyText: string, work: () => Promise<string | { text: string; path?: string }>) => Promise<void>

/** 원본에 적용 / 사본으로 */
function OutputChoice({ value, onChange }: { readonly value: 'inPlace' | 'copy'; readonly onChange: (value: 'inPlace' | 'copy') => void }) {
  return (
    <div className="pdf-tools-seg" role="radiogroup" aria-label={t('결과')}>
      <button type="button" role="radio" aria-checked={value === 'inPlace'} className={value === 'inPlace' ? 'on' : ''} onClick={() => onChange('inPlace')}>{t('원본에 적용')}</button>
      <button type="button" role="radio" aria-checked={value === 'copy'} className={value === 'copy' ? 'on' : ''} onClick={() => onChange('copy')}>{t('사본으로')}</button>
    </div>
  )
}

function Note({ children }: { readonly children: ReactNode }) {
  return <p className="pdf-tools-note">{children}</p>
}

function ToolPane({ tool, props, busy, run, setTool }: { readonly tool: PdfToolId; readonly props: PdfToolsDialogProps; readonly busy: boolean; readonly run: Run; readonly setTool: (tool: PdfToolId) => void }) {
  const { actions, pageCount } = props
  const primary = (label: string, onClick: () => void, disabled = false) => (
    <div className="pdf-tools-actions">
      <button type="button" className="pdf-tools-primary" disabled={busy || disabled} onClick={onClick}>{label}</button>
    </div>
  )
  const applyOrCopy = (output: 'inPlace' | 'copy', op: PdfToolOp, suffix: string, doing: string) => run(doing, async () => {
    if (output === 'inPlace') return actions.applyInPlace(op)
    const path = await actions.saveCopy(op, suffix)
    return { text: t('새 PDF 를 만들었습니다: {name}', { name: path.split(/[\\/]/u).at(-1) ?? path }), path }
  })

  // ---- 도구마다 ----
  const [range, setRange] = useState('')
  const [picked, setPicked] = useState<readonly string[]>([])
  const [filter, setFilter] = useState('')
  const [choice, setChoice] = useState<FlattenChoice>({ highlights: true, overlays: true, notes: true, redactions: true })
  const [blanks, setBlanks] = useState<readonly number[] | null>(null)
  const [numberPos, setNumberPos] = useState<'bottomCenter' | 'bottomRight' | 'bottomLeft' | 'topCenter' | 'topRight' | 'topLeft'>('bottomCenter')
  const [numberTemplate, setNumberTemplate] = useState('{n}')
  const [numberStart, setNumberStart] = useState(1)
  const [numberSize, setNumberSize] = useState(10)
  const [skipFirst, setSkipFirst] = useState(false)
  const [mark, setMark] = useState({ text: t('사본'), size: 64, opacity: 0.18, angle: 45, color: '#808080' })
  const [margins, setMargins] = useState({ top: 10, bottom: 10, left: 10, right: 10 })
  const [nup, setNup] = useState(2)
  const [dpi, setDpi] = useState(150)
  const [shrink, setShrink] = useState<'normal' | 'small'>('normal')
  const [output, setOutput] = useState<'inPlace' | 'copy'>(tool === 'watermark' ? 'copy' : 'inPlace')
  const [compareWith, setCompareWith] = useState(props.otherPdfs[0]?.docId ?? '')
  const [diff, setDiff] = useState<{ hunks: readonly DiffHunk[]; truncated: boolean; otherDocId: string } | null>(null)

  const chapters = useMemo(() => chapterRanges(props.outline, pageCount), [props.outline, pageCount])
  const shownPdfs = props.otherPdfs.filter((pdf) => filter.trim() === '' || pdf.title.toLowerCase().includes(filter.trim().toLowerCase()))

  switch (tool) {
    case 'ocr':
      return (
        <>
          <Note>{t('글자 층이 없는 쪽(스캔 쪽)을 이 PC 에서 읽어 보이지 않는 글자를 입힙니다. 겉모습은 그대로이고, 글자 고르기·검색·형광펜·번역이 됩니다. 이미 글자가 있는 쪽은 건드리지 않습니다.')}</Note>
          <Note>{t('원본에 적용합니다. 덮기 전 원본은 .iwae/history/pdf-edits 에 남습니다.')}</Note>
          {props.hasText ? <Note>{t('이 PDF 는 앞쪽에 글자가 있습니다. 글자 없는 쪽이 섞여 있으면 그 쪽만 읽습니다.')}</Note> : null}
          {primary(t('OCR 시작'), () => void run(t('OCR 준비 중…'), actions.ocr))}
        </>
      )
    case 'compare': {
      const other = props.otherPdfs.find((pdf) => pdf.docId === compareWith)
      return (
        <>
          <Note>{t('두 판의 글을 줄 단위로 비교해 바뀐·더한·지운 곳을 보입니다. 줄을 누르면 그 쪽으로 갑니다.')}</Note>
          <label className="pdf-tools-field">
            <span>{t('비교할 판')}</span>
            <select value={compareWith} onChange={(event) => { setCompareWith(event.target.value); setDiff(null) }}>
              {props.otherPdfs.map((pdf) => <option key={pdf.docId} value={pdf.docId}>{pdf.sibling === true ? `★ ${pdf.title}` : pdf.title}</option>)}
            </select>
          </label>
          {primary(t('비교'), () => void run(t('두 판의 글을 읽는 중…'), async () => {
            const result = await actions.compare(compareWith)
            setDiff({ ...result, otherDocId: compareWith })
            return result.hunks.length === 0 ? t('글이 같습니다') : t('바뀐 곳 {count}군데', { count: result.hunks.length })
          }), other === undefined)}
          {diff !== null && diff.hunks.length > 0 ? (
            <ol className="pdf-tools-diff">
              {diff.truncated ? <li className="pdf-tools-diff-note">{t('두 판이 많이 달라 앞부분만 자세히 비교했습니다.')}</li> : null}
              {diff.hunks.slice(0, 300).map((hunk, index) => (
                <li key={index} className={`pdf-tools-diff-hunk pdf-tools-diff-${hunk.kind}`}>
                  {hunk.before.length > 0 ? (
                    <button type="button" className="pdf-tools-diff-side pdf-tools-diff-before" onClick={() => actions.jump(props.docId, hunk.before[0]!.page)}>
                      <span className="pdf-tools-diff-page">{t('이 판')} p.{hunk.before[0]!.page + 1}</span>
                      {hunk.before.slice(0, 4).map((line, at) => <span key={at} className="pdf-tools-diff-line">− {line.text}</span>)}
                    </button>
                  ) : null}
                  {hunk.after.length > 0 ? (
                    <button type="button" className="pdf-tools-diff-side pdf-tools-diff-after" onClick={() => actions.jump(diff.otherDocId, hunk.after[0]!.page)}>
                      <span className="pdf-tools-diff-page">{t('비교 판')} p.{hunk.after[0]!.page + 1}</span>
                      {hunk.after.slice(0, 4).map((line, at) => <span key={at} className="pdf-tools-diff-line">+ {line.text}</span>)}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )
    }
    case 'flatten': {
      const counts = props.marks
      const rows: readonly [keyof FlattenChoice, string, number][] = [
        ['highlights', '형광펜 (메모는 PDF 주석으로)', counts.highlights],
        ['overlays', '글 상자 · 펜 · 선 · 도형', counts.overlays],
        ['notes', '영역 · 박스 메모 (붙임 쪽지로)', counts.notes],
        ['redactions', '가리기 (그 자리 글자를 정말 지움)', counts.redactions],
      ]
      const total = rows.reduce((sum, [key, , count]) => sum + (choice[key] ? count : 0), 0)
      return (
        <>
          <Note>{t('IWAE 에서 단 표시를 PDF 안에 넣은 사본을 만듭니다. 다른 PDF 프로그램에서도 그대로 보여 공유할 때 씁니다. 원본은 그대로입니다.')}</Note>
          <div className="pdf-tools-checks">
            {rows.map(([key, label, count]) => (
              <label key={key} className="pdf-tools-check">
                <input type="checkbox" checked={choice[key]} disabled={count === 0} onChange={(event) => setChoice({ ...choice, [key]: event.target.checked })} />
                <span>{t(label)}</span>
                <b>{count}</b>
              </label>
            ))}
          </div>
          {primary(t('사본 만들기'), () => void applyOrCopy('copy', props.buildFlatten(choice), t('(표시)'), t('표시를 넣는 중…')), total === 0)}
        </>
      )
    }
    case 'redact':
      return (
        <>
          <Note>{t('가리기 상자로 덮은 곳의 글자·그림을 정말로 지운 사본을 만듭니다. 가린 쪽은 그림 한 장이 되어 숨은 글자가 남지 않습니다(그 쪽은 글자 고르기가 안 됩니다). 원본은 그대로입니다.')}</Note>
          <div className="pdf-tools-checks">
            <div className="pdf-tools-check"><span>{t('가리기 상자')}</span><b>{props.marks.redactions}</b></div>
          </div>
          {props.marks.redactions === 0 ? (
            <div className="pdf-tools-actions">
              <button type="button" className="pdf-tools-secondary" onClick={actions.startRedactTool}><Eraser size={14} aria-hidden="true" />{t('가리기 도구 켜기 (X)')}</button>
            </div>
          ) : primary(t('가린 사본 만들기'), () => void applyOrCopy('copy', props.buildFlatten({ highlights: false, overlays: false, notes: false, redactions: true }), t('(가림)'), t('가리는 중…')))}
        </>
      )
    case 'extract': {
      const pages = parsePageRanges(range, pageCount)
      return (
        <>
          <Note>{t('고른 쪽만 담은 새 PDF 를 원본 옆에 만듭니다. 쓴 순서대로 담습니다(예: 1-3, 7, 10-).')}</Note>
          <label className="pdf-tools-field">
            <span>{t('쪽 (전체 {count}쪽)', { count: pageCount })}</span>
            <input value={range} placeholder="1-3, 7, 10-" onChange={(event) => setRange(event.target.value)} />
          </label>
          {range.trim() !== '' && pages === null ? <Note>{t('쪽 범위를 읽지 못했습니다')}</Note> : null}
          {primary(pages === null ? t('새 PDF 만들기') : t('{count}쪽으로 새 PDF 만들기', { count: pages.length }), () => {
            if (pages === null) return
            const label = range.replace(/\s+/gu, '')
            void applyOrCopy('copy', { kind: 'extract', pages }, `(p.${label})`, t('쪽을 뽑는 중…'))
          }, pages === null)}
        </>
      )
    }
    case 'split':
      return (
        <>
          <Note>{t('목차 맨 위 단계(장)마다 PDF 를 하나씩 만들어 원본 옆 「{title} 나눔」 폴더에 둡니다.', { title: props.title })}</Note>
          {chapters.length === 0 ? <Note>{t('이 PDF 에는 나눌 목차가 없습니다. 「쪽 뽑아 새 PDF」를 쓰세요.')}</Note> : (
            <ol className="pdf-tools-chapters">
              {chapters.map((chapter, index) => (
                <li key={index}><span>{chapter.title}</span><b>{chapter.from + 1}–{chapter.to + 1}</b></li>
              ))}
            </ol>
          )}
          {primary(t('{count}개로 나누기', { count: chapters.length }), () => void run(t('나누는 중…'), async () => {
            const folder = `${props.title} ${t('나눔')}`
            for (const [index, chapter] of chapters.entries()) {
              const pages = Array.from({ length: chapter.to - chapter.from + 1 }, (_, at) => chapter.from + at)
              await actions.saveCopy({ kind: 'extract', pages }, `${String(index + 1).padStart(2, '0')} ${chapter.title}`, folder)
            }
            return t('{count}개 PDF 를 「{folder}」 폴더에 만들었습니다', { count: chapters.length, folder })
          }), chapters.length === 0)}
        </>
      )
    case 'merge':
      return (
        <>
          <Note>{t('이 PDF 뒤에 고른 PDF 들을 고른 순서대로 붙인 새 PDF 를 원본 옆에 만듭니다.')}</Note>
          <label className="pdf-tools-field pdf-tools-search">
            <MagnifyingGlass size={13} aria-hidden="true" />
            <input value={filter} placeholder={t('PDF 찾기')} aria-label={t('PDF 찾기')} onChange={(event) => setFilter(event.target.value)} />
          </label>
          <ul className="pdf-tools-pick">
            {shownPdfs.map((pdf) => {
              const order = picked.indexOf(pdf.path)
              return (
                <li key={pdf.docId}>
                  <label className="pdf-tools-check">
                    <input type="checkbox" checked={order >= 0} onChange={(event) => setPicked(event.target.checked ? [...picked, pdf.path] : picked.filter((path) => path !== pdf.path))} />
                    <span>{pdf.title}</span>
                    {order >= 0 ? <b>{order + 1}</b> : null}
                  </label>
                </li>
              )
            })}
          </ul>
          {primary(t('{count}개 합치기', { count: picked.length + 1 }), () => void applyOrCopy('copy', { kind: 'merge', sources: picked }, t('(합침)'), t('합치는 중…')), picked.length === 0)}
        </>
      )
    case 'blanks':
      return (
        <>
          <Note>{t('거의 흰 쪽을 찾아 뺍니다. 쪽 편집과 같아서 형광펜·메모·노트 출처가 남은 쪽을 따라 옮겨지고, 덮기 전 원본은 남습니다.')}</Note>
          {blanks === null ? primary(t('빈 쪽 찾기'), () => void run(t('쪽을 살피는 중…'), async () => {
            const found = await actions.findBlankPages()
            setBlanks(found)
            return found.length === 0 ? t('빈 쪽이 없습니다') : t('빈 쪽 {count}개: {pages}', { count: found.length, pages: found.slice(0, 30).map((page) => page + 1).join(', ') })
          })) : blanks.length === 0 ? null : primary(t('{count}쪽 빼기', { count: blanks.length }), () => void run(t('빼는 중…'), async () => {
            const message = await actions.removePages(blanks)
            setBlanks(null)
            return message
          }), blanks.length >= pageCount)}
        </>
      )
    case 'orient':
      return (
        <>
          <Note>{t('글자 없는 스캔 쪽을 이 PC 에서 0·90·180·270도로 돌려 읽어 보고, 옆으로 눕거나 거꾸로 선 쪽을 똑바로 돌립니다. 확실하지 않은 쪽은 그대로 둡니다. 쪽 편집과 같아서 형광펜·메모·노트 출처가 따라 옮겨지고, 덮기 전 원본은 .iwae/history/pdf-edits 에 남습니다.')}</Note>
          {props.hasText ? <Note>{t('이 PDF 는 앞쪽에 글자가 있습니다. 글자 없는 쪽만 살핍니다.')}</Note> : null}
          {primary(t('방향 살펴 바로잡기'), () => void run(t('방향을 살피는 중…'), actions.fixOrientation))}
        </>
      )
    case 'numbers':
      return (
        <>
          <div className="pdf-tools-grid">
            <label className="pdf-tools-field">
              <span>{t('자리')}</span>
              <select value={numberPos} onChange={(event) => setNumberPos(event.target.value as typeof numberPos)}>
                <option value="bottomCenter">{t('아래 가운데')}</option>
                <option value="bottomRight">{t('아래 오른쪽')}</option>
                <option value="bottomLeft">{t('아래 왼쪽')}</option>
                <option value="topCenter">{t('위 가운데')}</option>
                <option value="topRight">{t('위 오른쪽')}</option>
                <option value="topLeft">{t('위 왼쪽')}</option>
              </select>
            </label>
            <label className="pdf-tools-field">
              <span>{t('모양')}</span>
              <select value={numberTemplate} onChange={(event) => setNumberTemplate(event.target.value)}>
                <option value="{n}">1</option>
                <option value="{n} / {total}">1 / 10</option>
                <option value="- {n} -">- 1 -</option>
                <option value="p. {n}">p. 1</option>
              </select>
            </label>
            <label className="pdf-tools-field">
              <span>{t('시작 번호')}</span>
              <input type="number" min={0} value={numberStart} onChange={(event) => setNumberStart(Number(event.target.value) || 0)} />
            </label>
            <label className="pdf-tools-field">
              <span>{t('글자 크기 (pt)')}</span>
              <input type="number" min={5} max={48} value={numberSize} onChange={(event) => setNumberSize(Number(event.target.value) || 10)} />
            </label>
          </div>
          <label className="pdf-tools-check pdf-tools-check-inline">
            <input type="checkbox" checked={skipFirst} onChange={(event) => setSkipFirst(event.target.checked)} />
            <span>{t('첫 쪽(표지)에는 넣지 않기')}</span>
          </label>
          <OutputChoice value={output} onChange={setOutput} />
          {primary(t('쪽 번호 넣기'), () => void applyOrCopy(output, { kind: 'pageNumbers', position: numberPos, start: numberStart, template: numberTemplate, size: numberSize, skipFirst }, t('(쪽 번호)'), t('쪽 번호를 넣는 중…')))}
        </>
      )
    case 'watermark':
      return (
        <>
          <label className="pdf-tools-field">
            <span>{t('글자')}</span>
            <input value={mark.text} onChange={(event) => setMark({ ...mark, text: event.target.value })} />
          </label>
          <div className="pdf-tools-grid">
            <label className="pdf-tools-field">
              <span>{t('크기 (pt)')}</span>
              <input type="number" min={8} max={200} value={mark.size} onChange={(event) => setMark({ ...mark, size: Number(event.target.value) || 64 })} />
            </label>
            <label className="pdf-tools-field">
              <span>{t('각도')}</span>
              <input type="number" min={-90} max={90} value={mark.angle} onChange={(event) => setMark({ ...mark, angle: Number(event.target.value) || 0 })} />
            </label>
            <label className="pdf-tools-field">
              <span>{t('진하기 {value}%', { value: Math.round(mark.opacity * 100) })}</span>
              <input type="range" min={5} max={60} value={Math.round(mark.opacity * 100)} onChange={(event) => setMark({ ...mark, opacity: Number(event.target.value) / 100 })} />
            </label>
            <label className="pdf-tools-field">
              <span>{t('색')}</span>
              <input type="color" value={mark.color} onChange={(event) => setMark({ ...mark, color: event.target.value })} />
            </label>
          </div>
          <OutputChoice value={output} onChange={setOutput} />
          {primary(t('워터마크 넣기'), () => void applyOrCopy(output, { kind: 'watermark', ...mark }, t('(워터마크)'), t('워터마크를 넣는 중…')), mark.text.trim() === '')}
        </>
      )
    case 'crop':
      return (
        <>
          <Note>{t('모든 쪽의 가장자리를 잘라 냅니다(보이는 쪽 기준, mm). 잘린 부분은 숨겨질 뿐 지워지지는 않습니다.')}</Note>
          <div className="pdf-tools-grid">
            {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
              <label key={side} className="pdf-tools-field">
                <span>{t({ top: '위', bottom: '아래', left: '왼쪽', right: '오른쪽' }[side])}</span>
                <input type="number" min={0} max={120} value={margins[side]} onChange={(event) => setMargins({ ...margins, [side]: Math.max(0, Number(event.target.value) || 0) })} />
              </label>
            ))}
          </div>
          <OutputChoice value={output} onChange={setOutput} />
          {primary(t('여백 자르기'), () => void applyOrCopy(output, { kind: 'crop', top: margins.top * MM, bottom: margins.bottom * MM, left: margins.left * MM, right: margins.right * MM }, t('(여백 자름)'), t('자르는 중…')))}
        </>
      )
    case 'nup': {
      const layouts: Record<number, { columns: number; rows: number; landscape: boolean }> = {
        2: { columns: 2, rows: 1, landscape: true },
        4: { columns: 2, rows: 2, landscape: false },
        6: { columns: 3, rows: 2, landscape: true },
        9: { columns: 3, rows: 3, landscape: false },
      }
      return (
        <>
          <Note>{t('A4 한 장에 여러 쪽을 줄여 담은 새 PDF 를 만듭니다(인쇄·훑어보기용).')}</Note>
          <div className="pdf-tools-seg" role="radiogroup" aria-label={t('한 장에')}>
            {[2, 4, 6, 9].map((count) => (
              <button key={count} type="button" role="radio" aria-checked={nup === count} className={nup === count ? 'on' : ''} onClick={() => setNup(count)}>{t('{count}쪽', { count })}</button>
            ))}
          </div>
          {primary(t('모아찍기 만들기 ({sheets}장)', { sheets: Math.ceil(pageCount / nup) }), () => void applyOrCopy('copy', { kind: 'nUp', ...layouts[nup]! }, t('(모아찍기 {count})', { count: nup }), t('모으는 중…')))}
        </>
      )
    }
    case 'compress': {
      const levels = { normal: { maxDpi: 150, quality: 80 }, small: { maxDpi: 96, quality: 65 } } as const
      return (
        <>
          <Note>{t('쪽에 놓인 크기보다 해상도가 높은 그림(스캔·사진)을 줄여 파일 크기를 낮춘 사본을 원본 옆에 만듭니다. 글자와 도형은 그대로이고, 원본은 건드리지 않습니다. 줄어드는 그림이 없으면 사본을 만들지 않습니다.')}</Note>
          <div className="pdf-tools-seg" role="radiogroup" aria-label={t('압축 정도')}>
            <button type="button" role="radio" aria-checked={shrink === 'normal'} className={shrink === 'normal' ? 'on' : ''} onClick={() => setShrink('normal')}>{t('보통 (150 dpi)')}</button>
            <button type="button" role="radio" aria-checked={shrink === 'small'} className={shrink === 'small' ? 'on' : ''} onClick={() => setShrink('small')}>{t('작게 (96 dpi)')}</button>
          </div>
          {primary(t('압축한 사본 만들기'), () => void run(t('그림을 줄이는 중…'), async () => {
            const { path, sizeBefore, sizeAfter } = await actions.compress(levels[shrink].maxDpi, levels[shrink].quality)
            const percent = sizeBefore > 0 ? Math.round((1 - sizeAfter / sizeBefore) * 100) : 0
            return {
              text: t('압축했습니다: {before} → {after} ({percent}% 줄었습니다)', { before: formatBytes(sizeBefore), after: formatBytes(sizeAfter), percent }),
              path,
            }
          }))}
        </>
      )
    }
    case 'images':
      return (
        <>
          <Note>{t('쪽마다 PNG 그림을 고른 폴더에 저장합니다.')}</Note>
          <div className="pdf-tools-seg" role="radiogroup" aria-label={t('해상도')}>
            {[72, 150, 300].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={dpi === value} className={dpi === value ? 'on' : ''} onClick={() => setDpi(value)}>{value} dpi</button>
            ))}
          </div>
          {primary(t('폴더 골라 저장'), () => void run(t('그리는 중…'), () => actions.exportImages(dpi)))}
        </>
      )
    case 'markdown':
      return (
        <>
          <Note>{t('PDF 의 글을 쪽마다 머리글을 붙여 Markdown 파일로 원본 옆에 저장합니다. AI 에게 건네거나 고쳐 쓸 때 씁니다.')}</Note>
          {primary(t('Markdown 만들기'), () => void run(t('글을 모으는 중…'), actions.exportMarkdown))}
        </>
      )
    case 'unlock':
      return (
        <>
          <Note>{t('암호로 연 PDF 를 암호 없이 열리는 사본으로 저장합니다(쪽은 그대로, 목차는 빠질 수 있습니다).')}</Note>
          {props.passwordProtected ? primary(t('암호 푼 사본 만들기'), () => void applyOrCopy('copy', { kind: 'unlock' }, t('(암호 없음)'), t('사본을 만드는 중…'))) : <Note>{t('이 PDF 는 암호가 없습니다.')}</Note>}
          {!props.passwordProtected ? <div className="pdf-tools-actions"><button type="button" className="pdf-tools-secondary" onClick={() => setTool('flatten')}>{t('다른 도구 보기')}</button></div> : null}
        </>
      )
  }
}
