import { AnimatePresence, animate, motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { fmt, type Recipe } from '../api'

export type Direction = 1 | -1 // 1 = pick (right), -1 = skip (left)

const SWIPE_THRESHOLD = 120

function hue(id: string) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

type CardProps = {
  recipe: Recipe
  index: number
  remaining: number
  onDecide: (dir: Direction) => void
}

function SwipeCard({ recipe, index, remaining, onDecide }: CardProps) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-260, 260], [-14, 14])
  const pickOpacity = useTransform(x, [20, SWIPE_THRESHOLD], [0, 1])
  const skipOpacity = useTransform(x, [-SWIPE_THRESHOLD, -20], [1, 0])
  const isTop = index === 0
  const share = remaining > 0 ? Math.round((recipe.sodium_mg_per_serving / remaining) * 100) : 100
  const complete = recipe.missing.length === 0

  function handleDragEnd(_: unknown, info: PanInfo) {
    const swipe = info.offset.x + info.velocity.x * 0.15
    if (swipe > SWIPE_THRESHOLD) onDecide(1)
    else if (swipe < -SWIPE_THRESHOLD) onDecide(-1)
    else animate(x, 0, { type: 'spring', stiffness: 500, damping: 32 })
  }

  return (
    <motion.article
      className="card"
      style={{ x, rotate, zIndex: 10 - index }}
      drag={isTop ? 'x' : false}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.9, y: 40, opacity: 0 }}
      animate={{ scale: 1 - index * 0.04, y: index * 14, opacity: index > 2 ? 0 : 1 }}
      exit="exit"
      variants={{
        exit: (dir: Direction) => ({ x: dir * 520, rotate: dir * 22, opacity: 0, transition: { duration: 0.32 } }),
      }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      aria-hidden={!isTop}
    >
      <div className="card-photo" style={{ '--hue': hue(recipe.id) } as CSSProperties}>
        <span className="card-emoji" aria-hidden>
          {recipe.emoji}
        </span>
        <span className="card-chip">{recipe.cuisine}</span>
        <span className="card-chip card-chip--right">{recipe.minutes} min</span>
        <motion.span className="stamp stamp--pick" style={{ opacity: pickOpacity }}>
          Pick
        </motion.span>
        <motion.span className="stamp stamp--skip" style={{ opacity: skipOpacity }}>
          Skip
        </motion.span>
      </div>
      <div className="card-body">
        <h2>{recipe.name}</h2>
        <p className="card-blurb">{recipe.blurb}</p>
        <div className="card-sodium">
          <span className="card-mg">
            {fmt(recipe.sodium_mg_per_serving)} <small>mg</small>
          </span>
          <span className="card-mg-note">
            sodium per serving
            <br />
            {share}% of what's left today
          </span>
        </div>
        <div className="card-pantry">
          <span className="dots" aria-hidden>
            {Array.from({ length: recipe.ingredient_count }, (_, i) => (
              <span key={i} className={i < recipe.have ? 'dot dot--have' : 'dot'} />
            ))}
          </span>
          <span>
            {complete
              ? 'You have everything'
              : `You have ${recipe.have} of ${recipe.ingredient_count} ingredients`}
          </span>
        </div>
      </div>
    </motion.article>
  )
}

type Props = {
  recipes: Recipe[] // already excludes skipped/picked cards
  fittingCount: number
  hiddenCount: number
  remaining: number
  loaded: boolean
  keyboardEnabled: boolean
  onDecide: (recipe: Recipe, dir: Direction) => void
  onShowSkipped: () => void
  onGoPantry: () => void
}

export function DeckScreen(props: Props) {
  const { recipes, fittingCount, hiddenCount, remaining, loaded, keyboardEnabled, onDecide } = props
  const [exitDir, setExitDir] = useState<Direction>(1)
  const top = recipes[0]

  const decide = (dir: Direction) => {
    if (!top) return
    setExitDir(dir)
    onDecide(top, dir)
  }
  const decideRef = useRef(decide)
  useEffect(() => {
    decideRef.current = decide
  })

  useEffect(() => {
    if (!keyboardEnabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowRight') decideRef.current(1)
      if (e.key === 'ArrowLeft') decideRef.current(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboardEnabled])

  if (!loaded) return <div className="screen deck" aria-busy />

  return (
    <div className="screen deck">
      <p className="deck-count">
        {fittingCount === 0
          ? 'No meals fit right now'
          : `${fittingCount} meal${fittingCount === 1 ? '' : 's'} fit what's left today`}
      </p>

      <div className="stack">
        <AnimatePresence custom={exitDir}>
          {recipes.slice(0, 4).map((r, i) => (
            <SwipeCard key={r.id} recipe={r} index={i} remaining={remaining} onDecide={decide} />
          ))}
        </AnimatePresence>

        {!top && fittingCount === 0 && (
          <div className="deck-empty">
            <span className="deck-empty-icon" aria-hidden>
              🍵
            </span>
            {remaining <= 0 ? (
              <>
                <h2>You've reached today's limit</h2>
                <p>Your total resets at midnight.</p>
              </>
            ) : (
              <>
                <h2>Nothing in your pantry fits {fmt(remaining)} mg</h2>
                <p>Adding a few fresh ingredients usually opens up low-sodium options.</p>
                <button type="button" className="btn btn--soft" onClick={props.onGoPantry}>
                  Add to pantry
                </button>
              </>
            )}
          </div>
        )}

        {!top && fittingCount > 0 && (
          <div className="deck-empty">
            <span className="deck-empty-icon" aria-hidden>
              ✓
            </span>
            <h2>That's every meal that fits</h2>
            <p>You've gone through all {fittingCount}.</p>
            {hiddenCount > 0 && (
              <button type="button" className="btn btn--soft" onClick={props.onShowSkipped}>
                Show skipped meals again
              </button>
            )}
          </div>
        )}
      </div>

      <div className="deck-actions">
        <button type="button" className="round round--skip" onClick={() => decide(-1)} disabled={!top}>
          <span aria-hidden>✕</span>
          <span className="round-label">Skip</span>
        </button>
        <button type="button" className="round round--pick" onClick={() => decide(1)} disabled={!top}>
          <span aria-hidden>✓</span>
          <span className="round-label">Pick</span>
        </button>
      </div>
      <p className="deck-hint">Swipe right to pick, left to skip. Arrow keys work too.</p>
    </div>
  )
}
