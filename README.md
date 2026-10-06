# Should I go out?

One tap, one suggestion, then put your phone away.

<p align="center">
  <img src="docs/demo.gif" width="300" alt="Answering the questionnaire, choosing 60 minutes in Seoul, getting a park walk with things to do, a Preview your walk button, the weather, and a route map opened full screen and closed again, then switching outfits for people who run cold or warm">
  <img src="docs/preview.gif" width="270" alt="Walk preview video: a 3D map of central London with your next 11 minutes and what to wear, diving down to street level, a green location puck walking the route to Leicester Square past 3D buildings, and the camera circling the park with You've arrived">
</p>

<p align="center">
  <img src="docs/questionnaire.png" width="200" alt="First-visit questionnaire with a button to let the AI decide everything">
  <img src="docs/home.png" width="200" alt="Home screen with a summary of the saved answers, an Edit answers button, and the time slider">
  <img src="docs/result.png" width="200" alt="Suggested walk to a park with a playground, things to do there, the Preview your walk button, and the weather panel">
  <img src="docs/outfit-cold.png" width="200" alt="Outfit for people who run cold, shown on an avatar and item cards">
  <img src="docs/map-full.png" width="200" alt="Full-screen map of the walking route from Seoul City Hall to Cheonggyecheon Stream Park, with a close button and the round-trip distance and time at the bottom">
</p>

On your first visit, a short questionnaire asks how you like to move, what you enjoy, who usually comes along, and whether you ride public bikes; you can also skip it and let the AI decide everything. The app then checks the weather, air quality, nearby parks, and (in Seoul, if you said yes to public bikes) bike stations, and asks Gemma running locally through Ollama to pick a single outdoor activity that fits the time you have and your answers. It suggests a few things to do once you get there, shows a round-trip walking route on a map (tap "Full map" to open it over the whole screen), and dresses an avatar for the weather. Tap "Preview your walk" to watch a music video of about 30 seconds of the outing that you can save or share: a 3D flyover of the real streets from your door to the park, following you along the route, circling the park, and ending on real photos of it when a Mapillary token is set. If the 3D map can't load, it is an illustrated story instead (getting dressed, the route, the park, and each thing to do).

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

Opening the walk preview loads map tiles for the area around your route from [OpenFreeMap](https://openfreemap.org) (free, no key), so that area is visible to it; nothing is loaded until you open the preview.

Set `MAPILLARY_ACCESS_TOKEN` (a free client token from the [Mapillary developer dashboard](https://www.mapillary.com/dashboard/developers)) to end the walk preview on real photos of the park. When you open the preview, the park's location and the point where the route meets it are sent to Mapillary, and the park's location and name to Wikimedia Commons; nothing is sent until then. Without it the flyover ends on the map.

Set `SENTRY_DSN` to send traces to Sentry. Each request then shows up as one trace with the four workflow steps, the agent run, the Gemma call, and every outgoing API request, including latency and token usage. The traces include step inputs and outputs, so your location, your questionnaire answers, and the prompt leave your machine; the Seoul API key is masked in request URLs, and the Mapillary token is sent in a header, not the URL. Leave it empty and nothing is sent.

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
- `apps/web` shows the questionnaire on the first visit, the suggestion with things to do, a weather panel (sky icon, hourly rain chance for the next 3 hours, air quality, UV, wind, and sunset), the route with Leaflet + OpenStreetMap (with a "Full map" button that opens it full screen with scroll and pinch zoom; Esc or ✕ closes it), and the outfit as a layered SVG avatar next to item cards.
- "Preview your walk" ("Preview your ride" for bike trips, `apps/web/src/components/WalkPreview.tsx`) plays the 3D flyover described below. When the map can't load (no WebGL, or OpenFreeMap unreachable), it draws a 9:16 illustrated story on a canvas instead: the sky and time, the outfit popping onto the avatar, the route traced to the park, the park drawn from its OpenStreetMap features in the current season's colors, one scene per thing to do, and when to be back (plus sunset when it's close). The server tags each thing to do with a scene type (`thingScenes`) so the picture fits the idea. The music is made in the browser with the Web Audio API (`preview/music.ts`), and its mood follows the weather: bright on clear days, mellow when cloudy, lo-fi in rain, and slower at night; scene cuts land on the beat. While it plays, `MediaRecorder` records the canvas and music into an MP4 (WebM where MP4 isn't supported) for the save and share buttons. With reduced motion turned on it shows still frames instead of animation. The preview code loads only when you open it.
- `apps/web/src/preview/flyoverMap.ts` renders the flyover with [MapLibre GL JS](https://maplibre.org) on a hidden 1080×1920 map using OpenFreeMap's Liberty style, which has 3D buildings from OpenStreetMap heights. Minor shop icons, road shields, and one-way arrows are hidden; street names, main places, and transit stay. Buildings, sky, and fog are tinted for the time of day and the weather, and the route is drawn above the buildings so it stays visible behind corners, lit up as far as the walker has gone. Before playing, it visits each camera position once so the tiles are cached (at most 2.5 seconds per stop and 12 in total), and gives up on the map style after 10 seconds.
- `apps/web/src/preview/film.ts` plans the camera and cuts the film on the same music: an establishing shot over the whole way with the time you have, the weather, and what to wear, diving down to street level; a tracking shot behind a location puck walking the real route, turning smoothly at corners, from higher up on longer routes; a slow circle around the park with "You've arrived"; one slow pan across each park photo with a thing to do (or, without photos, more circling while the things to do come up); and a pull-back over the whole way with when to be back and the credits. Each map frame is drawn into the recorded canvas, with the home marker, the walker, and the park pin on top. Night adds a cool tint and the hour before sunset a warm one, plus a vignette. It records at 3.2 Mbps instead of 2.5.
- With `MAPILLARY_ACCESS_TOKEN` set, the preview also asks `POST /api/trip-photos` for photos of the park (`apps/server/src/conditions/photos.ts`) while the map loads: a Mapillary photo taken within 50 m of where the route meets the park, looking into it (within 55°), and up to 3 photos of the park: eye-level Mapillary photos within 80 m of its center from different capture runs first (Mapillary returns the first photos in a box rather than the nearest, so a wider search mostly returned the next streets over), then geotagged Wikimedia Commons photos within 400 m whose title names the park (photos that are only nearby are skipped, so another building is never passed off as the park, and so are night shots and long exposures slower than 1/30 s, and repeats of the same shot). Newer photos are preferred and panoramas skipped. Each search gives up after 5 seconds, and closing the preview cancels them. The browser loads the photos through `GET /api/trip-photos/:key` (the server keeps each source URL for 30 minutes and gives up on a download after 7 seconds), so the canvas can still be recorded. It waits at most 15 seconds for the photo list and 9 seconds for each photo before leaving it out. Photos are color graded once at load (more muted in grey weather), drift slightly like a handheld camera, and are tagged with their source and year.

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
- Glass styling: the glassmorphism skill and `apps/web/src/styles/glass-tokens.css` come from [fengshao1227/ccg-workflow](https://github.com/fengshao1227/ccg-workflow), MIT ([license](.agents/skills/glassmorphism/LICENSE)).
- Map tiles, parks, and park features: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via Nominatim and the [Overpass API](https://overpass-api.de).
- Walking and cycling routes: [OSRM](https://project-osrm.org) on FOSSGIS's [routing.openstreetmap.de](https://routing.openstreetmap.de).
- Weather, air quality, and city search: [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Seoul public bikes: [Seoul Open Data Plaza](https://data.seoul.go.kr).
- Walk preview map: 3D map tiles from [OpenFreeMap](https://openfreemap.org) ([OpenMapTiles](https://openmaptiles.org) schema, © OpenStreetMap contributors), rendered with [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause).
- Walk preview photos: street-level photos of the park by [Mapillary](https://www.mapillary.com) contributors (CC BY-SA 4.0) and park photos from [Wikimedia Commons](https://commons.wikimedia.org) under each author's license; the film's last shot names the map sources, photographers, and licenses.
- Model: [Gemma](https://ai.google.dev/gemma) by Google, under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms).
