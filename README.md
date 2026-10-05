# Should I go out?

One tap, one suggestion, then put your phone away.

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

## How it works

- `apps/server/src/conditions/` fetches Open-Meteo weather and air quality, parks within walking range from Nominatim, walking routes from OSRM (all keyless), and Seoul bike stations.
- `apps/server/src/agent.ts` is a Mastra agent pointed at Ollama's OpenAI-compatible endpoint. The model only picks from real candidate parks and a fixed clothing catalog, so it never invents coordinates or items.
- `apps/server/src/outfit.ts` builds a baseline outfit from the Korean feels-like temperature chart; the model may adjust it, but rain, air quality, UV, and cold extras are always kept. It also offers one layer warmer and one layer lighter for people who run cold or warm.
- `apps/server/src/recommend.ts` gathers conditions, asks the model for a JSON suggestion, validates it with zod, and falls back to simple rules if the model is unavailable or returns invalid output.
- `apps/web` renders the route with Leaflet + OpenStreetMap, and the outfit as a layered SVG avatar next to item cards.

## Credits

- Clothing icons: [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) 3D by Microsoft, MIT ([license](apps/web/public/fluent-emoji/LICENSE)).
- Glass styling: the glassmorphism skill and `apps/web/src/glass-tokens.css` come from [fengshao1227/ccg-workflow](https://github.com/fengshao1227/ccg-workflow), MIT ([license](.cursor/skills/glassmorphism/LICENSE)).
- Map tiles and parks: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via Nominatim.
- Walking routes: [OSRM](https://project-osrm.org) on FOSSGIS's [routing.openstreetmap.de](https://routing.openstreetmap.de).
- Weather, air quality, and city search: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Seoul public bikes: [Seoul Open Data Plaza](https://data.seoul.go.kr).
- Model: [Gemma](https://ai.google.dev/gemma) by Google, under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
