"""Pantry Meal Finder API.

Run from the repo root:  .venv/bin/uvicorn api.main:app --reload
The web app's Vite dev server proxies /api to port 8000.

Every day-scoped call takes the client's local date (YYYY-MM-DD), so the running
total "resets at midnight" wherever the patient is, with no job on the server.
"""

from datetime import date

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from api import queries as q

CATEGORY_ORDER = ["Produce", "Protein", "Grains", "Legumes", "Sauces", "Seasonings", "Oils", "Pantry"]

app = FastAPI(title="Heart-Healthy Pantry Meal Finder")
api = APIRouter(prefix="/api")


def db():
    con = q.connect()
    try:
        yield con
        con.commit()
    finally:
        con.close()


class Target(BaseModel):
    sodium_target_mg: int = Field(gt=0, le=10000)


class PantryIds(BaseModel):
    ingredient_ids: list[str]


class LogRequest(BaseModel):
    recipe_id: str
    day: date
    swaps: list[str] = []  # from_ids of the substitutions the patient is making


class DemoReset(BaseModel):
    day: date
    sodium_target_mg: int = Field(default=1500, gt=0, le=10000)


def require_target(con):
    target = q.get_target(con)
    if target is None:
        raise HTTPException(409, "Sodium target not set")
    return target


@api.get("/settings/target")
def get_target(con=Depends(db)):
    return {"sodium_target_mg": q.get_target(con)}


@api.put("/settings/target")
def put_target(body: Target, con=Depends(db)):
    q.set_target(con, body.sodium_target_mg)
    return body


@api.get("/ingredients")
def get_ingredients(con=Depends(db)):
    by_cat = {}
    for row in q.ingredients(con):
        by_cat.setdefault(row["category"], []).append(dict(row))
    order = CATEGORY_ORDER + sorted(set(by_cat) - set(CATEGORY_ORDER))
    return {
        "starter": q.STARTER_PANTRY,
        "categories": [{"name": c, "items": by_cat[c]} for c in order if c in by_cat],
    }


@api.get("/pantry")
def get_pantry(con=Depends(db)):
    return {"ingredient_ids": q.pantry(con)}


@api.put("/pantry")
def replace_pantry(body: PantryIds, con=Depends(db)):
    unknown = [i for i in body.ingredient_ids if not q.ingredient_exists(con, i)]
    if unknown:
        raise HTTPException(404, f"Unknown ingredients: {', '.join(unknown)}")
    con.execute("DELETE FROM pantry")
    con.executemany("INSERT OR IGNORE INTO pantry VALUES (?)", [(i,) for i in body.ingredient_ids])
    return {"ingredient_ids": q.pantry(con)}


@api.put("/pantry/{ingredient_id}")
def add_to_pantry(ingredient_id: str, con=Depends(db)):
    if not q.ingredient_exists(con, ingredient_id):
        raise HTTPException(404, f"Unknown ingredient: {ingredient_id}")
    con.execute("INSERT OR IGNORE INTO pantry VALUES (?)", (ingredient_id,))
    return {"ingredient_ids": q.pantry(con)}


@api.delete("/pantry/{ingredient_id}")
def remove_from_pantry(ingredient_id: str, con=Depends(db)):
    con.execute("DELETE FROM pantry WHERE ingredient_id = ?", (ingredient_id,))
    return {"ingredient_ids": q.pantry(con)}


@api.get("/today")
def get_today(day: date, con=Depends(db)):
    return q.today(con, day.isoformat())


@api.get("/deck")
def get_deck(day: date, max_missing: int = Query(q.DEFAULT_MAX_MISSING, ge=0), con=Depends(db)):
    require_target(con)
    t = q.today(con, day.isoformat())
    return {
        "today": t,
        "recipes": q.deck(con, t["remaining_mg"], max_missing),
        "swap_recipes": q.swap_deck(con, t["remaining_mg"], max_missing),
    }


@api.post("/log")
def log_recipe(body: LogRequest, con=Depends(db)):
    require_target(con)
    if not q.recipe_exists(con, body.recipe_id):
        raise HTTPException(404, f"Unknown recipe: {body.recipe_id}")
    available = {s["from_id"]: s for s in q.recipe_swaps(con, body.recipe_id)}
    unknown = [f for f in body.swaps if f not in available]
    if unknown:
        raise HTTPException(400, f"No swap for {', '.join(unknown)} in {body.recipe_id}")
    swaps = [available[f] for f in dict.fromkeys(body.swaps)]
    entry_id, sodium_mg = q.log_recipe(con, body.day.isoformat(), body.recipe_id, swaps)
    return {
        "entry_id": entry_id,
        "sodium_mg": sodium_mg,
        "swaps": swaps,
        "missing": q.missing_ingredients(con, body.recipe_id, swaps),
        "today": q.today(con, body.day.isoformat()),
    }


@api.delete("/log/{log_id}")
def undo_log(log_id: int, con=Depends(db)):
    if not q.delete_log(con, log_id):
        raise HTTPException(404, f"No log entry {log_id}")
    return {"deleted": log_id}


@api.post("/demo/reset")
def demo_reset(body: DemoReset, con=Depends(db)):
    """Known starting state for the pitch: target set, starter pantry, empty day."""
    q.set_target(con, body.sodium_target_mg)
    con.execute("DELETE FROM pantry")
    con.executemany("INSERT INTO pantry VALUES (?)", [(i,) for i in q.STARTER_PANTRY])
    con.execute("DELETE FROM daily_log WHERE day = ?", (body.day.isoformat(),))
    return q.today(con, body.day.isoformat())


app.include_router(api)
