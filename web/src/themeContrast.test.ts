import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]))
}

function block(selector: RegExp): string {
  const match = css.match(selector)
  assert.ok(match, `${selector} block found in index.css`)
  return match[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const light = tokens(block(/@theme\s*\{([^}]*)\}/))
const themes = { light, dark: { ...light, ...tokens(block(/\.dark\s*\{([^}]*)\}/)) } }

test('neutral text tokens clear WCAG AA 4.5:1 on every surface in both themes', () => {
  const failures: string[] = []
  for (const [theme, palette] of Object.entries(themes)) {
    for (const text of ['fg', 'fg-soft', 'muted', 'faint']) {
      for (const surface of ['bg', 'surface', 'surface-2', 'surface-hover']) {
        const ratio = contrast(palette[text], palette[surface])
        if (ratio < 4.5) failures.push(`${theme} ${text} on ${surface} ${ratio.toFixed(2)}:1`)
      }
    }
  }
  assert.deepEqual(failures, [])
})

// The active nav link fills with accent-soft (rgba) over the sidebar surface.
function over(rgba: string, base: string): string {
  const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number)
  return '#' + [r, g, b].map((c, i) => Math.round(c * a + parseInt(base.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')
}
const softs = {
  light: block(/@theme\s*\{([^}]*)\}/).match(/--color-accent-soft:\s*(rgba\([^)]*\))/)![1],
  dark: block(/\.dark\s*\{([^}]*)\}/).match(/--color-accent-soft:\s*(rgba\([^)]*\))/)![1],
}

test('muted, the active nav hotkey chip text, clears 4.5:1 on the active link fill in both themes', () => {
  for (const [theme, palette] of Object.entries(themes)) {
    const fill = over(softs[theme as keyof typeof softs], palette.surface)
    const ratio = contrast(palette.muted, fill)
    assert.ok(ratio >= 4.5, `${theme} muted on accent-soft ${ratio.toFixed(2)}:1`)
  }
})
