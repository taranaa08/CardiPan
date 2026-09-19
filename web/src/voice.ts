// Client tools for the ElevenLabs voice agent. Names and parameters must match the agent's
// configuration in the ElevenLabs dashboard (see voice/agent.md). Every number the agent says
// comes from these calls: the same precomputed values the deck shows, never the model's own math.

import { api, cardSodium, localDay, type LogResult, type Recipe } from './api'

type Params = Record<string, unknown>

/** Logs one serving through the app, exactly like a right swipe (updates header, deck and sheet). */
export type LogMeal = (recipe: Recipe) => Promise<LogResult | undefined>

const reply = (data: unknown) => JSON.stringify(data)

async function todaysOptions() {
  const res = await api.deck(localDay())
  return { today: res.today, options: [...res.recipes, ...res.swap_recipes] }
}

function describe(r: Recipe) {
  return {
    recipe_id: r.id,
    name: r.name,
    cuisine: r.cuisine,
    minutes: r.minutes,
    sodium_mg_per_serving: cardSodium(r),
    swaps_needed: r.swaps.map((s) => s.note),
    missing_ingredients: r.missing.map((m) => m.name),
  }
}

function findOption(options: Recipe[], wanted: string) {
  const w = wanted.trim().toLowerCase()
  if (!w) return undefined
  return (
    options.find((o) => o.id === w) ??
    options.find((o) => o.name.toLowerCase() === w) ??
    options.find((o) => o.name.toLowerCase().includes(w))
  )
}

export function voiceTools(logMeal: LogMeal) {
  return {
    get_budget: async () => {
      const t = await api.today(localDay())
      return reply({
        target_mg: t.target_mg,
        used_mg: t.consumed_mg,
        remaining_mg: t.remaining_mg,
        meals_today: t.entries.map((e) => ({ name: e.label, sodium_mg: e.sodium_mg })),
      })
    },

    get_meal_options: async (params: Params) => {
      const { today, options } = await todaysOptions()
      const limit = Math.min(Math.max(Math.round(Number(params?.limit) || 3), 1), 8)
      return reply({
        remaining_mg: today.remaining_mg,
        total_options: options.length,
        options: options.slice(0, limit).map(describe),
      })
    },

    log_meal: async (params: Params) => {
      const { options } = await todaysOptions()
      const recipe = findOption(options, String(params?.recipe_id ?? params?.name ?? ''))
      if (!recipe) {
        return reply({
          logged: false,
          reason:
            "That meal isn't in today's options: it doesn't fit the remaining budget or the pantry. Call get_meal_options to see what does.",
        })
      }
      const res = await logMeal(recipe)
      if (!res) return reply({ logged: false, reason: 'The app could not save it. Ask the person to try again.' })
      return reply({
        logged: true,
        name: recipe.name,
        sodium_mg: res.sodium_mg,
        swaps: res.swaps.map((s) => s.note),
        remaining_mg: res.today.remaining_mg,
        need_to_buy: res.missing.map((m) => m.display),
      })
    },
  }
}
