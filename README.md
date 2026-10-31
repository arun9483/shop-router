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

## Check

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

The end-to-end tests live in `shop-shell` and start this repository from next to it, or from
`SHOP_ROUTER_DIR`.
