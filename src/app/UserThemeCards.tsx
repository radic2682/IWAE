import { useRef, useState } from 'react'
import { Check, Copy, DotsThree, DownloadSimple, FileArrowDown, FolderOpen, FolderSimple, PencilSimple, Plus, Trash, Warning } from '@phosphor-icons/react'
import type { ResolvedTheme, ThemePalette } from '../core/theme'
import { buildTemplateFile, serializeThemeFile } from '../core/themeFile'
import {
  BUILTIN_SEEDS,
  deriveThemeVars,
  newThemeId,
  themeFromPalette,
  uniqueThemeName,
  type BasePaletteId,
  type UserTheme,
} from '../core/userTheme'
import { t } from '../i18n'
import { ContextMenu } from '../ui/ContextMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { ThemeEditorDialog } from './ThemeEditorDialog'
import { useAppPrefs } from './appPrefs'
import { saveThemeFile, templateFileName, themeFileName } from './themeFile'
import { openThemeFolder, revealThemeFile } from './themeFolder'
import { offerThemeFiles, readThemeBlobs } from './themeIntake'
import { deleteUserTheme, findUserTheme, saveUserTheme, setActiveUserTheme, useUserThemes } from './userThemeStore'
import '../ui/user-theme.css'

export function UserThemePreview({ theme, mode }: { readonly theme: UserTheme; readonly mode: ResolvedTheme }) {
  const vars = deriveThemeVars(theme[mode], mode)
  const seeds = theme[mode]
  const line = seeds.divider
  return (
    <span className="theme-palette-preview" aria-hidden="true" style={{ background: seeds.workspace, borderColor: line }}>
      <span className="theme-palette-preview-side" style={{ background: seeds.panel, borderColor: line }}>
        <i style={{ background: seeds.accent }} />
        <i style={{ background: line }} />
        <i style={{ background: line }} />
      </span>
      <span className="theme-palette-preview-page" style={{ background: vars['--paper'], borderColor: line }}>
        <i style={{ background: seeds.text, opacity: 0.85 }} />
        <i style={{ background: seeds.text, opacity: 0.35 }} />
        <i style={{ background: seeds.text, opacity: 0.35 }} />
        <b style={{ background: seeds.accent }} />
      </span>
    </span>
  )
}

/**
 * 설정 › 색 구성 격자에 이어 붙는 「내 테마」 카드들과 「+ 새 테마 만들기」.
 * 카드를 고르면 그 테마를 쓰고, ⋯ 메뉴에서 고치기·복제·내보내기·지우기를 한다.
 */
export function UserThemeCards({ resolvedTheme, palette, onFallback, vaultRoot = null }: {
  readonly resolvedTheme: ResolvedTheme
  /** 지금 고른 내장 색 구성(새 테마를 만들 때 시작점) */
  readonly palette: ThemePalette
  /** 쓰던 테마를 지웠을 때 돌아갈 곳(웨일) */
  readonly onFallback: () => void
  /** 열린 Vault(테마 폴더 .iwae/themes 가 있는 곳). 없으면 폴더 단추는 꺼진다 */
  readonly vaultRoot?: string | null
}) {
  const { themes, folderThemes, folderErrors, activeId } = useUserThemes()
  const { highlightColors } = useAppPrefs()
  const fileInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<{ readonly theme: UserTheme; readonly isNew: boolean } | null>(null)
  const [menu, setMenu] = useState<{ readonly theme: UserTheme; readonly x: number; readonly y: number } | null>(null)
  const [deleting, setDeleting] = useState<UserTheme | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const names = [...themes, ...folderThemes].map((theme) => theme.name)
  const create = () => {
    const active = themes.find((theme) => theme.id === activeId)
    const base: BasePaletteId = active?.base ?? (palette === 'default' || palette === 'paper' || palette === 'navy' ? palette : 'whale')
    const fresh = themeFromPalette(base, uniqueThemeName(t('내 테마'), names))
    setEditing({ theme: active === undefined ? fresh : { ...fresh, light: { ...active.light }, dark: { ...active.dark } }, isNew: true })
  }
  const duplicate = (theme: UserTheme) => {
    const copy: UserTheme = { ...theme, id: newThemeId(), name: uniqueThemeName(`${theme.name} ${t('복사')}`.slice(0, 30), names) }
    saveUserTheme(copy)
    setStatus(`${t('복제했습니다')}: ${copy.name}`)
  }
  const saveTemplate = async () => {
    const active = findUserTheme({ themes, folderThemes }, activeId)
    const base: BasePaletteId = active?.base ?? (palette === 'default' || palette === 'paper' || palette === 'navy' ? palette : 'whale')
    const seeds = active ?? { light: BUILTIN_SEEDS[base].light, dark: BUILTIN_SEEDS[base].dark }
    const template = { id: newThemeId(), name: t('내 테마'), base, light: { ...seeds.light }, dark: { ...seeds.dark } }
    try {
      const path = await saveThemeFile(templateFileName(), buildTemplateFile(template, highlightColors))
      if (path !== null) setStatus(`${t('템플릿을 저장했습니다')}: ${path}`)
    } catch {
      setStatus(t('파일을 저장하지 못했습니다.'))
    }
  }
  const openFolder = async () => {
    if (vaultRoot === null) return
    try { await openThemeFolder(vaultRoot) } catch { setStatus(t('테마 폴더를 열지 못했습니다.')) }
  }
  const exportTheme = async (theme: UserTheme) => {
    try {
      const path = await saveThemeFile(themeFileName(theme.name), serializeThemeFile(theme))
      if (path !== null) setStatus(`${t('파일로 내보냈습니다')}: ${path}`)
    } catch {
      setStatus(t('파일을 저장하지 못했습니다.'))
    }
  }

  return (
    <>
      {themes.map((theme) => (
        <div key={theme.id} className="theme-palette-card-wrap">
          <label className="theme-palette-card theme-palette-card-user">
            <input
              type="radio"
              name="theme-palette"
              value={theme.id}
              aria-label={theme.name}
              checked={activeId === theme.id}
              onChange={() => setActiveUserTheme(theme.id)}
            />
            <UserThemePreview theme={theme} mode={resolvedTheme} />
            <span className="theme-palette-copy">
              <strong>{theme.name}</strong>
              <small>{t('내 테마')}</small>
            </span>
            <span className="theme-palette-check" aria-hidden="true"><Check size={11} weight="bold" /></span>
          </label>
          <button
            type="button"
            className="theme-palette-menu-button"
            aria-label={`${theme.name} ${t('메뉴')}`}
            aria-haspopup="menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu({ theme, x: rect.left, y: rect.bottom + 4 })
            }}
          >
            <DotsThree size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
      ))}
      {folderThemes.map((theme) => (
        <div key={theme.id} className="theme-palette-card-wrap">
          <label className="theme-palette-card theme-palette-card-user theme-palette-card-folder">
            <input type="radio" name="theme-palette" value={theme.id} aria-label={theme.name} checked={activeId === theme.id} onChange={() => setActiveUserTheme(theme.id)} />
            <UserThemePreview theme={theme} mode={resolvedTheme} />
            <span className="theme-palette-copy">
              <strong>{theme.name}</strong>
              <small className="theme-folder-badge" title={theme.file}><FolderSimple size={11} weight="fill" aria-hidden="true" />{t('테마 폴더')}</small>
            </span>
            <span className="theme-palette-check" aria-hidden="true"><Check size={11} weight="bold" /></span>
          </label>
          <button
            type="button"
            className="theme-palette-menu-button"
            aria-label={`${theme.name} ${t('메뉴')}`}
            aria-haspopup="menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu({ theme, x: rect.left, y: rect.bottom + 4 })
            }}
          >
            <DotsThree size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="theme-palette-new" onClick={create}>
        <Plus size={13} weight="bold" aria-hidden="true" />
        {t('새 테마 만들기')}
      </button>
      <div className="theme-file-tools">
        <button type="button" className="theme-file-tool" onClick={() => fileInput.current?.click()}><FileArrowDown size={14} aria-hidden="true" />{t('테마 파일 불러오기')}</button>
        <button type="button" className="theme-file-tool" onClick={() => void saveTemplate()} title={t('지금 색으로 채운 테마 파일을 저장합니다. 고쳐서 다시 불러오세요')}><DownloadSimple size={14} aria-hidden="true" />{t('템플릿 저장')}</button>
        <button type="button" className="theme-file-tool" disabled={vaultRoot === null} onClick={() => void openFolder()} title={vaultRoot === null ? t('Vault 를 먼저 열어 주세요') : t('이 Vault 의 .iwae/themes 폴더. 테마 파일을 넣으면 저절로 나타납니다')}><FolderOpen size={14} aria-hidden="true" />{t('테마 폴더 열기')}</button>
        <p className="theme-file-hint">{t('.iwtheme 파일을 이 창에 끌어 놓아도 됩니다.')}</p>
        <input
          ref={fileInput}
          type="file"
          accept=".iwtheme,.json,application/json"
          multiple
          className="ut-file"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length > 0) void readThemeBlobs(files).then(offerThemeFiles)
          }}
        />
      </div>
      {folderErrors.length > 0 ? (
        <ul className="theme-folder-errors" aria-label={t('테마 폴더에서 읽지 못한 파일')}>
          {folderErrors.map((item) => (
            <li key={item.file}><Warning size={13} weight="fill" aria-hidden="true" /><span><strong>{item.file}</strong> {t(item.error)}</span></li>
          ))}
        </ul>
      ) : null}
      {status !== null ? <p className="theme-user-status" role="status">{status}</p> : null}

      {menu !== null ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`${menu.theme.name} ${t('메뉴')}`}
          onClose={() => setMenu(null)}
          entries={menu.theme.file !== undefined ? [
            { key: 'edit', icon: <PencilSimple size={15} />, label: t('복사해서 고치기'), onSelect: () => setEditing({ theme: { ...menu.theme, id: newThemeId(), file: undefined, name: uniqueThemeName(menu.theme.name, names) }, isNew: true }) },
            { key: 'export', icon: <DownloadSimple size={15} />, label: t('내보내기'), onSelect: () => void exportTheme(menu.theme) },
            ...(vaultRoot === null ? [] : [{ key: 'reveal', icon: <FolderOpen size={15} />, label: t('폴더에서 보기'), onSelect: () => void revealThemeFile(vaultRoot, menu.theme.file ?? '').catch(() => setStatus(t('테마 폴더를 열지 못했습니다.'))) }]),
          ] : [
            { key: 'edit', icon: <PencilSimple size={15} />, label: t('고치기'), onSelect: () => setEditing({ theme: menu.theme, isNew: false }) },
            { key: 'copy', icon: <Copy size={15} />, label: t('복제'), onSelect: () => duplicate(menu.theme) },
            { key: 'export', icon: <DownloadSimple size={15} />, label: t('내보내기'), onSelect: () => void exportTheme(menu.theme) },
            { key: 'sep', separator: true },
            { key: 'delete', icon: <Trash size={15} />, label: t('지우기'), danger: true, onSelect: () => setDeleting(menu.theme) },
          ]}
        />
      ) : null}

      {editing !== null ? (
        <ThemeEditorDialog
          initial={editing.theme}
          isNew={editing.isNew}
          initialMode={resolvedTheme}
          takenNames={themes.filter((theme) => theme.id !== editing.theme.id).map((theme) => theme.name)}
          onCancel={() => setEditing(null)}
          onSave={(theme) => {
            const taken = themes.filter((item) => item.id !== theme.id).map((item) => item.name)
            saveUserTheme({ ...theme, name: uniqueThemeName(theme.name, taken) }, { activate: true })
            setEditing(null)
          }}
        />
      ) : null}

      {deleting !== null ? (
        <ConfirmDialog
          title={`${t('테마를 지울까요?')}`}
          tone="danger"
          confirmLabel={t('지우기')}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            if (deleteUserTheme(deleting.id)) onFallback()
            setDeleting(null)
          }}
        >
          <p><strong>{deleting.name}</strong> {t('테마를 지웁니다. 되돌릴 수 없어요. 쓰던 테마라면 기본(웨일)으로 돌아갑니다.')}</p>
        </ConfirmDialog>
      ) : null}
    </>
  )
}
