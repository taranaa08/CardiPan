"""SQL for the API. Sodium values are read from the precomputed tables, never recalculated here."""

import json
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("APP_DB", Path(__file__).parent.parent / "data" / "app.db"))

DEFAULT_MAX_MISSING = 3

# What "Starter pantry" taps in and what /demo/reset seeds: a typical home kitchen, not a stocked one.
STARTER_PANTRY = [
    "jasmine_rice", "cooked_rice", "egg", "garlic", "ginger", "scallion", "onion",
    "soy_sauce", "vegetable_oil", "sesame_oil", "sugar", "salt", "black_pepper",
    "white_vinegar", "chicken_thigh", "tomato",
]


def connect():
    # One connection per request, but FastAPI may open it and use it on different threadpool threads.
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def get_target(con):
    row = con.execute("SELECT value FROM settings WHERE key = 'sodium_target_mg'").fetchone()
    return int(row["value"]) if row else None


def set_target(con, mg):
    con.execute(
        "INSERT INTO settings VALUES ('sodium_target_mg', ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(mg),),
    )


def ingredients(con):
    return con.execute(
        "SELECT id, name, category, emoji, sodium_mg_per_100g, note FROM ingredients ORDER BY category, name"
    ).fetchall()


def ingredient_exists(con, ingredient_id):
    return con.execute("SELECT 1 FROM ingredients WHERE id = ?", (ingredient_id,)).fetchone() is not None


def recipe_exists(con, recipe_id):
    return con.execute("SELECT 1 FROM recipes WHERE id = ?", (recipe_id,)).fetchone() is not None


def pantry(con):
    return [r["ingredient_id"] for r in con.execute("SELECT ingredient_id FROM pantry ORDER BY ingredient_id")]


def today(con, day):
    entries = con.execute(
        "SELECT id, recipe_id, label, sodium_mg, logged_at FROM daily_log WHERE day = ? ORDER BY id",
        (day,),
    ).fetchall()
    target = get_target(con)
    consumed = sum(e["sodium_mg"] for e in entries)
    return {
        "day": day,
        "target_mg": target,
        "consumed_mg": consumed,
        "remaining_mg": None if target is None else target - consumed,
        "entries": [dict(e) for e in entries],
    }


def recipe_swaps(con, recipe_id):
    """Substitutions that lower this recipe's sodium, biggest saving first."""
    return [
        dict(r)
        for r in con.execute(
            """
            SELECT rs.from_id, s.to_id, s.note, rs.mg_saved_per_serving,
                   f.name AS from_name, t.name AS to_name, t.emoji AS to_emoji
            FROM recipe_swaps rs
            JOIN substitutions s ON s.from_id = rs.from_id
            JOIN ingredients f ON f.id = rs.from_id
            JOIN ingredients t ON t.id = s.to_id
            WHERE rs.recipe_id = ?
            ORDER BY rs.mg_saved_per_serving DESC, rs.from_id
            """,
            (recipe_id,),
        )
    ]


def ingredients_needed(con, recipe_id, swaps=()):
    """The recipe's ingredient list after swaps, one entry per distinct ingredient."""
    by_from = {s["from_id"]: s for s in swaps}
    needed = {}
    for r in con.execute(
        """
        SELECT i.id, i.name, i.emoji, ri.display
        FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = ?
        """,
        (recipe_id,),
    ):
        s = by_from.get(r["id"])
        if s and s["to_id"] == s["from_id"]:  # same ingredient, smaller amount
            item = {**dict(r), "display": f"{r['name']}, less than the recipe says (see your swap)"}
        elif s:
            item = {
                "id": s["to_id"],
                "name": s["to_name"],
                "emoji": s["to_emoji"],
                "display": f"{s['to_name']} (instead of {s['from_name'].lower()})",
            }
        else:
            item = dict(r)
        needed.setdefault(item["id"], item)
    return list(needed.values())


def missing_ingredients(con, recipe_id, swaps=()):
    have = set(pantry(con))
    missing = [i for i in ingredients_needed(con, recipe_id, swaps) if i["id"] not in have]
    return sorted(missing, key=lambda i: i["name"])


def deck(con, remaining, max_missing=DEFAULT_MAX_MISSING):
    """The one query that matters: recipes that fit the remaining budget, ranked by pantry overlap."""
    rows = con.execute(
        """
        SELECT r.id, r.name, r.cuisine, r.emoji, r.blurb, r.servings, r.minutes,
               r.ingredient_count, r.sodium_mg_per_serving, r.sodium_mg_min_per_serving,
               COUNT(p.ingredient_id) AS have
        FROM recipes r
        JOIN recipe_ingredients ri ON ri.recipe_id = r.id
        LEFT JOIN pantry p ON p.ingredient_id = ri.ingredient_id
        WHERE r.sodium_mg_per_serving <= :remaining
        GROUP BY r.id
        HAVING r.ingredient_count - have <= :max_missing
        ORDER BY 1.0 * have / r.ingredient_count DESC, r.sodium_mg_per_serving ASC, r.id
        """,
        {"remaining": remaining, "max_missing": max_missing},
    ).fetchall()
    return [
        {**dict(r), "missing": missing_ingredients(con, r["id"]), "swaps": [], "sodium_mg_with_swaps": None}
        for r in rows
    ]


def choose_swaps(sodium_mg, swaps, remaining):
    """Fewest swaps, biggest saving first, that bring a serving under the budget. None if even all of them don't."""
    chosen = []
    for s in swaps:
        if sodium_mg <= remaining:
            break
        chosen.append(s)
        sodium_mg -= s["mg_saved_per_serving"]
    return (chosen, sodium_mg) if sodium_mg <= remaining else (None, None)


def swap_deck(con, remaining, max_missing=DEFAULT_MAX_MISSING):
    """Recipes over the budget as written that fit once swaps are applied. Ranked like deck()."""
    pantry_ids = set(pantry(con))
    out = []
    for r in con.execute(
        """
        SELECT id, name, cuisine, emoji, blurb, servings, minutes,
               sodium_mg_per_serving, sodium_mg_min_per_serving
        FROM recipes
        WHERE sodium_mg_per_serving > ? AND sodium_mg_min_per_serving < sodium_mg_per_serving
        """,
        (remaining,),
    ):
        swaps, mg = choose_swaps(r["sodium_mg_per_serving"], recipe_swaps(con, r["id"]), remaining)
        if swaps is None:
            continue
        needed = ingredients_needed(con, r["id"], swaps)
        missing = sorted((i for i in needed if i["id"] not in pantry_ids), key=lambda i: i["name"])
        if len(missing) > max_missing:
            continue
        out.append({
            **dict(r),
            "ingredient_count": len(needed),
            "have": len(needed) - len(missing),
            "missing": missing,
            "swaps": swaps,
            "sodium_mg_with_swaps": mg,
        })
    out.sort(key=lambda r: (-r["have"] / r["ingredient_count"], r["sodium_mg_with_swaps"], r["id"]))
    return out


def recipe_list(con):
    """Every recipe, lowest sodium first, with how many of its ingredients are in the pantry."""
    return [
        dict(r)
        for r in con.execute(
            """
            SELECT r.id, r.name, r.cuisine, r.emoji, r.blurb, r.servings, r.minutes,
                   r.ingredient_count, r.sodium_mg_per_serving, r.sodium_mg_min_per_serving,
                   COUNT(p.ingredient_id) AS have
            FROM recipes r
            JOIN recipe_ingredients ri ON ri.recipe_id = r.id
            LEFT JOIN pantry p ON p.ingredient_id = ri.ingredient_id
            GROUP BY r.id
            ORDER BY r.sodium_mg_per_serving, r.name
            """
        )
    ]


def recipe_detail(con, recipe_id):
    r = con.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if r is None:
        return None
    pantry_ids = set(pantry(con))
    ingredients = [
        {**dict(i), "in_pantry": i["id"] in pantry_ids}
        for i in con.execute(
            """
            SELECT i.id, i.name, i.emoji, ri.display, ri.sodium_mg_per_serving
            FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = ?
            ORDER BY ri.rowid
            """,
            (recipe_id,),
        )
    ]
    return {
        **dict(r),
        "steps": json.loads(r["steps"]),
        "ingredients": ingredients,
        "have": sum(i["in_pantry"] for i in ingredients),
        "available_swaps": recipe_swaps(con, recipe_id),
    }


def budget_fit(con, recipe, remaining):
    """How one serving fits what's left today: as written, with swaps (fewest needed), or not at all."""
    per = recipe["sodium_mg_per_serving"]
    if remaining is None:
        return {"status": None, "sodium_mg": per, "swaps": []}
    if per <= remaining:
        return {"status": "fits", "sodium_mg": per, "swaps": []}
    swaps, mg = choose_swaps(per, recipe_swaps(con, recipe["id"]), remaining)
    if swaps is not None:
        return {"status": "swap", "sodium_mg": mg, "swaps": swaps}
    return {"status": "over", "sodium_mg": per, "swaps": []}


def log_recipe(con, day, recipe_id, swaps=()):
    """Log one serving. Sodium comes from the precomputed per-serving and per-swap values."""
    r = con.execute("SELECT name, sodium_mg_per_serving FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    sodium_mg = r["sodium_mg_per_serving"] - sum(s["mg_saved_per_serving"] for s in swaps)
    label = r["name"] + (" (with swaps)" if swaps else "")
    cur = con.execute(
        "INSERT INTO daily_log (day, recipe_id, label, sodium_mg) VALUES (?, ?, ?, ?)",
        (day, recipe_id, label, sodium_mg),
    )
    return cur.lastrowid, sodium_mg


def delete_log(con, log_id):
    return con.execute("DELETE FROM daily_log WHERE id = ?", (log_id,)).rowcount > 0
