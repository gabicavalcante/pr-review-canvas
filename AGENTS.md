# Working in this repository

- Development setup and checks: [docs/contributing.md](docs/contributing.md). Run `pnpm verify` before pushing.
- `pnpm dev` and `pnpm start` run this clone's server on **port 3011** with its own `.pr-review-dev/`
  home, apart from an installed `pr-review serve` on 3010. Open http://localhost:3011;
  `pnpm start --repo <dir>` adds and opens that project there.
- A script or a second agent runs this clone's CLI as `node bin/pr-review.mjs <command>` and
  its tools as `node_modules/.bin/<tool>`: `pnpm exec` can wait minutes to start a command while
  other pnpm processes run in the clone, which reads as `doctor`, `upgrade`, or `generate` hanging.
- The project's terms (canvas, semantic layer, attention point, review checkout, carried,
  re-judged): [CONTEXT.md](CONTEXT.md).
