// Typed client for the FastAPI service. Vite proxies /api to localhost:8000 (see vite.config.ts).

export type Ingredient = {
  id: string
  name: string
  category: string
  emoji: string
  sodium_mg_per_100g: number
  note: string | null
}

export type Catalog = {
  starter: string[]
  categories: { name: string; items: Ingredient[] }[]
}

export type MissingIngredient = { id: string; name: string; emoji: string; display: string }

export type Recipe = {
  id: string
  name: string
  cuisine: string
  emoji: string
  blurb: string
  servings: number
  minutes: number
  ingredient_count: number
  sodium_mg_per_serving: number
  sodium_mg_min_per_serving: number
  have: number
  missing: MissingIngredient[]
}

export type LogEntry = { id: number; recipe_id: string | null; label: string; sodium_mg: number; logged_at: string }

export type Today = {
  day: string
  target_mg: number | null
  consumed_mg: number
  remaining_mg: number | null
  entries: LogEntry[]
}

export type LogResult = { entry_id: number; missing: MissingIngredient[]; today: Today }

/** The patient's local date. The server keys the running total on this, so it resets at local midnight. */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail, () => null)
    throw new Error(typeof detail === 'string' ? detail : `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

type PantryIds = { ingredient_ids: string[] }
const ids = (r: PantryIds) => r.ingredient_ids

export const api = {
  getTarget: () =>
    request<{ sodium_target_mg: number | null }>('/settings/target').then((r) => r.sodium_target_mg),
  setTarget: (mg: number) => request('/settings/target', 'PUT', { sodium_target_mg: mg }),
  ingredients: () => request<Catalog>('/ingredients'),
  pantry: () => request<PantryIds>('/pantry').then(ids),
  addToPantry: (id: string) => request<PantryIds>(`/pantry/${encodeURIComponent(id)}`, 'PUT').then(ids),
  removeFromPantry: (id: string) => request<PantryIds>(`/pantry/${encodeURIComponent(id)}`, 'DELETE').then(ids),
  replacePantry: (ingredientIds: string[]) =>
    request<PantryIds>('/pantry', 'PUT', { ingredient_ids: ingredientIds }).then(ids),
  today: (day: string) => request<Today>(`/today?day=${day}`),
  deck: (day: string) => request<{ today: Today; recipes: Recipe[] }>(`/deck?day=${day}`),
  log: (recipeId: string, day: string) => request<LogResult>('/log', 'POST', { recipe_id: recipeId, day }),
  undo: (entryId: number) => request(`/log/${entryId}`, 'DELETE'),
  demoReset: (day: string) => request<Today>('/demo/reset', 'POST', { day }),
}

export const fmt = (mg: number) => mg.toLocaleString('en-US')
