# FAQ

## Is BunRelay a production-ready chat app?

Not as a finished product UI. It is a production-oriented template with a serious backend baseline and a lightweight demo frontend.

## Is BunRelay an npm package?

No. BunRelay is designed to be cloned or forked as a repository template.

## Why Bun instead of Express or Socket.IO?

The project is intentionally built to showcase Bun-native primitives and native WebSocket handling with fewer abstraction layers.

## Why keep the frontend simple?

Because the main value of BunRelay is the backend architecture, protocol design, and operational baseline. The demo UI exists to validate flows quickly.

## Can I use Postgres instead of SQLite?

Yes. SQLite is the fast local default, and Postgres is supported for a more realistic deployment path.

## Do I need Redis?

No for single-instance development. Yes if you want multi-instance realtime fanout.

## Where is the full API reference?

See `docs/api.md`.
