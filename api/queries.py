"""SQL for the API. Sodium values are read from the precomputed tables, never recalculated here."""

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
    con = sqlite3.connect(DB_PATH)
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


def missing_ingredients(con, recipe_id):
    return [
        dict(r)
        for r in con.execute(
            """
            SELECT i.id, i.name, i.emoji, ri.display
            FROM recipe_ingredients ri
            JOIN ingredients i ON i.id = ri.ingredient_id
            LEFT JOIN pantry p ON p.ingredient_id = ri.ingredient_id
            WHERE ri.recipe_id = ? AND p.ingredient_id IS NULL
            ORDER BY i.name
            """,
            (recipe_id,),
        )
    ]


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
    return [{**dict(r), "missing": missing_ingredients(con, r["id"])} for r in rows]


def log_recipe(con, day, recipe_id):
    r = con.execute("SELECT name, sodium_mg_per_serving FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    cur = con.execute(
        "INSERT INTO daily_log (day, recipe_id, label, sodium_mg) VALUES (?, ?, ?, ?)",
        (day, recipe_id, r["name"], r["sodium_mg_per_serving"]),
    )
    return cur.lastrowid


def delete_log(con, log_id):
    return con.execute("DELETE FROM daily_log WHERE id = ?", (log_id,)).rowcount > 0
