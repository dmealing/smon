
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

@.metaobjects/AGENTS.md

## Disk I/O: keep throwaway data off the drives

Test databases, sandboxes and temp files must not wear out the developer's drives.

- **Throwaway data goes in RAM.** Put scratch files, mutation-testing sandboxes (Stryker
  `tempDirName`) and test-only temp directories under `$DEV_SCRATCH` (fall back to the system temp
  directory when it is unset). Delete what you create when the run ends.
- **Test databases run on a capped tmpfs at the image's `VOLUME` path** (`postgres:18*`:
  `/var/lib/postgresql`; `postgres:16/17` and `pgvector:*-pg17`: `/var/lib/postgresql/data`;
  `mysql:8*`: `/var/lib/mysql`; check others with `docker image inspect -f '{{json .Config.Volumes}}'`),
  `size=2g`, with Postgres durability off: `-c fsync=off -c synchronous_commit=off -c full_page_writes=off`.
- **Every container you start, you remove.** Use `docker run --rm`, Testcontainers with Ryuk enabled,
  or explicit teardown in a `finally`/`trap`. Never leave a hand-started database running after your
  task. A database you mean to keep gets the label `dev.keep=true`.
- **Generators and tools never rewrite a file whose bytes did not change**, write any manifest once per
  run (not once per file), and verify drift in memory rather than by rendering everything to a temp
  directory.
- **Run the narrowest tests that prove the change** while iterating (one module, the affected test
  classes); run the full suite once, before the PR.
- **No background processes outlive the task.** Kill test watchers, dev servers and sandboxes you
  started before you finish.
