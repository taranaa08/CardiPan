import { animate, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { fmt, type Today } from '../api'

function useAnimatedNumber(value: number) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduce) {
      from.current = value
      return
    }
    const controls = animate(from.current, value, {
      duration: 0.7,
      ease: 'easeOut',
      onUpdate: (v) => {
        from.current = v
        setShown(Math.round(v))
      },
    })
    return () => controls.stop()
  }, [value, reduce])
  return reduce ? value : shown
}

type Props = {
  today: Today
  onEditTarget: () => void
  onRemoveEntry: (entryId: number, recipeId: string | null) => void
}

export function BudgetHeader({ today, onEditTarget, onRemoveEntry }: Props) {
  const target = today.target_mg ?? 0
  const remaining = today.remaining_mg ?? 0
  const shown = useAnimatedNumber(remaining)
  const [open, setOpen] = useState(false)
  const used = target > 0 ? Math.min(today.consumed_mg / target, 1) : 0
  const level = remaining < 0 ? 'over' : remaining < target * 0.25 ? 'low' : 'ok'
  const count = today.entries.length

  return (
    <header className={`budget budget--${level}`}>
      <div className="budget-top">
        <span className="budget-label">Today's sodium</span>
        <button type="button" className="budget-target" onClick={onEditTarget} aria-label="Change daily target">
          Target {fmt(target)} mg <span aria-hidden>✎</span>
        </button>
      </div>
      <p className="budget-remaining" aria-live="polite">
        <strong>{fmt(Math.abs(shown))}</strong> mg {remaining < 0 ? 'over' : 'left'}
      </p>
      <div
        className="budget-bar"
        role="meter"
        aria-label="Sodium used today"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={today.consumed_mg}
      >
        <div className="budget-fill" style={{ transform: `scaleX(${used})` }} />
      </div>
      <button
        type="button"
        className="budget-summary"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={count === 0}
      >
        {fmt(today.consumed_mg)} mg planned
        {count > 0 && ` · ${count} meal${count === 1 ? '' : 's'} ${open ? '▴' : '▾'}`}
      </button>
      {open && count > 0 && (
        <ul className="budget-entries">
          {today.entries.map((e) => (
            <li key={e.id}>
              <span>{e.label}</span>
              <span className="budget-entry-mg">{fmt(e.sodium_mg)} mg</span>
              <button type="button" aria-label={`Remove ${e.label}`} onClick={() => onRemoveEntry(e.id, e.recipe_id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </header>
  )
}
