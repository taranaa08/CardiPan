import { useEffect, useState, type CSSProperties } from 'react'
import { api, fmt, localDay, type RecipeDetail as Detail } from '../api'
import { hue } from '../hue'
import { FitBadge } from './RecipesScreen'

const TOP_SOURCES = 4

type Props = {
  recipeId: string
  consumedMg: number // refetch when the day's total changes
  onBack: () => void
  onAdd: (recipe: Detail) => void
  onError: (e: unknown) => void
}

export function RecipeDetail({ recipeId, consumedMg, onBack, onAdd, onError }: Props) {
  const [recipe, setRecipe] = useState<Detail | null>(null)

  useEffect(() => {
    let live = true
    api.recipe(recipeId, localDay()).then((r) => live && setRecipe(r), onError)
    return () => {
      live = false
    }
  }, [recipeId, consumedMg, onError])

  if (!recipe || recipe.id !== recipeId) return <div className="screen" aria-busy />

  const { fit, today } = recipe
  const total = recipe.sodium_mg_per_serving
  const sources = [...recipe.ingredients].sort((a, b) => b.sodium_mg_per_serving - a.sodium_mg_per_serving)
  const top = sources.slice(0, TOP_SOURCES)
  const rest = sources.slice(TOP_SOURCES).reduce((sum, i) => sum + i.sodium_mg_per_serving, 0)
  const mg = (n: number) => (n > 0 && n < 1 ? '<1' : fmt(Math.round(n)))

  return (
    <article className="screen detail">
      <button type="button" className="back" onClick={onBack}>
        ← Back
      </button>

      <div className="detail-hero" style={{ '--hue': hue(recipe.id) } as CSSProperties}>
        <span aria-hidden>{recipe.emoji}</span>
      </div>

      <h1>{recipe.name}</h1>
      <p className="detail-meta">
        {recipe.cuisine} · {recipe.minutes} min · serves {recipe.servings}
      </p>
      <p className="lede">{recipe.blurb}</p>

      <section className="panel">
        <div className="detail-sodium">
          <span className="card-mg">
            {fmt(total)} <small>mg</small>
          </span>
          <span className="card-mg-note">
            sodium per serving
            <br />
            <FitBadge fit={fit} remaining={today.remaining_mg} />
          </span>
        </div>

        <h2>Where the sodium comes from</h2>
        <ul className="sources">
          {top.map((i) => (
            <li key={i.id}>
              <span className="source-name">{i.name}</span>
              <span className="source-bar" aria-hidden>
                <span style={{ transform: `scaleX(${total ? i.sodium_mg_per_serving / total : 0})` }} />
              </span>
              <span className="source-mg">{mg(i.sodium_mg_per_serving)} mg</span>
            </li>
          ))}
          {rest > 0 && (
            <li>
              <span className="source-name">Everything else</span>
              <span className="source-bar" aria-hidden>
                <span style={{ transform: `scaleX(${rest / total})` }} />
              </span>
              <span className="source-mg">{mg(rest)} mg</span>
            </li>
          )}
        </ul>

        {recipe.available_swaps.length > 0 && (
          <>
            <h2>Ways to cut sodium</h2>
            <ul className="swaps">
              {recipe.available_swaps.map((s) => (
                <li key={s.from_id}>
                  <span>{s.note}</span>
                  <span className="swap-saved">−{fmt(s.mg_saved_per_serving)} mg</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2>
          Ingredients{' '}
          <span className="detail-count">
            you have {recipe.have} of {recipe.ingredient_count}
          </span>
        </h2>
        <ul className="ingredients">
          {recipe.ingredients.map((i) => (
            <li key={i.id} className={i.in_pantry ? '' : 'ingredient--missing'}>
              <span aria-hidden>{i.emoji}</span>
              <span className="ingredient-display">{i.display}</span>
              <span className="ingredient-tag">{i.in_pantry ? '✓ Have' : 'Need'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Steps</h2>
        <ol className="steps">
          {recipe.steps.map((s, n) => (
            <li key={n}>{s}</li>
          ))}
        </ol>
      </section>

      {fit.status && (
        <div className="detail-footer">
          {fit.status === 'over' ? (
            <p>
              One serving is {fmt(fit.sodium_mg - (today.remaining_mg ?? 0))} mg more than you have left today.
            </p>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => onAdd(recipe)}>
              {fit.status === 'swap' ? 'Add with swaps' : 'Add to today'} · {fmt(fit.sodium_mg)} mg
            </button>
          )}
        </div>
      )}
    </article>
  )
}
