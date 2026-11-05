/**
 * Compact ("lazy") SDK declarations: the selector that decides which visible
 * tool bindings omit their inline JSON Schema and instead resolve it through
 * `describe_tools` on demand.
 * @module
 */

/** Escape one literal character for embedding in a RegExp source. */
function escapeRegExp(char: string): string {
  return /[.*+?^${}()|[\]\\]/u.test(char) ? `\\${char}` : char
}

/**
 * Compile one tool-name pattern into an anchored matcher.
 *
 * `*` matches any run of characters (including none), `?` matches exactly one
 * character, and every other character is literal. The pattern has to match
 * the complete tool name.
 * @param pattern - configured pattern, for example `mcp__*`.
 * @returns the anchored matcher for that pattern.
 */
export function compileLazyToolPattern(pattern: string): RegExp {
  let source = ''
  for (const char of pattern) {
    source += char === '*' ? '.*' : char === '?' ? '.' : escapeRegExp(char)
  }
  return new RegExp(`^${source}$`, 'u')
}

/**
 * Whether one tool name is selected by any configured pattern.
 * @param name - model-facing tool name.
 * @param patterns - configured patterns.
 * @returns true when at least one pattern matches the complete name.
 */
export function matchesLazyTool(name: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => compileLazyToolPattern(pattern).test(name))
}

/**
 * Select the visible names whose declarations must stay compact.
 * @param tools - visible tool definitions, in any order.
 * @param patterns - configured patterns.
 * @returns the selected names.
 */
export function lazyToolNames(
  tools: readonly { readonly name: string }[],
  patterns: readonly string[],
): ReadonlySet<string> {
  if (patterns.length === 0) return new Set()
  return new Set(tools.filter(tool => matchesLazyTool(tool.name, patterns)).map(tool => tool.name))
}
