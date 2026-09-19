import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion'
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

  // The hero scrolls away with the page; a small pinned pill keeps the allowance visible.
  const numberRef = useRef<HTMLParagraphElement>(null)
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    const el = numberRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setPinned(!entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const fill = <div className="budget-fill" style={{ transform: `scaleX(${used})` }} />

  return (
    <>
      <header className={`budget budget--${level}`}>
        <p className="eyebrow">Today's sodium</p>
        <p ref={numberRef} className="budget-remaining" aria-live="polite">
          {fmt(Math.abs(shown))}
          <span className="budget-unit"> mg {remaining < 0 ? 'over' : 'left'}</span>
        </p>
        <div
          className="budget-bar"
          role="meter"
          aria-label="Sodium used today"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={today.consumed_mg}
        >
          {fill}
        </div>
        <div className="budget-meta">
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
          <button type="button" className="budget-target" onClick={onEditTarget} aria-label="Change daily target">
            of {fmt(target)} mg <span aria-hidden>✎</span>
          </button>
        </div>
        {open && count > 0 && (
          <ul className="budget-entries">
            {today.entries.map((e) => (
              <li key={e.id}>
                <span>{e.label}</span>
                <span className="budget-entry-mg">{fmt(e.sodium_mg)} mg</span>
                <button
                  type="button"
                  aria-label={`Remove ${e.label}`}
                  onClick={() => onRemoveEntry(e.id, e.recipe_id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </header>

      <AnimatePresence>
        {pinned && (
          <motion.div
            className={`budget-pill budget--${level}`}
            aria-hidden
            initial={{ y: -64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -64, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <strong>{fmt(Math.abs(remaining))}</strong> mg {remaining < 0 ? 'over' : 'left'}
            <span className="budget-bar budget-bar--pill">{fill}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
