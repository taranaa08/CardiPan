import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { api, fmt, localDay, type Fit, type RecipeSummary } from '../api'

type Filter = 'all' | 'fits' | 'deleted'

const UNDO_MS = 5000

const TrashIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6 0 .7 9.1A1.5 1.5 0 0 0 8.2 16.5h3.6a1.5 1.5 0 0 0 1.5-1.4L14 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function FitBadge({ fit, remaining }: { fit: Fit; remaining: number | null }) {
  if (fit.status === 'fits') return <span className="badge badge--fits">Fits today</span>
  if (fit.status === 'swap') return <span className="badge badge--swap">Fits with a swap</span>
  if (fit.status === 'over' && remaining !== null)
    return <span className="badge badge--over">{fmt(fit.sodium_mg - remaining)} mg over</span>
  return null
}

type Props = {
  consumedMg: number // refetch when the day's total changes
  onOpen: (id: string) => void
  onError: (e: unknown) => void
}

export function RecipesScreen({ consumedMg, onOpen, onError }: Props) {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [undo, setUndo] = useState<RecipeSummary | null>(null) // just deleted, offered for undo
  const undoTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  useEffect(() => {
    let live = true
    api.recipes(localDay()).then((res) => {
      if (!live) return
      setRecipes(res.recipes)
      setRemaining(res.today.remaining_mg)
    }, onError)
    return () => {
      live = false
    }
  }, [consumedMg, onError])

  if (!recipes) return <div className="screen" aria-busy />

  // Soft delete: flip the flag locally, then tell the server; put it back if that fails.
  function setRemoved(recipe: RecipeSummary, removed: boolean) {
    const flip = (value: boolean) =>
      setRecipes((rs) => rs && rs.map((r) => (r.id === recipe.id ? { ...r, removed: value } : r)))
    flip(removed)
    ;(removed ? api.removeRecipe(recipe.id) : api.restoreRecipe(recipe.id)).catch((e) => {
      flip(!removed)
      onError(e)
    })
    window.clearTimeout(undoTimer.current)
    if (removed) {
      setUndo(recipe)
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
    } else {
      setUndo(null)
    }
  }

  const q = query.trim().toLowerCase()
  const active = recipes.filter((r) => !r.removed)
  const deleted = recipes.filter((r) => r.removed)
  const fitting = active.filter((r) => r.fit.status === 'fits' || r.fit.status === 'swap')
  const view = filter === 'deleted' && deleted.length === 0 ? 'all' : filter
  const base = view === 'fits' ? fitting : view === 'deleted' ? deleted : active
  const shown = base.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q),
  )

  return (
    <div className="screen recipes">
      <p className="eyebrow">Recipes</p>
      <h1>Every meal, lowest sodium first</h1>
      <input
        type="search"
        className="search"
        placeholder="Search recipes or cuisines"
        aria-label="Search recipes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="filter" role="radiogroup" aria-label="Show">
        <button type="button" role="radio" aria-checked={view === 'all'} onClick={() => setFilter('all')}>
          All {active.length}
        </button>
        <button type="button" role="radio" aria-checked={view === 'fits'} onClick={() => setFilter('fits')}>
          Fits today {fitting.length}
        </button>
        {deleted.length > 0 && (
          <button
            type="button"
            role="radio"
            aria-checked={view === 'deleted'}
            onClick={() => setFilter('deleted')}
          >
            Deleted {deleted.length}
          </button>
        )}
      </div>

      {shown.length === 0 && <p className="empty-note">No recipes match.</p>}

      <ul className="recipe-list">
        {shown.map((r) => (
          <li key={r.id} className={r.removed ? 'recipe-item recipe-item--removed' : 'recipe-item'}>
            <button type="button" className="recipe-row" onClick={() => onOpen(r.id)}>
              <span className="recipe-row-emoji" aria-hidden>
                {r.emoji}
              </span>
              <span className="recipe-row-main">
                <span className="recipe-row-name">{r.name}</span>
                <span className="recipe-row-meta">
                  {r.cuisine} · {r.minutes} min · have {r.have}/{r.ingredient_count}
                </span>
                {!r.removed && <FitBadge fit={r.fit} remaining={remaining} />}
              </span>
              <span className="recipe-row-mg">
                {fmt(r.sodium_mg_per_serving)}
                <small>mg</small>
              </span>
            </button>
            {r.removed ? (
              <button type="button" className="btn btn--soft btn--small" onClick={() => setRemoved(r, false)}>
                Restore
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn"
                aria-label={`Delete ${r.name}`}
                title="Delete"
                onClick={() => setRemoved(r, true)}
              >
                <TrashIcon />
              </button>
            )}
          </li>
        ))}
      </ul>

      <AnimatePresence>
        {undo && (
          <motion.div
            className="toast"
            role="status"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
          >
            <span>
              Deleted <strong>{undo.name}</strong>
            </span>
            <button type="button" onClick={() => setRemoved(undo, false)}>
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
