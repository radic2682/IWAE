import { describe, expect, it } from 'vitest'
import { errorText, friendlyOsError } from './errorText'

describe('errorText', () => {
  it('keeps ordinary messages as they are', () => {
    expect(errorText(new Error('잘못된 이름'))).toBe('잘못된 이름')
    expect(errorText('plain')).toBe('plain')
  })

  it('turns common OS errors into plain words', () => {
    expect(errorText('The process cannot access the file because it is being used by another process. (os error 32)')).toContain('다른 앱이')
    expect(errorText(new Error('Access is denied. (os error 5)'))).toContain('권한이 없습니다')
    expect(errorText('No space left on device (os error 28)')).toContain('디스크 공간')
    expect(errorText('File exists (os error 17)')).toContain('이미 있습니다')
  })

  it('leaves unknown OS error numbers alone', () => {
    expect(friendlyOsError('weird (os error 9999)')).toBeNull()
    expect(errorText('weird (os error 9999)')).toBe('weird (os error 9999)')
  })
})
