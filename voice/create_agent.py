"""Create the ElevenLabs voice agent and its three client tools, then save the agent id to .env.

Run from the repo root:  .venv/bin/python voice/create_agent.py
Needs ELEVENLABS_API_KEY in .env (with Agents write access). The system prompt is read from
voice/agent.md so there is one copy of it. Refuses to run if ELEVENLABS_AGENT_ID is already set.
"""

import re
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values, set_key

ROOT = Path(__file__).parent.parent
ENV = ROOT / ".env"
API = "https://api.elevenlabs.io/v1/convai"

FIRST_MESSAGE = (
    "Hi! I can tell you how much sodium you have left today and find a meal that fits. What would you like?"
)
LLM = "claude-haiku-4-5"  # fast: every answer involves at least one tool round trip

# Names and parameters must match web/src/voice.ts.
TOOLS = [
    {
        "name": "get_budget",
        "description": (
            "Returns today's sodium target, how much has been used, how much is left (all in mg), and the "
            "meals already logged today. Call this before saying anything about the person's sodium."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_meal_options",
        "description": (
            "Returns meals the person can make now that fit what's left of today's sodium budget, best pantry "
            "match first. Each has recipe_id, name, sodium_mg_per_serving, swaps_needed and missing_ingredients."
        ),
        "parameters": {
            "type": "object",
            "properties": {"limit": {"type": "number", "description": "How many meals to return. Default 3."}},
        },
    },
    {
        "name": "log_meal",
        "description": (
            "Logs one serving of a meal the person has chosen, adds its sodium to today's total, and returns the "
            "new remaining amount and anything they need to buy. Only for meals returned by get_meal_options."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "recipe_id": {"type": "string", "description": "The recipe_id from get_meal_options."}
            },
            "required": ["recipe_id"],
        },
    },
]


def system_prompt():
    text = (ROOT / "voice" / "agent.md").read_text()
    match = re.search(r"## System prompt\s+```\n(.*?)```", text, re.S)
    if not match:
        sys.exit("Couldn't find the system prompt block in voice/agent.md")
    return match.group(1).strip()


def check(res, what):
    if res.status_code >= 300:
        sys.exit(f"{what} failed ({res.status_code}): {res.text[:500]}")
    return res.json()


def main():
    env = dotenv_values(ENV)
    key = (env.get("ELEVENLABS_API_KEY") or "").strip()
    if not key:
        sys.exit("Put ELEVENLABS_API_KEY in .env first.")
    if (env.get("ELEVENLABS_AGENT_ID") or "").strip():
        sys.exit("ELEVENLABS_AGENT_ID is already set in .env; clear it to create a new agent.")

    with httpx.Client(headers={"xi-api-key": key}, timeout=30) as http:
        tool_ids = []
        for tool in TOOLS:
            body = {"tool_config": {"type": "client", "expects_response": True, **tool}}
            created = check(http.post(f"{API}/tools", json=body), f"Creating tool {tool['name']}")
            tool_ids.append(created["id"])
            print(f"tool {tool['name']}: {created['id']}")

        agent = {
            "name": "Pantry Meal Finder",
            "conversation_config": {
                "agent": {
                    "first_message": FIRST_MESSAGE,
                    "language": "en",
                    "prompt": {"prompt": system_prompt(), "llm": LLM, "tool_ids": tool_ids},
                }
            },
            # Private agent: the app connects with a signed URL from /api/voice/session.
            "platform_settings": {"auth": {"enable_auth": True}},
        }
        created = check(http.post(f"{API}/agents/create", json=agent), "Creating agent")
        agent_id = created["agent_id"]
        set_key(str(ENV), "ELEVENLABS_AGENT_ID", agent_id, quote_mode="never")
        print(f"agent: {agent_id} (saved to .env)")

        # Read it back to confirm the settings that matter actually stuck.
        saved = check(http.get(f"{API}/agents/{agent_id}"), "Reading agent back")
        auth = (saved.get("platform_settings") or {}).get("auth") or {}
        saved_tools = saved["conversation_config"]["agent"]["prompt"].get("tool_ids") or []
        print(f"auth enabled: {auth.get('enable_auth')}")
        print(f"tools attached: {len(saved_tools)}/{len(tool_ids)}")
        print(f"llm: {saved['conversation_config']['agent']['prompt'].get('llm')}")


if __name__ == "__main__":
    main()
