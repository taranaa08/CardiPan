import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { api, localDay, type Catalog, type Recipe, type Today } from './api'
import { BudgetHeader } from './components/BudgetHeader'
import { SelectionSheet, type Picked } from './components/SelectionSheet'
import { DeckScreen, type Direction } from './screens/DeckScreen'
import { PantryScreen } from './screens/PantryScreen'
import { TargetScreen } from './screens/TargetScreen'
import './App.css'

type Screen = 'loading' | 'target' | 'pantry' | 'deck'

// Cards swiped away today. Client-only: skips are a browsing choice, picks are also logged on the server.
type Hidden = { day: string; skipped: string[]; picked: string[] }
const emptyHidden = (day: string): Hidden => ({ day, skipped: [], picked: [] })

// Open the app with ?demo to get a "Reset demo" button (known pantry, 1,500 mg, empty day).
const DEMO = new URLSearchParams(window.location.search).has('demo')

function message(e: unknown) {
  if (e instanceof TypeError) return "Can't reach the server. Is the API running on port 8000?"
  return e instanceof Error ? e.message : String(e)
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [editingTarget, setEditingTarget] = useState(false)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [pantry, setPantry] = useState<Set<string>>(new Set())
  const [today, setToday] = useState<Today | null>(null)
  const [deck, setDeck] = useState<Recipe[] | null>(null)
  const [hidden, setHidden] = useState<Hidden>(() => emptyHidden(localDay()))
  const [picked, setPicked] = useState<Picked | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = (e: unknown) => setError(message(e))

  const refreshDeck = useCallback(async () => {
    const day = localDay()
    try {
      const res = await api.deck(day)
      setDeck(res.recipes)
      setToday(res.today)
      setHidden((h) => (h.day === day ? h : emptyHidden(day)))
      setError(null)
    } catch (e) {
      setError(message(e))
    }
  }, [])

  useEffect(() => {
    Promise.all([api.ingredients(), api.pantry(), api.today(localDay())])
      .then(([cat, ids, t]) => {
        setCatalog(cat)
        setPantry(new Set(ids))
        setToday(t)
        setScreen(t.target_mg === null ? 'target' : ids.length === 0 ? 'pantry' : 'deck')
      })
      .catch((e) => setError(message(e)))
  }, [])

  // Refetch whenever the deck is shown or the tab regains focus (this also picks up a new day after midnight).
  useEffect(() => {
    if (screen !== 'deck') return
    refreshDeck()
    const onVisible = () => document.visibilityState === 'visible' && refreshDeck()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [screen, refreshDeck])

  async function saveTarget(mg: number) {
    try {
      await api.setTarget(mg)
      setToday(await api.today(localDay()))
      setEditingTarget(false)
      if (screen === 'target') setScreen(pantry.size ? 'deck' : 'pantry')
      else if (screen === 'deck') refreshDeck()
    } catch (e) {
      fail(e)
    }
  }

  async function reloadPantry() {
    setPantry(new Set(await api.pantry()))
  }

  function togglePantry(id: string) {
    const had = pantry.has(id)
    setPantry((prev) => {
      const next = new Set(prev)
      if (had) next.delete(id)
      else next.add(id)
      return next
    })
    ;(had ? api.removeFromPantry(id) : api.addToPantry(id)).catch((e) => {
      fail(e)
      reloadPantry().catch(fail)
    })
  }

  function replacePantry(ids: string[]) {
    api.replacePantry(ids).then((saved) => setPantry(new Set(saved)), fail)
  }

  const unpick = (id: string) => setHidden((h) => ({ ...h, picked: h.picked.filter((x) => x !== id) }))

  async function decide(recipe: Recipe, dir: Direction) {
    if (dir === -1) {
      setHidden((h) => ({ ...h, skipped: [...h.skipped, recipe.id] }))
      return
    }
    setHidden((h) => ({ ...h, picked: [...h.picked, recipe.id] }))
    try {
      const res = await api.log(recipe.id, localDay())
      setToday(res.today)
      setPicked({ recipe, entryId: res.entry_id, missing: res.missing, today: res.today })
      refreshDeck()
    } catch (e) {
      unpick(recipe.id)
      fail(e)
    }
  }

  async function removeEntry(entryId: number, recipeId: string | null) {
    try {
      await api.undo(entryId)
      if (recipeId) unpick(recipeId)
      setPicked(null)
      await refreshDeck()
    } catch (e) {
      fail(e)
    }
  }

  async function resetDemo() {
    try {
      const t = await api.demoReset(localDay())
      await reloadPantry()
      setToday(t)
      setHidden(emptyHidden(localDay()))
      setPicked(null)
      setEditingTarget(false)
      if (screen === 'deck') refreshDeck()
      else setScreen('deck')
    } catch (e) {
      fail(e)
    }
  }

  const sameDay = hidden.day === localDay()
  const pickedIds = new Set(sameDay ? hidden.picked : [])
  const skippedIds = new Set(sameDay ? hidden.skipped : [])
  const fitting = (deck ?? []).filter((r) => !pickedIds.has(r.id))
  const visible = fitting.filter((r) => !skippedIds.has(r.id))

  const showTarget = screen === 'target' || editingTarget
  const showChrome = !showTarget && (screen === 'pantry' || screen === 'deck') && today?.target_mg != null

  return (
    <div className="app">
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {showChrome && today && (
        <>
          <BudgetHeader today={today} onEditTarget={() => setEditingTarget(true)} onRemoveEntry={removeEntry} />
          <nav className="tabs" aria-label="Sections">
            <button type="button" aria-current={screen === 'deck'} onClick={() => setScreen('deck')}>
              Meals
            </button>
            <button type="button" aria-current={screen === 'pantry'} onClick={() => setScreen('pantry')}>
              Pantry <span className="tab-count">{pantry.size}</span>
            </button>
          </nav>
        </>
      )}

      <main>
        {screen === 'loading' && !error && <div className="screen" aria-busy />}
        {showTarget && (
          <TargetScreen
            current={today?.target_mg ?? null}
            onSave={saveTarget}
            onCancel={editingTarget ? () => setEditingTarget(false) : undefined}
          />
        )}
        {!showTarget && screen === 'pantry' && catalog && (
          <PantryScreen
            catalog={catalog}
            pantry={pantry}
            onToggle={togglePantry}
            onAddMany={(ids) => replacePantry([...pantry, ...ids])}
            onClear={() => replacePantry([])}
            onDone={() => setScreen('deck')}
          />
        )}
        {!showTarget && screen === 'deck' && (
          <DeckScreen
            recipes={visible}
            fittingCount={fitting.length}
            hiddenCount={fitting.length - visible.length}
            remaining={today?.remaining_mg ?? 0}
            loaded={deck !== null}
            keyboardEnabled={!picked}
            onDecide={decide}
            onShowSkipped={() => setHidden((h) => ({ ...h, skipped: [] }))}
            onGoPantry={() => setScreen('pantry')}
          />
        )}
      </main>

      <footer className="disclaimer">
        <p>
          Your clinician sets your sodium target; this app only helps you stay within it. Sodium values are
          estimates from USDA FoodData Central and vary by brand, preparation and portion. Not a medical device
          and not medical advice.
        </p>
        {DEMO && (
          <button type="button" className="btn btn--ghost btn--small" onClick={resetDemo}>
            Reset demo
          </button>
        )}
      </footer>

      <AnimatePresence>
        {picked && (
          <SelectionSheet
            key={picked.entryId}
            picked={picked}
            onUndo={() => removeEntry(picked.entryId, picked.recipe.id)}
            onClose={() => setPicked(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
