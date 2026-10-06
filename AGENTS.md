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
   | `SEOUL_OPEN_API_KEY` | Ddareungi (Seoul public bike) stations within 500 m, only in Seoul | Sign in to Seoul Open Data Plaza and request a general key at https://data.seoul.go.kr/together/mypage/actkeyMain.do. The API used is https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do (`bikeList`). |
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
   `entire enable --agent cursor`.

## Secrets

Agent sessions in this repository are recorded and may be published.

- Never ask the user to paste an API key, DSN, or token into the chat. Ask them to edit
  `apps/server/.env` themselves.
- Never read, print, or paste the contents of any `.env` file, and never echo keys in commands or logs.
  Use the `grep -q` check above to see whether a value is set.

## Working conventions

These mirror the Cursor rules in `.cursor/rules/`; agents that don't read those files should follow them here.

- **Answers:** write the full answer in English, then the same answer in Korean below a `---` line.
- **Commits:** English, prefix `feat`, `update`, `fix`, `style`, `refactor`, `chore`, or `docs`;
  subject of 50 characters or fewer; body as `-` bullets. Push after committing.
- **Verify:** `pnpm typecheck`; call changed functions directly (`npx tsx` from `apps/server`);
  send real requests to the running server.
- **Close gaps:** after a change, look for cases your work still gets wrong and fix them in the same
  task, up to 3 rounds. Ask first only for product decisions, new services, or destructive steps.
- **Keep the README in sync:** update `README.md` (and screenshots when a screen changed) with every
  change to behavior, setup, data sources, or the UI.

## Where things are

- `apps/server/src/conditions/`: weather and air quality (Open-Meteo), parks (Nominatim), park features
  (Overpass), walking routes (OSRM), Seoul bikes.
- `apps/server/src/agent.ts`: the Gemma prompt. `apps/server/src/recommend.ts`: gathering conditions,
  checking the model's answer, and the rule-based fallback. `apps/server/src/workflow.ts`: the Mastra workflow.
- `apps/web/src/`: `App.tsx` (screens), `Questionnaire.tsx`, `WeatherPanel.tsx`, `ResultMap.tsx`, `Avatar.tsx`.
