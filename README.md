# Should I go out?

One tap, one suggestion, then put your phone away.

<p align="center">
  <img src="docs/demo.gif" width="300" alt="Answering the questionnaire, choosing 60 minutes in Seoul, getting a park walk with things to do, the weather, and a route map, then switching outfits for people who run cold or warm">
</p>

<p align="center">
  <img src="docs/questionnaire.png" width="200" alt="First-visit questionnaire with a button to let the AI decide everything">
  <img src="docs/home.png" width="200" alt="Home screen with a summary of the saved answers and the time slider">
  <img src="docs/result.png" width="200" alt="Suggested walk to a park with a playground, things to do there, and the weather panel">
  <img src="docs/outfit-cold.png" width="200" alt="Outfit for people who run cold, shown on an avatar and item cards">
</p>

On your first visit, a short questionnaire asks how you like to move, what you enjoy, who usually comes along, and whether you ride public bikes; you can also skip it and let the AI decide everything. The app then checks the weather, air quality, nearby parks, and (in Seoul) public bikes, and asks Gemma running locally through Ollama to pick a single outdoor activity that fits the time you have and your answers. It suggests a few things to do once you get there, shows a round-trip walking route on a map, and dresses an avatar for the weather.

## Run locally

Requirements: Node 22.13+, pnpm, [Ollama](https://ollama.com).

```bash
ollama pull gemma3:4b
ollama serve            # keep running

cp apps/server/.env.example apps/server/.env
pnpm install
pnpm dev                # web on http://localhost:5173, API on :8787
```

Set `SEOUL_OPEN_API_KEY` in `apps/server/.env` to include Ddareungi (Seoul public bike) stations within 500m. Without it the app still works everywhere.

Set `SENTRY_DSN` to send traces to Sentry. Each request then shows up as one trace with the four workflow steps, the agent run, the Gemma call, and every outgoing API request, including latency and token usage. The traces include step inputs and outputs, so your location, your questionnaire answers, and the prompt leave your machine; the Seoul API key is masked in request URLs. Leave it empty and nothing is sent.

<p align="center"><img src="docs/sentry-trace.png" alt="Sentry trace of one recommendation: the OSRM route request runs while Gemma is thinking, so plan-route takes 0 ms" width="800"></p>

## How it works

- `apps/server/src/conditions/` fetches Open-Meteo weather and air quality, parks within walking range from Nominatim, what each park has (playground, water, viewpoint, and so on) from Overpass, walking routes from OSRM (all keyless), and Seoul bike stations. The public Overpass server is often slow, so the app waits at most 3 seconds for it and caches park features for a day.
- Things to do at the park may only mention facilities that OpenStreetMap shows there; the server drops any suggestion that names a missing facility or another place.
- The reason is checked against the measured conditions: a sentence whose temperature, rain chance, air quality index, UV, or wind doesn't match, or that mentions rain when the chance is low (or denies it when rain is likely), is dropped.
- `apps/server/src/agent.ts` is a Mastra agent pointed at Ollama's OpenAI-compatible endpoint. The model only picks from real candidate parks and a fixed clothing catalog, so it never invents coordinates or items.
- `apps/server/src/outfit.ts` builds a baseline outfit from the Korean feels-like temperature chart; the model may adjust it, but rain, air quality, UV, and cold extras are always kept. It also offers one layer warmer and one layer lighter for people who run cold or warm.
- `apps/server/src/workflow.ts` runs each request as a Mastra workflow with four steps: gather conditions, ask Gemma for a JSON suggestion, check the answer with zod (falling back to simple rules if the model is unavailable or returns invalid output), and plan the walking route. While Gemma is thinking, one OSRM request fetches the round trip to every candidate park, so the route is usually ready by the time it's needed. The step logic lives in `apps/server/src/recommend.ts`.
- Questionnaire answers are saved in the browser's localStorage and sent with each request. Gemma uses them to choose among the real parks, and parks are ranked by matching features (exercise prefers a sports field or track, kids prefer a playground). If Gemma picks a park known to match none of the answers while another park does, the server switches to that park; the rule-based fallback uses the same ranking. Answering "walking only" removes bikes from every suggestion.
- `apps/web` shows the questionnaire on the first visit, the suggestion with things to do, a weather panel (sky icon, hourly rain chance for the next 3 hours, air quality, UV, wind, and sunset), the route with Leaflet + OpenStreetMap, and the outfit as a layered SVG avatar next to item cards.

## Agent sessions

This app was built with Cursor agents. [Entire](https://entire.io) records each agent session and links it to the commit it produced. The checkpoints go to a separate private repository, `scs0209/touch-grass-agent-checkpoints`, so transcripts stay private until reviewed while the code stays public here. Early sessions are mostly in Korean; since October 6, 2026 the agent answers in both English and Korean (`.cursor/rules/response-language.mdc`).

To record and read sessions on another machine, sign in to GitHub with access to that repository and enable Entire once:

```bash
brew install --cask entireio/tap/entire
entire enable --agent cursor   # installs the git hooks; the Cursor hooks are already in .cursor/hooks.json
entire checkpoint list         # fetches checkpoints from the private repository
```

Without Entire installed, the Entire hooks do nothing. `.cursor/hooks.json` also has a `stop` hook (`.cursor/hooks/readme-check.mjs`) that reminds the agent once to check this README when code under `apps/` changed and the README didn't.

## Credits

- Clothing and weather icons: [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) 3D by Microsoft, MIT ([license](apps/web/public/fluent-emoji/LICENSE)).
- Glass styling: the glassmorphism skill and `apps/web/src/glass-tokens.css` come from [fengshao1227/ccg-workflow](https://github.com/fengshao1227/ccg-workflow), MIT ([license](.cursor/skills/glassmorphism/LICENSE)).
- Map tiles, parks, and park features: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via Nominatim and the [Overpass API](https://overpass-api.de).
- Walking routes: [OSRM](https://project-osrm.org) on FOSSGIS's [routing.openstreetmap.de](https://routing.openstreetmap.de).
- Weather, air quality, and city search: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Seoul public bikes: [Seoul Open Data Plaza](https://data.seoul.go.kr).
- Model: [Gemma](https://ai.google.dev/gemma) by Google, under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
