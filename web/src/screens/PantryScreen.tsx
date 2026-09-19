import { useMemo, useState } from 'react'
import type { Catalog } from '../api'

type Props = {
  catalog: Catalog
  pantry: Set<string>
  onToggle: (id: string) => void
  onAddMany: (ids: string[]) => void
  onClear: () => void
  onDone: () => void
}

export function PantryScreen({ catalog, pantry, onToggle, onAddMany, onClear, onDone }: Props) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const categories = useMemo(
    () =>
      catalog.categories
        .map((c) => ({ ...c, items: c.items.filter((i) => !q || i.name.toLowerCase().includes(q)) }))
        .filter((c) => c.items.length > 0),
    [catalog, q],
  )
  const starterMissing = catalog.starter.filter((id) => !pantry.has(id))

  return (
    <div className="screen pantry">
      <h1>What's in your kitchen?</h1>
      <p className="lede">Tap everything you have. We'll only suggest meals you can make.</p>

      <div className="pantry-tools">
        <input
          type="search"
          className="search"
          placeholder="Search ingredients"
          aria-label="Search ingredients"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="btn btn--soft"
          disabled={starterMissing.length === 0}
          onClick={() => onAddMany(starterMissing)}
        >
          + Everyday basics
        </button>
      </div>

      {categories.length === 0 && <p className="empty-note">No ingredient matches “{query}”.</p>}

      {categories.map((c) => (
        <section key={c.name} className="pantry-group">
          <h2>{c.name}</h2>
          <div className="tiles">
            {c.items.map((i) => {
              const on = pantry.has(i.id)
              return (
                <button
                  key={i.id}
                  type="button"
                  className="tile"
                  aria-pressed={on}
                  onClick={() => onToggle(i.id)}
                >
                  <span className="tile-emoji" aria-hidden>
                    {i.emoji}
                  </span>
                  <span className="tile-name">{i.name}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <div className="pantry-footer">
        <button type="button" className="btn btn--ghost" onClick={onClear} disabled={pantry.size === 0}>
          Clear
        </button>
        <button type="button" className="btn btn--primary" onClick={onDone} disabled={pantry.size === 0}>
          See meals · {pantry.size} item{pantry.size === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}
