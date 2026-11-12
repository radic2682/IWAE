/**
 * 영어 사전: 한국어 문장(열쇠) → 영어. 화면 묶음마다 파일을 나눠 두고 여기서 합친다.
 * 새 문장은 그 화면 묶음의 파일에 넣는다. 열쇠가 겹치면 뒤의 것이 이긴다.
 */
import { COMMON } from './en/common'
import { GROUP_1 } from './en/group1'
import { GROUP_2 } from './en/group2'
import { GROUP_3 } from './en/group3'
import { GROUP_4 } from './en/group4'
import { GROUP_5 } from './en/group5'
import { GROUP_6 } from './en/group6'
import { GROUP_7 } from './en/group7'
import { INTEROP } from './en/interop'
import { SESSIONS } from './en/sessions'
import { SHORTCUTS } from './en/shortcuts'
import { SUPPORT } from './en/support'
import { RELEASE_NOTES } from './en/releaseNotes'
import { THEME_FILES } from './en/themeFiles'
import { WORKSPACE_COMMANDS } from './en/workspaceCommands'
import { TICKETS } from './en/tickets'

export const EN: Readonly<Record<string, string>> = {
  ...SHORTCUTS,
  ...GROUP_1,
  ...GROUP_2,
  ...GROUP_3,
  ...GROUP_4,
  ...GROUP_5,
  ...GROUP_6,
  ...GROUP_7,
  ...WORKSPACE_COMMANDS,
  ...SESSIONS,
  ...INTEROP,
  ...TICKETS,
  ...THEME_FILES,
  ...SUPPORT,
  ...RELEASE_NOTES,
  ...COMMON,
}
