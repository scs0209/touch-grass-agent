# Should I go out?

One tap, one suggestion, then put your phone away.

<p align="center">
  <img src="docs/demo.gif" width="300" alt="Choosing 60 minutes, getting a park walk with a route map, and switching outfits for people who run cold or warm">
</p>

<p align="center">
  <img src="docs/home.png" width="250" alt="Home screen with the time slider">
  <img src="docs/result.png" width="250" alt="Suggested park walk with the weather panel and a round-trip route on the map">
  <img src="docs/outfit-cold.png" width="250" alt="Outfit for people who run cold, shown on an avatar and item cards">
</p>

The app checks the weather, air quality, nearby parks, and (in Seoul) public bikes, then asks Gemma running locally through Ollama to pick a single outdoor activity that fits the time you have. It shows a round-trip walking route on a map and dresses an avatar for the weather.

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

Set `SENTRY_DSN` to send traces to Sentry. Each request then shows up as one trace with the four workflow steps, the agent run, the Gemma call, and every outgoing API request, including latency and token usage. The traces include step inputs and outputs, so your location and the prompt leave your machine; the Seoul API key is masked in request URLs. Leave it empty and nothing is sent.

<p align="center"><img src="docs/sentry-trace.png" alt="Sentry trace of one recommendation: the OSRM route request runs while Gemma is thinking, so plan-route takes 0 ms" width="800"></p>

## How it works

- `apps/server/src/conditions/` fetches Open-Meteo weather and air quality, parks within walking range from Nominatim, walking routes from OSRM (all keyless), and Seoul bike stations.
- `apps/server/src/agent.ts` is a Mastra agent pointed at Ollama's OpenAI-compatible endpoint. The model only picks from real candidate parks and a fixed clothing catalog, so it never invents coordinates or items.
- `apps/server/src/outfit.ts` builds a baseline outfit from the Korean feels-like temperature chart; the model may adjust it, but rain, air quality, UV, and cold extras are always kept. It also offers one layer warmer and one layer lighter for people who run cold or warm.
- `apps/server/src/workflow.ts` runs each request as a Mastra workflow with four steps: gather conditions, ask Gemma for a JSON suggestion, check the answer with zod (falling back to simple rules if the model is unavailable or returns invalid output), and plan the walking route. While Gemma is thinking, one OSRM request fetches the round trip to every candidate park, so the route is usually ready by the time it's needed. The step logic lives in `apps/server/src/recommend.ts`.
- `apps/web` renders the route with Leaflet + OpenStreetMap, and the outfit as a layered SVG avatar next to item cards.

## Agent sessions

This app was built with Cursor agents. [Entire](https://entire.io) records each agent session and links it to the commit it produced. The checkpoints go to a separate private repository, `scs0209/touch-grass-agent-checkpoints`, so transcripts stay private until reviewed while the code stays public here.

To record and read sessions on another machine, sign in to GitHub with access to that repository and enable Entire once:

```bash
brew install --cask entireio/tap/entire
entire enable --agent cursor   # installs the git hooks; the Cursor hooks are already in .cursor/hooks.json
entire checkpoint list         # fetches checkpoints from the private repository
```

Without Entire installed, the Cursor hooks do nothing.

## Credits

- Clothing icons: [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) 3D by Microsoft, MIT ([license](apps/web/public/fluent-emoji/LICENSE)).
- Glass styling: the glassmorphism skill and `apps/web/src/glass-tokens.css` come from [fengshao1227/ccg-workflow](https://github.com/fengshao1227/ccg-workflow), MIT ([license](.cursor/skills/glassmorphism/LICENSE)).
- Map tiles and parks: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via Nominatim.
- Walking routes: [OSRM](https://project-osrm.org) on FOSSGIS's [routing.openstreetmap.de](https://routing.openstreetmap.de).
- Weather, air quality, and city search: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Seoul public bikes: [Seoul Open Data Plaza](https://data.seoul.go.kr).
- Model: [Gemma](https://ai.google.dev/gemma) by Google, under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
