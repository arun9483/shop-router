# shop-router

The one public origin of the shop micro frontend platform, routing by path: `/mfe/<name>` and
`/api/<name>` go to that MFE's FES, and everything else goes to the Shell's FES. It lives apart from
the Shell, so a Shell deploy never touches routing. Requirements and decisions are in
[arun-mfe-platform](https://github.com/arun9483/arun-mfe-platform).

## Run

Node 24.22.1 or newer and pnpm 11 (`corepack enable`).

```sh
pnpm install
pnpm build
pnpm start          # http://localhost:3000
```

Copy `.env.example` to `.env` to change its settings. `SHELL_URL` is the Shell's FES, and each
`MFE_<NAME>_URL` is an MFE's FES. Point one at another build to swap that MFE without touching the
Shell.

## Tracing

The router runs the New Relic Node agent, as `shop-router`, so it appears in a trace between the
browser and each FES. Only API calls are traced, named by unit: `api/catalog`, `api/cart` and
`api/shell`. Set `NEW_RELIC_ENABLED=false` to turn it off.

## Health and version

These are public and on by default; set `HEALTH_ENDPOINTS_ENABLED=false` to get 404s instead. They show
only unit names, statuses and versions.

| Endpoint                                  | Answers                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `/health/live`, `/health/ready`           | The router alone, whatever state the units are in                |
| `/version`                                | The router's name, version, commit and build time                |
| `/health/units`                           | Router and every unit: `pass`, `warn` (an MFE is down) or `fail` |
| `/health/units/<name>`                    | One unit's FES readiness, `503` when it fails                    |
| `/version/units`, `/version/units/<name>` | Every unit's FES version, or one of them                         |

Health responses follow the IETF health check draft,
[draft-inadarei-api-health-check-06](https://datatracker.ietf.org/doc/html/draft-inadarei-api-health-check-06):
`application/health+json`, with `status` as `pass`, `warn` or `fail`, a `2xx` for the first two and a
`503` for `fail`. `/health/units` adds `version`, `releaseId`, `serviceId`, and a `<name>:ready` entry
in `checks` for each unit. `status`, `version`, `releaseId` and `serviceId` are the same on every
server in the shop, and `/health/units/<name>` relays the unit's own answer. There is no equivalent standard for version endpoints: `/version` follows
the common shape of name, SemVer version, commit and ISO 8601 build time.

Units are found from `SHELL_URL` and `MFE_<NAME>_URL`. Each FES gets `HEALTH_UNIT_TIMEOUT_MS` (1 s by
default) to answer, and answers are
reused for 3 s. A backend that is down shows in its FES's readiness.

## Deploy

`.github/workflows/deploy-staging.yml` deploys the router to staging on Cloud Run: on every push to `main`
after the checks pass, or by hand (**Actions → Deploy to staging → Run workflow**). It reads each FES's URL
from Cloud Run, so deploy every unit first. The router is public there, and the Cloudflare Worker in
`shop-shell/edge/` forwards the shop's public origin to it.

The workflow reads repository variables `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER` and
`GCP_DEPLOYER`. No Google key is stored: GitHub Actions signs in with workload identity federation.

## Check

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

The end-to-end tests live in `shop-shell` and start this repository from next to it, or from
`SHOP_ROUTER_DIR`.
