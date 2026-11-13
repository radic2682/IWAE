// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resetStartupDialogs, useStartupDialog } from './startupDialogs'

function Probe({ id, wanted, priority }: { readonly id: string; readonly wanted: boolean; readonly priority?: number }) {
  const open = useStartupDialog(id, wanted, priority)
  return open ? <div role="dialog" aria-label={id} /> : null
}

const shown = () => screen.queryAllByRole('dialog').map((element) => element.getAttribute('aria-label'))

afterEach(() => {
  cleanup()
  resetStartupDialogs()
})

describe('시작 대화상자 줄', () => {
  it('혼자 해당하면 바로 뜬다', () => {
    render(<Probe id="a" wanted />)
    expect(shown()).toEqual(['a'])
  })

  it('해당하지 않으면 뜨지 않는다', () => {
    render(<Probe id="a" wanted={false} />)
    expect(shown()).toEqual([])
  })

  it('둘이 한꺼번에 해당하면 하나씩, 앞 것이 닫힌 뒤에 다음 것이 뜬다', () => {
    const { rerender } = render(<><Probe id="first" wanted /><Probe id="second" wanted /></>)
    expect(shown()).toEqual(['first'])
    rerender(<><Probe id="first" wanted={false} /><Probe id="second" wanted /></>)
    expect(shown()).toEqual(['second'])
  })

  it('priority 가 작은 것이 먼저 뜬다', () => {
    render(<><Probe id="late" wanted priority={50} /><Probe id="early" wanted priority={10} /></>)
    expect(shown()).toEqual(['early'])
  })

  it('나중에 해당하게 된 것은 앞 것이 닫힌 뒤에 뜬다', () => {
    const { rerender } = render(<><Probe id="a" wanted /><Probe id="b" wanted={false} /></>)
    rerender(<><Probe id="a" wanted /><Probe id="b" wanted /></>)
    expect(shown()).toEqual(['a'])
    rerender(<><Probe id="a" wanted={false} /><Probe id="b" wanted /></>)
    expect(shown()).toEqual(['b'])
  })

  it('떠 있던 컴포넌트가 사라지면 자리를 내놓는다', () => {
    const { rerender } = render(<><Probe id="a" wanted /><Probe id="b" wanted /></>)
    rerender(<Probe id="b" wanted />)
    expect(shown()).toEqual(['b'])
  })
})
