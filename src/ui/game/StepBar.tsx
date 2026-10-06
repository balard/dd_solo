/**
 * Where an exchange stands (v2 Phase 9b): its steps, the one on screen lit, and the
 * SAIs it waits on as chips.
 *
 * It belongs to the exchange, so a roll card and a decision sheet in the same exchange
 * draw the same bar (9a finding 1). A chip shows the order SAIs resolve in; it is 16px
 * tall, under the 44px tap floor, so nothing is ever chosen by tapping one (finding 2).
 *
 * Layout per screen is CSS's: on a phone upright the chips take a row of their own
 * under the steps, and on a short screen only the current step keeps its name.
 */
import { Fragment } from 'react'

import { barSteps, stepState, type Exchange } from './exchange'

export function StepBar({ exchange }: { exchange: Exchange }) {
  const steps = barSteps(exchange.kind)
  const now = steps.findIndex(({ step }) => step === exchange.at)
  return (
    <div
      className="step-bar"
      aria-label={`${steps[0]?.label ?? ''} exchange, step ${now + 1} of ${steps.length}: ${steps[now]?.label ?? ''}`}
    >
      {steps.map(({ step, label }, i) => {
        const state = stepState(exchange, step)
        return (
          <Fragment key={step}>
            {i > 0 && <span className="step-sep" aria-hidden="true" />}
            <span className={`step is-${state}`} {...(state === 'now' ? { 'aria-current': 'step' as const } : {})}>
              <span className="step-dot" aria-hidden="true">
                {state === 'done' ? '✓' : ''}
              </span>
              <span className="step-label">{label}</span>
            </span>
            {exchange.chips
              .filter((chip) => chip.on === step)
              .map((chip, j) => (
                <span key={j} className={`step-chip is-${chip.state}`} title={`${chip.name}: ${chip.state}`}>
                  ★ {chip.name}
                </span>
              ))}
          </Fragment>
        )
      })}
      {/* Where the chips wrap to on a narrow screen: see the CSS. */}
      {exchange.chips.length > 0 && <span className="step-bar-break" aria-hidden="true" />}
    </div>
  )
}
