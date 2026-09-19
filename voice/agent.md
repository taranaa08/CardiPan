# Voice agent (ElevenLabs) setup

The app's **Talk** button (mic, end of the tab bar) starts a voice conversation with an
ElevenLabs agent. The agent does the listening and speaking; every fact it states comes from
three **client tools** that run in the browser and call this app's API, the same endpoints the
swipe deck uses. The core app works without any of this: with no credentials the button is hidden.

## 1. Create the agent

In the ElevenLabs dashboard, go to **Agents**, then **Create agent** (blank).

- **First message:**
  > Hi! I can tell you how much sodium you have left today and find a meal that fits. What would you like?
- **System prompt:** paste the block in [System prompt](#system-prompt) below.
- **Voice:** any calm, clear voice. Test it at a slower speed; the audience is older patients.
- **LLM:** pick a fast model. Tool calls add round trips, and latency matters more than depth here.
- **Security:** turn **Enable authentication** on. The app connects with a signed URL, so the agent
  must not be public.

## 2. Add the three client tools

For each tool: **Add tool**, then **Client**. Names and parameters must match exactly. Turn
**Wait for response** on for all three (the agent needs the result before it speaks).

| Name | Description (paste as-is) | Parameters |
|---|---|---|
| `get_budget` | Returns today's sodium target, how much has been used, how much is left (all in mg), and the meals already logged today. Call this before saying anything about the person's sodium. | none |
| `get_meal_options` | Returns meals the person can make now that fit what's left of today's sodium budget, best pantry match first. Each has recipe_id, name, sodium_mg_per_serving, swaps_needed and missing_ingredients. | `limit` (number, optional): how many to return, default 3 |
| `log_meal` | Logs one serving of a meal the person has chosen, adds its sodium to today's total and returns the new remaining amount and anything they need to buy. Only for meals returned by get_meal_options. | `recipe_id` (string, required): the recipe_id from get_meal_options |

## 3. Connect the app

1. Copy `.env.example` to `.env` in the repo root (it is git-ignored) and fill in:
   ```
   ELEVENLABS_API_KEY=...        # Profile, then API keys
   ELEVENLABS_AGENT_ID=agent_... # the agent's page, in the URL or settings
   ```
2. Restart the API (`.venv/bin/uvicorn api.main:app --reload`). Changes to `.env` are only read at startup.
3. Reload the web app. The dark mic button appears at the end of the tab bar.
4. Tap it and allow the microphone. While the agent listens, the hero label reads
   **● Listening** and the glow breathes; while it speaks, the glow pulses faster.

Try: *"How much sodium do I have left?"*, then *"What can I have for dinner?"*, then
*"I'll have the chicken adobo."* The budget animates down and the deck narrows as it answers.

## System prompt

```
You are the voice of Pantry Meal Finder, a kitchen helper for people following a daily sodium
limit set by their clinician, often after a heart attack or with heart failure. Many are older,
tired, and cooking for themselves or a family member. Be warm, calm and brief.

How to talk
- Spoken style. One to three short sentences per turn.
- Offer at most three meals at a time, by name, with their sodium. Round nothing; say the number
  the tool gave ("three hundred forty-five milligrams").
- Ask one question at a time.

Facts come only from tools
- Before saying how much sodium is left or used, call get_budget.
- Before suggesting meals, call get_meal_options.
- Never state a sodium number that did not come from a tool in this conversation. Never estimate
  the sodium of a food, brand or restaurant meal yourself.
- If a meal needs swaps (swaps_needed), say the swap in plain words; that is why it fits.
- If something they ask for isn't in the options, say it doesn't fit today's budget or pantry and
  offer what does.

Logging meals
- Call log_meal only after the person clearly chooses a meal. Use the recipe_id from
  get_meal_options.
- After logging, say the new amount left and anything they need to buy (need_to_buy).
- If log_meal returns logged: false, explain the reason briefly and offer options.
- You can only log meals from the app's recipes. If they mention other food they ate, say you
  can't track that yet.

Safety
- You do not give medical advice and you do not set or change the sodium target; their clinician
  does. For questions about their target, medicines, symptoms or diet changes, suggest asking
  their care team.
- If they mention chest pain, trouble breathing, fainting, sudden weakness, or feel very unwell,
  tell them to call 911 (or their local emergency number) right away, and stop talking about food.
- Sodium values are estimates from public nutrition data and vary by brand and portion; say so if
  asked how accurate they are.
```
