# Should I go out?

One tap, one suggestion, then put your phone away.

<p align="center">
  <img src="docs/demo.gif" width="300" alt="Answering the questionnaire, choosing 60 minutes in Seoul, getting a park walk with things to do, a Preview your walk button, the weather, and a route map, then switching outfits for people who run cold or warm">
  <img src="docs/preview.gif" width="270" alt="Walk preview video: your next 35 minutes, dressing the avatar in a hoodie and long pants, the route drawn to Dangju Children's Park, arriving at a park with a playground in autumn colors, each thing to do, and Leave now, back by 15:05">
</p>

<p align="center">
  <img src="docs/questionnaire.png" width="200" alt="First-visit questionnaire with a button to let the AI decide everything">
  <img src="docs/home.png" width="200" alt="Home screen with a summary of the saved answers, an Edit answers button, and the time slider">
  <img src="docs/result.png" width="200" alt="Suggested walk to a park with a playground, things to do there, the Preview your walk button, and the weather panel">
  <img src="docs/outfit-cold.png" width="200" alt="Outfit for people who run cold, shown on an avatar and item cards">
</p>

On your first visit, a short questionnaire asks how you like to move, what you enjoy, who usually comes along, and whether you ride public bikes; you can also skip it and let the AI decide everything. The app then checks the weather, air quality, nearby parks, and (in Seoul, if you said yes to public bikes) bike stations, and asks Gemma running locally through Ollama to pick a single outdoor activity that fits the time you have and your answers. It suggests a few things to do once you get there, shows a round-trip walking route on a map, and dresses an avatar for the weather. Tap "Preview your walk" to watch a music video of about 30 seconds of the outing (getting dressed, the route, the park, and each thing to do) that you can save or share.

## Run locally

Using an AI coding agent? Ask it to set up the project from [AGENTS.md](AGENTS.md). It installs and starts everything, checks that it works, and gives you links for the optional API keys.

Requirements: Node 22.13+, pnpm, [Ollama](https://ollama.com).

```bash
ollama pull gemma3:4b
ollama serve            # keep running

cp apps/server/.env.example apps/server/.env
pnpm install
pnpm dev                # web on http://localhost:5173, API on :8787
```

Set `SEOUL_OPEN_API_KEY` in `apps/server/.env` to include Ddareungi (Seoul public bike) stations within 500m, and parks too far to walk that fit by bike, when you answered yes to "Public bikes?" and have 30 minutes or more. Without it the app still works everywhere.

Set `SENTRY_DSN` to send traces to Sentry. Each request then shows up as one trace with the four workflow steps, the agent run, the Gemma call, and every outgoing API request, including latency and token usage. The traces include step inputs and outputs, so your location, your questionnaire answers, and the prompt leave your machine; the Seoul API key is masked in request URLs. Leave it empty and nothing is sent.

<p align="center"><img src="docs/sentry-trace.png" alt="Sentry trace of one recommendation: the OSRM round-trip request runs during gather-conditions, which stops waiting for the slow Overpass request after 3 seconds, so plan-route takes 1 ms" width="800"></p>

## How it works

- `apps/server/src/conditions/` fetches Open-Meteo weather and air quality, parks within walking range from Nominatim, what each park has (playground, water, viewpoint, and so on) from Overpass, walking and cycling routes from OSRM (all keyless), and Seoul bike stations. The public Overpass server is often slow, so the app waits at most 3 seconds for it and caches park features for a day.
- Parks are first searched by straight-line distance, assuming paths are about 1.3 times longer. One OSRM request then measures the real round trip to every park (at the same time as the features lookup, also waiting at most 3 seconds), and parks whose walk there and back takes longer than the time you chose are dropped before Gemma picks. The card's time always covers the real route shown on the map. For a bike suggestion, the route is the walk to the station, the ride to the park and back (OSRM's bike profile), and the walk home, plus 2 minutes to rent and return the bike; the map marks the station with a bike icon and draws the walks to and from it as dashed lines and the ride as a solid line, the map caption and the preview show the riding and walking minutes, and the directions button opens cycling directions through the station.
- When you said yes to public bikes and a nearby station has bikes, a second Nominatim search (at least one second after the first, as its usage policy asks) looks for parks too far to walk. The bike trip to each is measured from the closest station with bikes, and up to 3 of the farthest that fit your time are offered to Gemma as bike-only parks. If Gemma picks one without a station, the server adds that station and names the trip a ride; if it picks a station but describes a walk to a walkable park, the trip stays a walk.
- Things to do at the park may only mention facilities that OpenStreetMap shows there; the server drops any suggestion that names a missing facility or another place.
- The reason is checked against the measured conditions: a sentence whose temperature, rain chance, air quality index, UV, or wind doesn't match, or that mentions rain when the chance is low (or denies it when rain is likely), is dropped.
- `apps/server/src/agent.ts` is a Mastra agent pointed at Ollama's OpenAI-compatible endpoint. The model only picks from real candidate parks and a fixed clothing catalog, so it never invents coordinates or items.
- `apps/server/src/outfit.ts` builds a baseline outfit from the Korean feels-like temperature chart; the model may adjust it, but rain, air quality, UV, and cold extras are always kept. It also offers one layer warmer and one layer lighter for people who run cold or warm.
- `apps/server/src/workflow.ts` runs each request as a Mastra workflow with four steps: gather conditions, ask Gemma for a JSON suggestion, check the answer with zod (falling back to simple rules if the model is unavailable or returns invalid output), and plan the walking route. The route was already measured while gathering conditions, so the last step reuses it from a 10-minute cache. The step logic lives in `apps/server/src/recommend.ts`.
- Questionnaire answers are saved in the browser's localStorage and sent with each request. Gemma uses them to choose among the real parks, and parks are ranked by matching features (exercise prefers a sports field or track, kids prefer a playground). If Gemma picks a park known to match none of the answers while another park does, or names a park that isn't on the list, the server switches to the best listed park; the rule-based fallback uses the same ranking. Riding is a matter of taste, so bike stations are looked up only when you answered "Happy to ride a bike"; without that answer (including "let the AI decide everything") every suggestion is a walk.
- `apps/web` shows the questionnaire on the first visit, the suggestion with things to do, a weather panel (sky icon, hourly rain chance for the next 3 hours, air quality, UV, wind, and sunset), the route with Leaflet + OpenStreetMap, and the outfit as a layered SVG avatar next to item cards.
- "Preview your walk" ("Preview your ride" for bike trips, `apps/web/src/WalkPreview.tsx`) draws a 9:16 story on a canvas: the sky and time, the outfit popping onto the avatar, the route traced to the park, the park drawn from its OpenStreetMap features in the current season's colors, one scene per thing to do, and when to be back (plus sunset when it's close). The server tags each thing to do with a scene type (`thingScenes`) so the picture fits the idea. The music is made in the browser with the Web Audio API (`previewMusic.ts`), and its mood follows the weather: bright on clear days, mellow when cloudy, lo-fi in rain, and slower at night; scene cuts land on the beat. While it plays, `MediaRecorder` records the canvas and music into an MP4 (WebM where MP4 isn't supported) for the save and share buttons. Nothing leaves the browser, and with reduced motion turned on it shows still frames instead of animation. The preview code loads only when you open it.

## Agent sessions

This app was built with Cursor agents. [Entire](https://entire.io) records each agent session from Cursor, Claude Code, or Codex and links it to the commit it produced. The checkpoints go to a separate private repository, `scs0209/touch-grass-agent-checkpoints`, so transcripts stay private until reviewed while the code stays public here. Early sessions are mostly in Korean; since October 6, 2026 the agent answers in both English and Korean.

The rules for agents live in one file, [AGENTS.md](AGENTS.md): keeping secrets out of sessions, English and Korean answers, English commit messages, fixing gaps before reporting, and keeping this README in sync. Cursor and Codex read it directly, and Claude Code reads it through `CLAUDE.md`.

To record and read sessions on another machine, sign in to GitHub with access to that repository and enable Entire once:

```bash
brew install --cask entireio/tap/entire
entire enable --agent cursor   # or claude-code, codex; installs the git hooks (agent hooks are already in the repo)
entire checkpoint list         # fetches checkpoints from the private repository
```

Without Entire installed, the Entire hooks do nothing. Cursor (`.cursor/hooks.json`), Claude Code (`.claude/settings.json`), and Codex (`.codex/hooks.json`) also share a stop hook, `scripts/readme-check.mjs`. It reminds the agent once to check this README when code under `apps/` changed and the README didn't. Codex asks you to trust the hook once with `/hooks`.

## Credits

- Clothing and weather icons: [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) 3D by Microsoft, MIT ([license](apps/web/public/fluent-emoji/LICENSE)).
- Glass styling: the glassmorphism skill and `apps/web/src/glass-tokens.css` come from [fengshao1227/ccg-workflow](https://github.com/fengshao1227/ccg-workflow), MIT ([license](.agents/skills/glassmorphism/LICENSE)).
- Map tiles, parks, and park features: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via Nominatim and the [Overpass API](https://overpass-api.de).
- Walking and cycling routes: [OSRM](https://project-osrm.org) on FOSSGIS's [routing.openstreetmap.de](https://routing.openstreetmap.de).
- Weather, air quality, and city search: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Seoul public bikes: [Seoul Open Data Plaza](https://data.seoul.go.kr).
- Model: [Gemma](https://ai.google.dev/gemma) by Google, under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
