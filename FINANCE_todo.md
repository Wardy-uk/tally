# Personal Finance App — Todo

Working name: **Tally** (rename if you want something else)

## Decisions locked
- **Stack**: Node 20 + Express + better-sqlite3 (persistent, file-based) + React 19 + Vite + Tailwind 4. Deploy to Pi 5 via pm2 (same pattern as NUERO).
- **Users**: 2 logins (you + wife), shared data model. JWT + bcrypt.
- **Accounts**: Multiple per user + joint. Transfers tracked (matched across accounts).
- **Banks v1**: NatWest CSV import with pre-built column mapping profile + generic mapper for others.
- **Open Banking**: TrueLayer Data API — v2 feature (requires app registration + consent flow; free tier covers personal use).
- **Categorisation**: Rules first → GPT fallback for unknowns → manual override always → overrides become new rules (learning loop).
- **GPT**: Full transaction data sent (your API key, your data). Monthly insights, ad-hoc chat ("how much on eating out in March?"), budget recommendations, proactive alerts.
- **Budgets**: AI-suggested from spending history, manually adjustable, monthly resets.
- **Access**: Tailscale-exposed, login required. No public internet exposure.
- **Design**: Distinct from nurtur `ec-*` system. Dark-mode-first, premium finance feel (Monzo/Copilot-style). Large numbers, rounded cards, green/amber/red semantic colours, charts via Recharts or similar.
- **Currency**: GBP only.
- **Privacy**: Full joint visibility — no private accounts.
- **Receipts**: Photo attach on transactions. Android + iPhone upload via Tailscale web UI (camera input + drag-drop). Stored on Pi filesystem, thumbnails in app.
- **Salary model**: Per user, distinguish **base salary** (fixed expected) from **actual income** (what hit the account). Overtime/bonus = delta. Dashboard shows both + variance.

## Phase 1 — Foundations
- [ ] Project scaffold: `package.json`, TS config, Vite config, Tailwind, folder structure
- [ ] SQLite schema: `users`, `accounts`, `transactions`, `categories`, `rules`, `budgets`, `import_batches`, `transfers`, `ai_conversations`, `settings`
- [ ] Auth: JWT login, bcrypt, register (first user = admin, second = invited)
- [ ] Settings store (OpenAI key, TrueLayer creds later, preferences)
- [ ] Design system: dark theme, tokens, base components (Card, Button, Input, Modal, Table, Chart wrapper)

## Phase 2 — Accounts & Import
- [ ] Account CRUD (name, type: current/savings/credit/joint, owner: user1/user2/joint, opening balance)
- [ ] Per-user salary profile: base salary (monthly expected), pay day, linked account
- [ ] CSV upload UI with drag-drop
- [ ] NatWest CSV parser (pre-built profile: Date, Type, Description, Value, Balance, Account Name, Account Number)
- [ ] Generic CSV column mapper (save mapping per account)
- [ ] **Custom import timeframe**: date-range picker on import — only ingest rows within selected window (skip older/newer)
- [ ] Duplicate detection on import (hash of date+amount+description per account)
- [ ] Import batch history with undo

## Phase 3 — Transactions & Categorisation
- [ ] Transaction list view: filter by account/date/category/amount, search, sort
- [ ] Default category seed (Groceries, Eating Out, Transport, Bills, Entertainment, Salary, Transfers, etc.)
- [ ] Rules engine: merchant contains / description regex → category
- [ ] GPT auto-categorise for uncategorised (batched, cached)
- [ ] Manual recategorise with "apply to similar" option → creates rule
- [ ] Transfer detection: match +X on account A with -X on account B within 3 days → flag as transfer, exclude from spend

## Phase 4 — Dashboard & Analysis
- [ ] Home dashboard: net worth, this-month spend vs last, top categories, recent transactions
- [ ] Category breakdown (pie + trend line)
- [ ] Monthly trend charts (income vs spend, by category)
- [ ] Account detail pages with balance over time
- [ ] Search everything (transactions, merchants, notes)
- [ ] **Salary tracker widget**: per user — base vs actual this month, YTD overtime/bonus total, trend chart
- [ ] **Subscriptions view**: auto-detected recurring charges (same merchant + similar amount, ≥2 occurrences at ~monthly/annual cadence). Shows total monthly cost, last charge, next expected, "cancel?" flag for unused
- [ ] Recurring detection runs on import + nightly

## Phase 5 — AI Advice & Chat
- [ ] OpenAI client service (settings-driven, model selectable)
- [ ] Monthly insights generator: runs on 1st of month, stores summary
- [ ] Chat UI: "ask about your finances" — GPT gets query + relevant transactions as context
- [ ] Budget suggestion engine: analyses 3 months history → recommends per-category budgets
- [ ] Budget tracking: live progress bars, threshold alerts (80%, 100%)
- [ ] Proactive insights: unusual spend, new recurring charges, subscription creep

## Phase 6 — Open Banking (v2)
- [ ] TrueLayer app registration walkthrough (docs)
- [ ] OAuth consent flow, token storage, refresh
- [ ] Account linking UI
- [ ] Scheduled pull (daily), dedupe against manual imports
- [ ] Fallback to CSV if token expires or connection breaks

## Phase 7 — Receipts & Polish
- [ ] Receipt upload: camera input + drag-drop, stored under `receipts/YYYY/MM/` on Pi
- [ ] Attach receipt to transaction (1:many), thumbnail in list, full view in drawer
- [ ] OCR receipts via GPT-4o vision: extract merchant, total, date → auto-match to transaction
- [ ] Mobile responsive (iPhone + Android via Tailscale)
- [ ] Export data (CSV, JSON backup)
- [ ] Audit log
- [ ] Pi deploy: pm2 config, nginx reverse proxy (or direct), systemd fallback
- [ ] Nightly DB backup with rotation

## All questions resolved — ready to build.
