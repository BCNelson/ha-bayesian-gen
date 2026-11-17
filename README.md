# Home Assistant Bayesian Sensor Generator

Builds a [Bayesian binary sensor](https://www.home-assistant.io/integrations/bayesian/) for Home Assistant from your own history data.

You tell it when the sensor *should* have been on (TRUE periods) and when it should have been off (FALSE periods). It pulls the history of every entity from Home Assistant and ranks the entities by how well each state or numeric range separates TRUE from FALSE. It then generates the observations with `prob_given_true` / `prob_given_false` values filled in.

Everything runs in your browser. The analysis runs in Web Workers backed by a Rust/WebAssembly module. Your token and data never leave the browser, apart from the requests to your own Home Assistant instance.

## Running it

### With Nix / direnv

The repo has a flake with Node.js, the Rust toolchain (with the `wasm32-unknown-unknown` target), wasm-pack and binaryen.

```bash
direnv allow        # or: nix develop
npm ci
npm run build:wasm
npm run dev
```

### With plain npm

You need Node 20+, a stable Rust toolchain with `rustup target add wasm32-unknown-unknown`, and [wasm-pack](https://rustwasm.github.io/wasm-pack/).

```bash
npm ci
npm run build:wasm  # compiles src/wasm/bayesian_calculator → src/wasm/pkg
npm run dev         # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | WASM + type-check + production build into `dist/` (set `VITE_BASE_URL` for a sub-path) |
| `npm test` | Vitest unit and worker tests |

## Connecting to Home Assistant

1. In Home Assistant, open your profile, go to **Security → Long-lived access tokens**, and create a token.
2. Enter your HA URL (for example `http://homeassistant.local:8123`) and the token on the **Connect** step.
3. If the app is served from a different origin than HA, allow it in `configuration.yaml`. The connect screen shows the snippet:

   ```yaml
   http:
     cors_allowed_origins:
       - http://localhost:5173
   ```

The URL and token are stored in your browser's `localStorage`, and the app reconnects automatically on reload.

## Workflow

1. **Connect.** The app loads all entities from Home Assistant.
2. **Periods.** Define TRUE and FALSE time ranges. You can generate them or draw them by hand:
   - **From entity:** use an existing entity as ground truth, for example `input_boolean.sleeping` = `on` or `sensor.lux` below 10, over a lookback window. TRUE is the time the entity matched. FALSE is the rest of the window, minus any time the entity was unknown or unavailable. Optional settings drop very short periods and trim a buffer around each transition.
   - **Schedule:** use a weekly window such as weeknights 23:00–07:00 over the last N days. FALSE is either all remaining time or a second window you choose. Midnight crossings and DST changes are handled.
   - **Calendar / Timeline / Bulk / Single:** draw or enter ranges by hand.

   Each generator shows how many TRUE and FALSE periods it will create, and how many hours each covers, before you apply it.
3. **Results.** Run the analysis. Entities appear in a ranked list on the left as they finish. Tick the states and ranges you want, and the sensor config on the right updates immediately. It has three tabs:
   - **YAML:** a `binary_sensor:` block you can paste into `configuration.yaml`. You can also copy or download it.
   - **UI setup:** the same values as percentages (the HA helper UI uses 0–100, YAML uses 0–1), with copy buttons and a *My Home Assistant* link that starts the Bayesian helper setup.
   - **Simulation:** replays the sensor over the fetched history so you can check how it would have behaved.

   The app warns about observations Home Assistant would complain about. These are observations whose two probabilities are almost equal (so they have no effect), and mirrored on/off pairs for the same entity (HA raises a repair for these).

Your periods, generator settings, selected entities and theme are saved in `localStorage` and restored on reload. **Reset** in the header clears the current session.

## Using the generated config

- **YAML:** paste the block into `configuration.yaml`. If you already have a `binary_sensor:` section, add only the list item under it. Then restart Home Assistant or reload YAML.
- **UI:** go to *Settings → Devices & services → Helpers → Create helper → Bayesian*, or use the My Home Assistant button. Enter the prior and threshold, then add each observation with the percentages from the **UI setup** tab.

Treat the generated probabilities as a starting point. Check them with the simulation and adjust the prior and threshold for your use case.

## Project layout

```
src/
  App.vue                         three-step layout, theme (light/dark/auto)
  components/TimePeriodSelector/  period modes, including the generators
  components/EntityAnalyzer.vue   ranked entity list + selection
  components/ConfigOutput.vue     YAML / UI setup / simulation output
  composables/useBayesianAnalysis.ts  state + orchestration
  services/                       HA API, worker pool, simulation
  utils/periodGenerators.ts       pure span math for the generators (unit-tested)
  wasm/bayesian_calculator/       Rust → WASM probability engine
```
