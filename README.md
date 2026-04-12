# Tally — Personal Finance

Personal finance app for the Pi 5. CSV import, GPT-powered advice, budgets, receipts.

## Stack

Express 5 + TypeScript (ESM) · better-sqlite3 · React 19 · Vite 6 · Tailwind 4 · OpenAI

## Quickstart

```bash
npm install
cp .env.example .env
npm run dev
```

- API: http://localhost:3002
- Client: http://localhost:5174

On first run, register the first user — they become admin.

## Phases

See [FINANCE_todo.md](./FINANCE_todo.md).

- **Phase 1 (current)**: Scaffold, schema, auth, design system
- **Phase 2**: Accounts, CSV import (NatWest), transaction dedupe
- **Phase 3**: Rules engine, categorisation, transfer detection
- **Phase 4**: Dashboard, charts, subscriptions, salary tracker
- **Phase 5**: AI advice, budgets, chat
- **Phase 6**: TrueLayer Open Banking
- **Phase 7**: Receipts, Pi deploy, polish

## Deploy (Pi 5)

```bash
npm run build
pm2 start dist/server/index.js --name tally
```

Exposed via Tailscale on the LAN only.
