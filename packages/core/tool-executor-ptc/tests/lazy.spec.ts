import { describe, expect, it } from 'vitest'
import { compileLazyToolPattern, lazyToolNames, matchesLazyTool } from '../src/lazy.ts'

describe('compact tool selection', () => {
  it('anchors one wildcard pattern to the complete name', () => {
    expect(compileLazyToolPattern('mcp__*').test('mcp__github__search')).toBe(true)
    expect(compileLazyToolPattern('mcp__*').test('read')).toBe(false)
    expect(compileLazyToolPattern('mcp__?').test('mcp__a')).toBe(true)
    expect(compileLazyToolPattern('mcp__?').test('mcp__ab')).toBe(false)
  })

  it('treats regex metacharacters as literals', () => {
    expect(matchesLazyTool('mcp__a.b', ['mcp__a.b'])).toBe(true)
    expect(matchesLazyTool('mcp__axb', ['mcp__a.b'])).toBe(false)
    expect(matchesLazyTool('read', ['re(a)d'])).toBe(false)
  })

  it('selects no names without patterns and every matching name otherwise', () => {
    const tools = [{ name: 'mcp__a' }, { name: 'mcp__b' }, { name: 'read' }]
    expect(lazyToolNames(tools, [])).toEqual(new Set())
    expect(lazyToolNames(tools, ['mcp__*'])).toEqual(new Set(['mcp__a', 'mcp__b']))
    expect(lazyToolNames(tools, ['read', 'mcp__a'])).toEqual(new Set(['read', 'mcp__a']))
  })
})
