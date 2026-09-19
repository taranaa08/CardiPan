import { useEffect, useState } from 'react'
import { api, fmt, localDay, type Fit, type RecipeSummary } from '../api'

type Filter = 'all' | 'fits'

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

  const q = query.trim().toLowerCase()
  const fitting = recipes.filter((r) => r.fit.status === 'fits' || r.fit.status === 'swap')
  const shown = (filter === 'fits' ? fitting : recipes).filter(
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
        <button type="button" role="radio" aria-checked={filter === 'all'} onClick={() => setFilter('all')}>
          All {recipes.length}
        </button>
        <button type="button" role="radio" aria-checked={filter === 'fits'} onClick={() => setFilter('fits')}>
          Fits today {fitting.length}
        </button>
      </div>

      {shown.length === 0 && <p className="empty-note">No recipes match.</p>}

      <ul className="recipe-list">
        {shown.map((r) => (
          <li key={r.id}>
            <button type="button" className="recipe-row" onClick={() => onOpen(r.id)}>
              <span className="recipe-row-emoji" aria-hidden>
                {r.emoji}
              </span>
              <span className="recipe-row-main">
                <span className="recipe-row-name">{r.name}</span>
                <span className="recipe-row-meta">
                  {r.cuisine} · {r.minutes} min · have {r.have}/{r.ingredient_count}
                </span>
                <FitBadge fit={r.fit} remaining={remaining} />
              </span>
              <span className="recipe-row-mg">
                {fmt(r.sodium_mg_per_serving)}
                <small>mg</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
