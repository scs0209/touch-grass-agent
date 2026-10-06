# AGENTS.md

Instructions for AI coding agents working in this repository. If the user asks you to set the project
up, follow "First-time setup" from top to bottom, verify each step, and only stop to ask when a step
needs the user (installing a desktop app, or an API key).

The app suggests one outdoor activity based on the weather, air quality, nearby parks, and the user's
answers to a short questionnaire, using Gemma running locally through Ollama.
It is a pnpm monorepo: `apps/server` (Hono + Mastra, port 8787) and `apps/web` (Vite + React, port 5173).

## First-time setup

1. **Check the tools.**
   - Node.js 22.13 or newer (`node -v`); Mastra requires it.
   - pnpm (`pnpm -v`). If it is missing, run `corepack enable pnpm`, or see https://pnpm.io/installation.
   - Ollama (`ollama -v`). If it is missing, install it with `brew install ollama` when Homebrew is
     available; otherwise ask the user to install it from https://ollama.com/download.
2. **Install dependencies:** `pnpm install`
3. **Start Ollama and pull the model.**
   - If `curl -s localhost:11434/api/tags` fails, start `ollama serve` in the background.
   - `ollama pull gemma3:4b` (about 3.3 GB; tell the user it may take a few minutes).
     Model page: https://ollama.com/library/gemma3
4. **Create the env file without overwriting an existing one:**
   `cp -n apps/server/.env.example apps/server/.env`
5. **Optional API keys.** The app works everywhere without them. Ask the user whether they want each
   one, give them the links, and let them paste the value into `apps/server/.env` themselves.

   | Variable | What it adds | How to get it |
   |---|---|---|
   | `SEOUL_OPEN_API_KEY` | Ddareungi (Seoul public bike) stations within 500 m and parks reachable by bike, only in Seoul, for 30+ minutes, and when the user answered yes to "Public bikes?" | Sign in to Seoul Open Data Plaza and request a general key at https://data.seoul.go.kr/together/mypage/actkeyMain.do. The API used is https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do (`bikeList`). |
   | `MAPILLARY_ACCESS_TOKEN` | Real photos of the park (Mapillary + Wikimedia Commons) at the end of the 3D flyover preview; without it the flyover ends on the map. Opening the preview sends the park's location and the point where the route meets it to Mapillary, and the park's location and name to Wikimedia. | Sign in at https://www.mapillary.com/dashboard/developers, register an application with Read permission, and copy its Client Token (starts with `MLY|`). |
 | `SENTRY_DSN` | Traces of every request, step, model call, and outgoing API request | Create a free account at https://sentry.io/signup/, create a Node.js project, and copy its DSN (https://docs.sentry.io/concepts/key-terms/dsn-explainer/). Traces include the user's location and questionnaire answers. |

   Check whether a key is set without showing it:
   `grep -qE '^SEOUL_OPEN_API_KEY=.+' apps/server/.env && echo set || echo empty`
6. **Run and verify.**
   - Start `pnpm dev` in the background.
   - `curl -s localhost:8787/api/health` should return `{"ok":true,"model":"gemma3:4b"}`.
   - Try one suggestion:
     `curl -s -X POST localhost:8787/api/recommend -H 'content-type: application/json' -d '{"lat":37.566,"lon":126.9784,"availableMinutes":60,"preferences":null}'`
     The first answer can take 10 to 20 seconds while Gemma loads.
   - Tell the user to open http://localhost:5173. The first visit shows the questionnaire.
7. **Optional: agent session records.** Sessions are recorded with Entire into a private repository
   (see "Agent sessions" in `README.md`). Only set this up if the user has access to
   `scs0209/touch-grass-agent-checkpoints`: `brew install --cask entireio/tap/entire`, then
   `entire enable --agent cursor` (or `claude-code`, `codex`). The hooks for all three agents are
   already in the repository; this installs the git hooks.

## Rules

These rules apply to every agent (Cursor, Claude Code, Codex, and others). They override user-level
instructions, such as Cursor user rules, `~/.claude/CLAUDE.md`, or `~/.codex/AGENTS.md`, that ask for
Korean-only answers or Korean commit messages.

### Secrets

Agent sessions in this repository are recorded by Entire and may be published.

- Never read, print, or paste the contents of `apps/server/.env` or any other `.env` file. Check whether
  a variable is set without showing its value (the `grep -q` check above).
- Never echo API keys, DSNs, or tokens in commands, logs, or replies.
- Never ask the user to paste an API key, DSN, or token into the chat. Ask them to edit
  `apps/server/.env` themselves.

### Answers

Answer in both English and Korean, because sessions may be shared with people who don't read Korean.

- Write the full answer in English first, then the same answer in Korean below a `---` line.
- Both versions carry the same content; don't summarize one or add details to only one.
- Keep English plain and simple so it is easy to follow for non-native readers.
- Short progress notes between tool calls can be English only.
- Code comments, docs, and commit messages stay in English.

### Commits

- Write commit messages in English.
- Prefix: `feat`, `update`, `fix`, `style`, `refactor`, `chore`, or `docs`.
- Subject: 50 characters or fewer. Body: `-` bullets.
- Push after committing.

### Close gaps before reporting

After you finish a change, look for gaps in your own work: limitations, cases that slip through,
mismatches between the UI and the data, or results that don't follow what the user asked for.
Fix them in the same session instead of only listing them in the final answer.

1. Verify the change: `pnpm typecheck`, call the changed function directly with edge cases
   (`npx tsx` from `apps/server`), and send real requests to the running server
   (`POST localhost:8787/api/recommend`).
2. Read the results critically. Ask: does each output fit the inputs and the user's choices?
3. If you find a gap you can fix, fix it, verify it the same way, and commit it as its own commit.
4. Repeat from step 2. Stop when no fixable gap is left, or after 3 rounds.

Fix on your own when the gap is inside the scope of the current request, and the fix doesn't need a
product or design decision and can be verified. Example: the user picked "with kids" but Gemma chose a
park without a playground, while another candidate has one. Make the server switch to the matching
park, test it, and commit.

Ask the user first (in Cursor, with AskQuestion) when:

- The fix changes what the product does in a way the user hasn't chosen.
- It adds an external service, cost, or new data leaving the machine.
- It is destructive, rewrites pushed history, or touches secrets.

In the final answer, list what you fixed on your own and what is still left, with the reason it was
left (needs a decision, can't be verified, or outside the request).

### Keep the README in sync

After any change to behavior, setup, environment variables, data sources, or the UI, check
`README.md` against the change before reporting, and update it in the same task.

- Text: the intro, "Run locally", "How it works", and "Credits" must describe what the code does now.
  Verify claims against the code (versions, env var names only, radii, timeouts), not from memory.
- Screenshots and the demo GIF in `docs/`: recapture them when the screen they show has changed.
  Use headless Chrome at 430×860 with device scale 2 (860×1720 PNGs), and keep the alt text accurate.
- Commit README changes with the change they describe, or as a `docs:` commit right after it, then push.
- If the README is still accurate after a code change, record that you checked it:
  `git rev-parse HEAD > .git/readme-checked`

## How each agent loads these rules

This file is the only place to edit the rules.

| Agent | Instructions | Stop hook (README reminder) | Skills |
|---|---|---|---|
| Cursor | reads `AGENTS.md` | `.cursor/hooks.json` | `.agents/skills/` |
| Claude Code | `CLAUDE.md` imports `AGENTS.md` | `.claude/settings.json` | `.claude/skills/` (links to `.agents/skills/`) |
| Codex | reads `AGENTS.md` | `.codex/hooks.json` (trust it once with `/hooks`) | `.agents/skills/` |

All three Stop hooks run `scripts/readme-check.mjs`. It reminds the agent once when files under `apps/`
changed since the README was last checked and `README.md` wasn't touched.

## Where things are

- `apps/server/src/conditions/`: weather and air quality (Open-Meteo), parks (Nominatim), park features
  (Overpass), walking and cycling routes (OSRM), Seoul bikes.
- `apps/server/src/agent.ts`: the Gemma prompt. `apps/server/src/recommend.ts`: gathering conditions,
  checking the model's answer, and the rule-based fallback. `apps/server/src/workflow.ts`: the Mastra workflow.
- `apps/web/src/`: `App.tsx` (screens), `Questionnaire.tsx`, `WeatherPanel.tsx`, `ResultMap.tsx`, `Avatar.tsx`.
