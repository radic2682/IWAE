import { describe, expect, it } from 'vitest'
import { COMMAND_HISTORY_KEY, COMMAND_HISTORY_MAX, completeCommandLine, loadCommandHistory, pushCommandHistory, saveCommandHistory, stepCommandHistory } from './commandLine'

const CONTEXT = { screenNames: ['읽기', '비교', '읽기 2'], templateNames: ['읽기', '노트 왼쪽', '비교', '정리', '빈 화면'] }

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) }, map }
}

describe('명령줄 기록', () => {
  it('같은 줄은 맨 뒤로 옮기고, 빈 줄은 더하지 않으며, 최근 50줄만 남긴다', () => {
    expect(pushCommandHistory(['a', 'b'], 'a')).toEqual(['b', 'a'])
    expect(pushCommandHistory(['a'], '   ')).toEqual(['a'])
    expect(pushCommandHistory(['a'], '  b  ')).toEqual(['a', 'b'])
    let history: string[] = []
    for (let n = 0; n < 60; n += 1) history = pushCommandHistory(history, `cmd ${n}`)
    expect(history).toHaveLength(COMMAND_HISTORY_MAX)
    expect(history[0]).toBe('cmd 10')
    expect(history[history.length - 1]).toBe('cmd 59')
  })

  it('localStorage 에 저장하고 읽는다(깨진 값은 빈 기록)', () => {
    const storage = memoryStorage()
    saveCommandHistory(['split-window -h', 'next'], storage)
    expect(JSON.parse(storage.map.get(COMMAND_HISTORY_KEY)!)).toEqual(['split-window -h', 'next'])
    expect(loadCommandHistory(storage)).toEqual(['split-window -h', 'next'])
    expect(loadCommandHistory(memoryStorage({ [COMMAND_HISTORY_KEY]: '{깨짐' }))).toEqual([])
    expect(loadCommandHistory(memoryStorage({ [COMMAND_HISTORY_KEY]: '{"a":1}' }))).toEqual([])
    expect(loadCommandHistory(memoryStorage({ [COMMAND_HISTORY_KEY]: JSON.stringify([1, '', 'ok']) }))).toEqual(['ok'])
    expect(loadCommandHistory(null)).toEqual([])
  })

  it('저장할 때도 50줄을 넘기지 않는다', () => {
    const storage = memoryStorage()
    saveCommandHistory(Array.from({ length: 80 }, (_, n) => `c${n}`), storage)
    expect(loadCommandHistory(storage)).toHaveLength(50)
  })

  it('↑ 는 앞 기록으로, ↓ 는 뒤로 가다 끝에서 쓰던 글자로 돌아온다', () => {
    const history = ['a', 'b', 'c']
    let step = stepCommandHistory(history, history.length, 'up', '쓰는 중')
    expect(step).toEqual({ cursor: 2, text: 'c' })
    step = stepCommandHistory(history, step.cursor, 'up', '쓰는 중')
    step = stepCommandHistory(history, step.cursor, 'up', '쓰는 중')
    expect(step).toEqual({ cursor: 0, text: 'a' })
    expect(stepCommandHistory(history, 0, 'up', 'x')).toEqual({ cursor: 0, text: 'a' })
    step = stepCommandHistory(history, 1, 'down', '쓰는 중')
    expect(step).toEqual({ cursor: 2, text: 'c' })
    expect(stepCommandHistory(history, 2, 'down', '쓰는 중')).toEqual({ cursor: 3, text: '쓰는 중' })
    expect(stepCommandHistory([], 0, 'up', 'x')).toEqual({ cursor: 0, text: 'x' })
  })
})

describe('탭 완성', () => {
  it('명령 이름: 하나로 정해지면 빈칸까지, 여럿이면 공통 앞부분과 후보', () => {
    expect(completeCommandLine('rename-w', CONTEXT)).toEqual({ text: 'rename-window ', candidates: ['rename-window'] })
    const many = completeCommandLine('select-', CONTEXT)
    expect(many.text).toBe('select-')
    expect(many.candidates).toEqual(['select-pane', 'select-window', 'select-layout'])
    const split = completeCommandLine('s', CONTEXT)
    expect(split.candidates).toContain('split-window')
    expect(completeCommandLine('zzz', CONTEXT)).toEqual({ text: 'zzz', candidates: [] })
    // 공통 앞부분이 늘어나면 거기까지 채운다
    expect(completeCommandLine('kill-', CONTEXT).text).toBe('kill-')
    expect(completeCommandLine('sp', CONTEXT).text).toBe('split-window ')
  })

  it('앱 창 명령은 완성에 나오고, 안쪽 명령은 나오지 않는다', () => {
    expect(completeCommandLine('det', CONTEXT).candidates).toEqual(['detach'])
    expect(completeCommandLine('new-c', CONTEXT).text).toBe('new-client ')
    expect(completeCommandLine('command-', CONTEXT).candidates).toEqual([])
  })

  it('화면 이름: select-window -t 와 join-pane -s', () => {
    expect(completeCommandLine('select-window -t 비', CONTEXT)).toEqual({ text: 'select-window -t 비교 ', candidates: ['비교'] })
    const both = completeCommandLine('select-window -t 읽', CONTEXT)
    expect(both.candidates).toEqual(['읽기', '읽기 2'])
    expect(both.text).toBe('select-window -t 읽기')
    expect(completeCommandLine('selectw 비', CONTEXT).text).toBe('selectw 비교 ')
    expect(completeCommandLine('join-pane -s 비', CONTEXT).text).toBe('join-pane -s 비교 ')
  })

  it('이름에 빈칸이 있는 후보 하나만 남으면 따옴표로 감싼다', () => {
    expect(completeCommandLine('select-window -t ', CONTEXT).candidates).toEqual(['읽기', '비교', '읽기 2'])
    expect(completeCommandLine('apply-template 빈', CONTEXT).text).toBe('apply-template "빈 화면" ')
  })

  it('템플릿 · 배치 · 색 이름', () => {
    expect(completeCommandLine('new-window -t 정', CONTEXT).text).toBe('new-window -t 정리 ')
    expect(completeCommandLine('apply-template 노', CONTEXT).text).toBe('apply-template "노트 왼쪽" ')
    expect(completeCommandLine('select-layout ma', CONTEXT).candidates).toEqual(['main-vertical', 'main-horizontal'])
    expect(completeCommandLine('select-layout ti', CONTEXT).text).toBe('select-layout tiled ')
    expect(completeCommandLine('set-channel or', CONTEXT).text).toBe('set-channel orange ')
  })

  it('; 뒤에서는 새 명령으로 완성하고 앞 줄은 그대로 둔다', () => {
    expect(completeCommandLine('split-window -h ; sel', CONTEXT).candidates).toEqual(['select-pane', 'select-window', 'select-layout'])
    expect(completeCommandLine('split-window -h ; next-w', CONTEXT).text).toBe('split-window -h ; next-window ')
    expect(completeCommandLine('split-window -h;next-w', CONTEXT).text).toBe('split-window -h;next-window ')
  })

  it('세션 이름: switch-client(-t 와 첫 인자) · kill-session -t', () => {
    const context = { ...CONTEXT, sessionNames: ['기본', '논문', '논문 초안', '발표'] }
    expect(completeCommandLine('switch-client -t 발', context).text).toBe('switch-client -t 발표 ')
    expect(completeCommandLine('switchc 발', context).text).toBe('switchc 발표 ')
    expect(completeCommandLine('switch-client -t 논', context).candidates).toEqual(['논문', '논문 초안'])
    expect(completeCommandLine('switch-client -t 논', context).text).toBe('switch-client -t 논문')
    expect(completeCommandLine('kill-session -t 기', context).text).toBe('kill-session -t 기본 ')
    // 이름에 빈칸이 든 후보는 따옴표로 감싼다
    expect(completeCommandLine('switch-client -t 논문 ', { ...context, sessionNames: ['논문 초안'] }).candidates).toEqual([])
    expect(completeCommandLine('switch-client -t 논문 초', { ...context, sessionNames: ['논문 초안'] }).candidates).toEqual([])
    expect(completeCommandLine('switch-client -t 논', { ...context, sessionNames: ['논문 초안'] }).text).toBe('switch-client -t "논문 초안" ')
    // 세션 이름이 없는 맥락에서는 후보가 없다
    expect(completeCommandLine('switch-client -t 기', CONTEXT).candidates).toEqual([])
  })

  it('줄임말로 쓴 명령의 인자도 완성한다', () => {
    expect(completeCommandLine('selectw -t 비', CONTEXT).text).toBe('selectw -t 비교 ')
    expect(completeCommandLine('neww -t 정', CONTEXT).text).toBe('neww -t 정리 ')
  })
})
