"""Build app.db from the hand-mapped CSV/JSON in this folder.

Sodium is computed once here, never at request time:
    sodium_per_serving = sum(grams * mg_per_100g / 100) / servings

Run:  python data/build_db.py          (prints a sodium table to sanity-check)
"""

import csv
import json
import sqlite3
import sys
from pathlib import Path

DATA = Path(__file__).parent
DB_PATH = DATA / "app.db"

SCHEMA = """
CREATE TABLE ingredients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    emoji TEXT NOT NULL,
    sodium_mg_per_100g REAL NOT NULL,
    note TEXT
);
CREATE TABLE recipes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cuisine TEXT NOT NULL,
    emoji TEXT NOT NULL,
    blurb TEXT NOT NULL,
    servings INTEGER NOT NULL,
    minutes INTEGER NOT NULL,
    steps TEXT NOT NULL,                      -- JSON array
    ingredient_count INTEGER NOT NULL,
    sodium_mg_per_serving INTEGER NOT NULL,
    sodium_mg_min_per_serving INTEGER NOT NULL -- with every available swap applied
);
CREATE TABLE recipe_ingredients (
    recipe_id TEXT NOT NULL REFERENCES recipes(id),
    ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
    grams REAL NOT NULL,
    display TEXT NOT NULL,
    sodium_mg_per_serving REAL NOT NULL,      -- this ingredient's share, for "where the sodium comes from"
    PRIMARY KEY (recipe_id, ingredient_id)
);
CREATE TABLE substitutions (
    from_id TEXT PRIMARY KEY REFERENCES ingredients(id),
    to_id TEXT NOT NULL REFERENCES ingredients(id),
    ratio REAL NOT NULL,
    note TEXT NOT NULL
);
CREATE TABLE recipe_swaps (                   -- one row per substitution that applies to a recipe
    recipe_id TEXT NOT NULL REFERENCES recipes(id),
    from_id TEXT NOT NULL REFERENCES ingredients(id),
    mg_saved_per_serving INTEGER NOT NULL,
    PRIMARY KEY (recipe_id, from_id)
);
CREATE TABLE removed_recipes (                -- recipes the user deleted; kept in recipes.json, restorable
    recipe_id TEXT PRIMARY KEY REFERENCES recipes(id)
);
CREATE TABLE pantry (
    ingredient_id TEXT PRIMARY KEY REFERENCES ingredients(id)
);
CREATE TABLE settings (
    key TEXT PRIMARY KEY,                     -- e.g. sodium_target_mg
    value TEXT NOT NULL
);
CREATE TABLE daily_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,                        -- YYYY-MM-DD, local
    recipe_id TEXT REFERENCES recipes(id),
    label TEXT NOT NULL,
    sodium_mg INTEGER NOT NULL,
    logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ri_ingredient ON recipe_ingredients(ingredient_id);
CREATE INDEX idx_log_day ON daily_log(day);
"""


def load():
    with open(DATA / "ingredients.csv", newline="") as f:
        ingredients = {r["id"]: r for r in csv.DictReader(f)}
    with open(DATA / "substitutions.csv", newline="") as f:
        subs = {r["from_id"]: r for r in csv.DictReader(f)}
    with open(DATA / "recipes.json") as f:
        recipes = json.load(f)
    return ingredients, subs, recipes


def validate(ingredients, subs, recipes):
    errors = []
    for s in subs.values():
        for key in ("from_id", "to_id"):
            if s[key] not in ingredients:
                errors.append(f"substitution references unknown ingredient {s[key]!r}")
    seen = set()
    for r in recipes:
        if r["id"] in seen:
            errors.append(f"duplicate recipe id {r['id']!r}")
        seen.add(r["id"])
        ids = [line[0] for line in r["ingredients"]]
        if len(ids) != len(set(ids)):
            errors.append(f"{r['id']}: duplicate ingredient line")
        for ing_id, grams, _ in r["ingredients"]:
            if ing_id not in ingredients:
                errors.append(f"{r['id']}: unknown ingredient {ing_id!r}")
            if grams <= 0:
                errors.append(f"{r['id']}: non-positive grams for {ing_id!r}")
    if errors:
        sys.exit("Data errors:\n  " + "\n  ".join(errors))


def sodium(ingredients, lines, subs=None):
    total = 0.0
    for ing_id, grams, _ in lines:
        if subs and ing_id in subs:
            s = subs[ing_id]
            total += grams * float(s["ratio"]) * float(ingredients[s["to_id"]]["sodium_mg_per_100g"]) / 100
        else:
            total += grams * float(ingredients[ing_id]["sodium_mg_per_100g"]) / 100
    return total


def build(db_path=DB_PATH, quiet=False):
    ingredients, subs, recipes = load()
    validate(ingredients, subs, recipes)

    db_path = Path(db_path)
    db_path.unlink(missing_ok=True)
    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)
    con.executemany(
        "INSERT INTO ingredients VALUES (:id, :name, :category, :emoji, :sodium_mg_per_100g, :note)",
        ingredients.values(),
    )
    con.executemany(
        "INSERT INTO substitutions VALUES (:from_id, :to_id, :ratio, :note)", subs.values()
    )

    rows = []
    for r in recipes:
        per = round(sodium(ingredients, r["ingredients"]) / r["servings"])
        per_min = round(sodium(ingredients, r["ingredients"], subs) / r["servings"])
        rows.append((r["name"], r["cuisine"], per, per_min))
        con.execute(
            "INSERT INTO recipes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                r["id"], r["name"], r["cuisine"], r["emoji"], r["blurb"], r["servings"],
                r["minutes"], json.dumps(r["steps"]), len(r["ingredients"]), per, per_min,
            ),
        )
        con.executemany(
            "INSERT INTO recipe_ingredients VALUES (?,?,?,?,?)",
            [
                (r["id"], i, g, d, round(sodium(ingredients, [[i, g, d]]) / r["servings"], 1))
                for i, g, d in r["ingredients"]
            ],
        )
        for line in r["ingredients"]:
            if line[0] in subs:
                saved = round(
                    (sodium(ingredients, [line]) - sodium(ingredients, [line], subs)) / r["servings"]
                )
                if saved > 0:
                    con.execute("INSERT INTO recipe_swaps VALUES (?,?,?)", (r["id"], line[0], saved))
    con.commit()
    con.close()

    if not quiet:
        print(f"Built {db_path.name}: {len(ingredients)} ingredients, {len(recipes)} recipes\n")
        print(f"{'recipe':<36}{'cuisine':<18}{'mg/serv':>8}{'w/ swaps':>10}")
        for name, cuisine, per, per_min in sorted(rows, key=lambda x: x[2]):
            print(f"{name:<36}{cuisine:<18}{per:>8}{per_min:>10}")


if __name__ == "__main__":
    build()
