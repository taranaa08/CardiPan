import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { fmt, type MissingIngredient, type Recipe, type Today } from '../api'

export type Picked = { recipe: Recipe; entryId: number; missing: MissingIngredient[]; today: Today }

type Props = {
  picked: Picked
  onUndo: () => void
  onClose: () => void
}

export function SelectionSheet({ picked, onUndo, onClose }: Props) {
  const { recipe, missing, today } = picked
  const remaining = today.remaining_mg ?? 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      className="sheet-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      >
        <p className="sheet-kicker">Added to today</p>
        <h2 id="sheet-title">
          <span aria-hidden>{recipe.emoji}</span> {recipe.name}
        </h2>
        <div className="sheet-math">
          <span>
            +{fmt(recipe.sodium_mg_per_serving)} mg <small>1 serving</small>
          </span>
          <span className={remaining < 0 ? 'sheet-left sheet-left--over' : 'sheet-left'}>
            {fmt(Math.abs(remaining))} mg {remaining < 0 ? 'over' : 'left'} today
          </span>
        </div>

        {missing.length === 0 ? (
          <p className="sheet-ready">You have everything. Nothing to buy.</p>
        ) : (
          <>
            <h3>
              You'll need {missing.length} more thing{missing.length === 1 ? '' : 's'}
            </h3>
            <ul className="sheet-missing">
              {missing.map((m) => (
                <li key={m.id}>
                  <span aria-hidden>{m.emoji}</span>
                  <span>{m.display}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="actions">
          <button type="button" className="btn btn--ghost" onClick={onUndo}>
            Undo
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>
            Back to meals
          </button>
        </div>
      </motion.section>
    </motion.div>
  )
}
