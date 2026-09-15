/**
 * Enforces the engine purity invariants from CLAUDE.md as a test, so they fail the
 * build rather than relying on good intentions.
 *
 * The checker is a pure function over file contents so it can be tested against
 * deliberate violations -- a guard that has never been seen to fail is not a guard.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Directories that must stay free of UI and ambient randomness. */
const PURE_DIRS = ['src/engine', 'src/ai']

const ROOT = join(import.meta.dirname, '..', '..')

interface SourceFile {
  readonly path: string
  readonly content: string
}

interface Violation {
  readonly path: string
  readonly line: number
  readonly rule: string
  readonly text: string
}

const IMPORT_PATTERN = /^\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/
const BARE_IMPORT_PATTERN = /^\s*import\s+['"]([^'"]+)['"]/

export function findViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = []

  for (const file of files) {
    const lines = file.content.split('\n')

    lines.forEach((text, index) => {
      const line = index + 1

      // Rule 1: no React, no DOM, no UI. The dependency runs one way only.
      const specifier =
        IMPORT_PATTERN.exec(text)?.[1] ?? BARE_IMPORT_PATTERN.exec(text)?.[1] ?? undefined
      if (specifier !== undefined) {
        const forbidden =
          specifier === 'react' ||
          specifier.startsWith('react/') ||
          specifier.startsWith('react-dom') ||
          specifier.includes('/ui/') ||
          specifier.endsWith('/ui')
        if (forbidden) {
          violations.push({ path: file.path, line, rule: 'no-ui-import', text: text.trim() })
        }
      }

      // Rule 2: randomness comes from the seeded PRNG in GameState, never ambient.
      // Skip comment lines so this file and others can name the rule in prose.
      const code = text.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '')
      if (/\bMath\s*\.\s*random\b/.test(code)) {
        violations.push({ path: file.path, line, rule: 'no-math-random', text: text.trim() })
      }
    })
  }

  return violations
}

function collectSources(dir: string): SourceFile[] {
  const absolute = join(ROOT, dir)
  let entries: string[]
  try {
    entries = readdirSync(absolute)
  } catch {
    return [] // directory not created yet -- fine, it will be
  }

  const files: SourceFile[] = []
  for (const entry of entries) {
    const full = join(absolute, entry)
    if (statSync(full).isDirectory()) {
      files.push(...collectSources(join(dir, entry)))
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      // Tests are not shipped engine code, and they legitimately contain the very
      // things the rules forbid -- this file's own fixtures being the example.
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      files.push({
        path: relative(ROOT, full).replaceAll('\\', '/'),
        content: readFileSync(full, 'utf8'),
      })
    }
  }
  return files
}

describe('findViolations', () => {
  it('catches a React import', () => {
    const found = findViolations([{ path: 'x.ts', content: "import { useState } from 'react'" }])
    expect(found.map((v) => v.rule)).toEqual(['no-ui-import'])
  })

  it('catches a reach into the UI layer', () => {
    const found = findViolations([
      { path: 'x.ts', content: "import { Board } from '../ui/Board'" },
    ])
    expect(found.map((v) => v.rule)).toEqual(['no-ui-import'])
  })

  it('catches ambient randomness, including spaced-out spellings', () => {
    const found = findViolations([
      { path: 'x.ts', content: 'const roll = Math.random()' },
      { path: 'y.ts', content: 'const roll = Math . random ()' },
    ])
    expect(found.map((v) => v.rule)).toEqual(['no-math-random', 'no-math-random'])
  })

  it('allows naming the rules in comments', () => {
    expect(
      findViolations([{ path: 'x.ts', content: '// never call Math.random() here' }]),
    ).toEqual([])
  })

  it('allows ordinary engine code', () => {
    expect(
      findViolations([
        { path: 'x.ts', content: "import type { GameState } from './types'\nexport const x = 1" },
      ]),
    ).toEqual([])
  })
})

describe.each(PURE_DIRS)('%s stays pure', (dir) => {
  it('imports no UI and uses no ambient randomness', () => {
    const violations = findViolations(collectSources(dir))
    const rendered = violations.map((v) => `${v.path}:${v.line} [${v.rule}] ${v.text}`)
    expect(rendered).toEqual([])
  })
})
