import { describe, expect, it } from 'vitest'
import { extractMentions, hasMentions, parseMentions } from './mentions'

describe('extractMentions', () => {
  it('extracts usernames from @mentions', () => {
    expect(extractMentions('hey @alice and @bob.smith, check this out')).toEqual(['alice', 'bob.smith'])
  })

  it('returns an empty array when there are no mentions', () => {
    expect(extractMentions('no mentions here')).toEqual([])
  })
})

describe('hasMentions', () => {
  it('detects the presence of a mention', () => {
    expect(hasMentions('hi @carol')).toBe(true)
    expect(hasMentions('hi there')).toBe(false)
  })
})

describe('parseMentions', () => {
  it('splits plain text around regex-detected mentions when no metadata is given', () => {
    const parts = parseMentions('hello @dave bye')
    expect(parts).toEqual([
      { type: 'text', content: 'hello ' },
      { type: 'mention', content: '@dave', username: 'dave' },
      { type: 'text', content: ' bye' },
    ])
  })

  it('uses explicit mention metadata (with userId) when provided', () => {
    const text = 'hello @dave bye'
    const parts = parseMentions(text, [
      { userId: '42', username: 'dave', startIndex: 6, endIndex: 11 },
    ])
    expect(parts).toEqual([
      { type: 'text', content: 'hello ' },
      { type: 'mention', content: '@dave', userId: '42', username: 'dave', avatar: undefined },
      { type: 'text', content: ' bye' },
    ])
  })

  it('returns an empty array for empty text', () => {
    expect(parseMentions('')).toEqual([])
  })

  it('ignores out-of-range mention metadata', () => {
    const text = 'short'
    const parts = parseMentions(text, [
      { userId: '1', username: 'x', startIndex: 0, endIndex: 999 },
    ])
    // out-of-range mention filtered out, falls back to regex scan (no @ in text)
    expect(parts).toEqual([{ type: 'text', content: 'short' }])
  })
})
