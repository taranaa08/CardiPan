import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import queries
from api.main import app

DAY = "2026-09-19"

spec = importlib.util.spec_from_file_location("build_db", Path(__file__).parent.parent / "data" / "build_db.py")
build_db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_db)


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "app.db"
    build_db.build(db_path, quiet=True)
    monkeypatch.setattr(queries, "DB_PATH", db_path)
    return TestClient(app)


def setup(client, target=1500, pantry=None):
    client.put("/api/settings/target", json={"sodium_target_mg": target})
    client.put("/api/pantry", json={"ingredient_ids": pantry if pantry is not None else queries.STARTER_PANTRY})


def deck_ids(client, day=DAY, **params):
    return [r["id"] for r in client.get("/api/deck", params={"day": day, **params}).json()["recipes"]]


def sodium_of(client, recipe_id):
    con = queries.connect()
    try:
        return con.execute("SELECT sodium_mg_per_serving FROM recipes WHERE id = ?", (recipe_id,)).fetchone()[0]
    finally:
        con.close()


def test_deck_requires_target(client):
    assert client.get("/api/deck", params={"day": DAY}).status_code == 409


def test_budget_boundary_is_inclusive(client):
    adobo = sodium_of(client, "chicken_adobo")
    setup(client, target=adobo)
    assert "chicken_adobo" in deck_ids(client)
    setup(client, target=adobo - 1)
    assert "chicken_adobo" not in deck_ids(client)


def test_every_card_fits_remaining_budget(client):
    setup(client)
    client.post("/api/log", json={"recipe_id": "chicken_adobo", "day": DAY})
    body = client.get("/api/deck", params={"day": DAY}).json()
    assert body["today"]["remaining_mg"] == 1500 - sodium_of(client, "chicken_adobo")
    assert body["recipes"]
    assert all(r["sodium_mg_per_serving"] <= body["today"]["remaining_mg"] for r in body["recipes"])


def test_deck_narrows_as_day_fills(client):
    setup(client)
    before = deck_ids(client)
    client.post("/api/log", json={"recipe_id": "chicken_adobo", "day": DAY})
    after = deck_ids(client)
    assert set(after) < set(before)


def test_ranked_by_pantry_overlap(client):
    setup(client)
    recipes = client.get("/api/deck", params={"day": DAY}).json()["recipes"]
    ratios = [r["have"] / r["ingredient_count"] for r in recipes]
    assert ratios == sorted(ratios, reverse=True)
    for r in recipes:
        assert r["ingredient_count"] - r["have"] == len(r["missing"])


def test_max_missing_filters(client):
    setup(client)
    recipes = client.get("/api/deck", params={"day": DAY, "max_missing": 0}).json()["recipes"]
    assert recipes and all(not r["missing"] for r in recipes)
    setup(client, pantry=[])
    assert deck_ids(client, max_missing=3) == []


def test_new_day_resets_total(client):
    setup(client)
    client.post("/api/log", json={"recipe_id": "chicken_adobo", "day": DAY})
    assert client.get("/api/today", params={"day": "2026-09-20"}).json()["consumed_mg"] == 0


def test_pho_never_fits_a_2300_day(client):
    setup(client, target=2300, pantry=[r["id"] for c in client.get("/api/ingredients").json()["categories"] for r in c["items"]])
    ids = deck_ids(client)
    assert "chicken_pho" not in ids
    assert "pad_thai" in ids


def test_log_returns_missing_and_undo_restores(client):
    setup(client)
    res = client.post("/api/log", json={"recipe_id": "chicken_congee", "day": DAY}).json()
    assert {m["id"] for m in res["missing"]} == {"chicken_breast", "broth_low", "white_pepper"}
    assert res["today"]["consumed_mg"] == sodium_of(client, "chicken_congee")
    assert client.delete(f"/api/log/{res['entry_id']}").status_code == 200
    assert client.get("/api/today", params={"day": DAY}).json()["consumed_mg"] == 0


def test_pantry_persists_and_rejects_unknown(client):
    client.put("/api/pantry/garlic")
    client.put("/api/pantry/ginger")
    client.delete("/api/pantry/garlic")
    assert client.get("/api/pantry").json()["ingredient_ids"] == ["ginger"]
    assert client.put("/api/pantry/unicorn").status_code == 404
    assert client.put("/api/pantry", json={"ingredient_ids": ["ginger", "unicorn"]}).status_code == 404


def test_demo_reset(client):
    setup(client, target=2000)
    client.post("/api/log", json={"recipe_id": "tomato_egg", "day": DAY})
    today = client.post("/api/demo/reset", json={"day": DAY}).json()
    assert today["target_mg"] == 1500 and today["consumed_mg"] == 0
    assert client.get("/api/pantry").json()["ingredient_ids"] == sorted(queries.STARTER_PANTRY)
