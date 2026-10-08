/**
 * The terminal's shared pieces (v3 Phase 2): colour, and line input that a script can
 * pipe. Moved out of `play.ts` so the run's menus (`runPlay.ts`) ask the same way the
 * game's do, from the one input queue -- two readers on stdin would each see half the
 * lines.
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const useColor = !process.env['NO_COLOR']
export const paint = (code: string, text: string) => (useColor ? `[${code}m${text}[0m` : text)
export const bold = (t: string) => paint('1', t)
export const dim = (t: string) => paint('2', t)
export const red = (t: string) => paint('31', t)
export const green = (t: string) => paint('32', t)
export const yellow = (t: string) => paint('33', t)
export const cyan = (t: string) => paint('36', t)
export const magenta = (t: string) => paint('35', t)

const rl = createInterface({ input: stdin, output: stdout })

/**
 * Buffered line input.
 *
 * `rl.question()` only captures lines emitted *after* it is called. That is fine
 * when a human types, but piped input arrives all at once, so every line after the
 * first is dropped and the game exits mid-turn. Queueing the lines ourselves makes
 * the client scriptable -- which is how it gets tested, and how a session can be
 * replayed from a file.
 */
const queued: string[] = []
const waiting: ((line: string) => void)[] = []
let inputClosed = false

rl.on('line', (line) => {
  const next = waiting.shift()
  if (next) next(line)
  else queued.push(line)
})
rl.on('close', () => {
  inputClosed = true
  // Anything still waiting gets a quit rather than hanging forever.
  for (const next of waiting.splice(0)) next('q')
})

export function ask(prompt: string): Promise<string> {
  stdout.write(prompt)
  const line = queued.shift()
  if (line !== undefined) return Promise.resolve(line)
  if (inputClosed) return Promise.resolve('q')
  return new Promise((resolve) => waiting.push(resolve))
}

/** Lets the process exit once the game or the run is over. */
export function closeInput(): void {
  rl.close()
}
