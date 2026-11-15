import { describe, expect, it } from 'vitest'
import { keyTokenOf, parseKeysConf, prefixComboOf } from './keysConf'

describe('keys.conf', () => {
  it('bind-key · unbind-key · set prefix 를 읽는다', () => {
    const conf = parseKeysConf([
      '# 내 키',
      'set prefix C-b',
      'bind-key v split-window -h',
      'bind Left select-pane -L',
      'bind-key "%" split-window -v   # 따옴표 키와 줄 끝 주석',
      'unbind-key x',
      '',
      'bind-key o open "노트 A" ; select-pane -R',
    ].join('\n'))
    expect(conf.errors).toEqual([])
    expect(conf.prefix).toBe('Ctrl+B')
    expect(conf.bindings).toEqual({
      v: 'split-window -h',
      ArrowLeft: 'select-pane -L',
      '%': 'split-window -v',
      x: '',
      o: 'open "노트 A" ; select-pane -R',
    })
  })

  it('접두키 이름: C-Space · C-b · C-a(대소문자 무관), 모르는 것은 null', () => {
    expect(prefixComboOf('C-Space')).toBe('Ctrl+Space')
    expect(prefixComboOf('C-A')).toBe('Ctrl+A')
    expect(prefixComboOf('Ctrl-b')).toBe('Ctrl+B')
    expect(prefixComboOf('M-b')).toBeNull()
    expect(prefixComboOf('C-F5')).toBeNull()
  })

  it('키 이름: 글자 · 기호 · Space · 방향', () => {
    expect(keyTokenOf('Space')).toBe(' ')
    expect(keyTokenOf('Left')).toBe('ArrowLeft')
    expect(keyTokenOf('up')).toBe('ArrowUp')
    expect(keyTokenOf('%')).toBe('%')
    expect(keyTokenOf('z')).toBe('z')
    expect(keyTokenOf('F5')).toBeNull()
  })

  it('틀린 줄은 건너뛰고 줄 번호와 함께 알린다(나머지는 읽는다)', () => {
    const conf = parseKeysConf('bind-key\nbind-key F5 next-window\nset prefix M-x\nset status off\nfoo bar\nbind-key n next-window\nunbind-key')
    expect(conf.bindings).toEqual({ n: 'next-window' })
    expect(conf.prefix).toBeNull()
    expect(conf.errors.map((error) => error.split(':')[0])).toEqual(['1', '2', '3', '4', '5', '7'])
  })

  it('빈 글과 주석만이면 아무것도 바꾸지 않는다. CRLF 도 읽는다', () => {
    expect(parseKeysConf('')).toEqual({ bindings: {}, prefix: null, errors: [] })
    expect(parseKeysConf('# 주석\r\n\r\nbind-key v split-window -h\r\n').bindings).toEqual({ v: 'split-window -h' })
  })

  it('묶음의 따옴표를 지킨다: 이름의 공백 · 따옴표 안의 ; 는 한 낱말, 따옴표 밖의 \; 는 명령을 잇는다', () => {
    const conf = parseKeysConf('bind-key s select-window -t "읽기 2"\nbind-key o open "a;b"\nbind-key m split-window -h \; select-pane -L')
    expect(conf.bindings.s).toBe('select-window -t "읽기 2"')
    expect(conf.bindings.o).toBe('open "a;b"')
    expect(conf.bindings.m).toBe('split-window -h ; select-pane -L')
  })
})
