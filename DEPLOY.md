# Deploying Tally to the Pi 5

## Prerequisites on the Pi
- **Node 22+** (node 25 recommended). Install via nvm:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  nvm install 22
  nvm use 22
  ```
- **git** (`sudo apt install git`)
- **sharp** requires `libvips` — pre-installed on Raspberry Pi OS. If it complains:
  ```bash
  sudo apt install libvips-dev
  ```

## First deploy

```bash
# From your laptop, push the repo to GitHub or Tailscale-rsync to the Pi:
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude 'tally.db*' \
  --exclude 'receipts/' --exclude 'backups/' --exclude 'settings.json' \
  ./ nickw@100.100.28.58:~/tally/

# On the Pi:
ssh nickw@100.100.28.58
cd ~/tally
source ~/.nvm/nvm.sh
bash scripts/deploy-pi.sh
```

The deploy script:
1. Installs deps
2. Builds the Vite client + TypeScript server
3. Creates `receipts/`, `backups/`, `logs/` directories
4. Starts the app under `pm2`

## Setup on first run

1. Open `http://pi.local:3002` (or whatever your Pi hostname/IP is)
2. Register the first admin user
3. **Settings** → add your OpenAI key (for insights, chat, budgets, receipt OCR)
4. **Settings** → optionally configure TrueLayer (client ID, secret, redirect URI)
5. **Accounts** → add bank accounts
6. **Import** → drop a NatWest CSV, or Settings → TrueLayer → Connect bank

## Auto-start on boot

After the first successful `pm2 start`:

```bash
sudo pm2 startup
# pm2 will print a command — copy/paste it
pm2 save
```

## Accessing from phones / other devices

Tally is designed to run behind Tailscale — only your devices on the tailnet can reach it.

**Find your Pi's tailnet address:**
```bash
tailscale ip -4
# e.g. 100.100.28.58
```

Then bookmark `http://100.100.28.58:3002` on your phone. Works on iOS and Android (Tally's receipt camera upload works on both).

## Updates

On your laptop, commit + push changes. On the Pi:
```bash
cd ~/tally
git pull
bash scripts/deploy-pi.sh
```

`pm2 startOrReload` handles zero-downtime restart.

## What's safe, what's not

| File | Source of truth | On Pi |
|---|---|---|
| `tally.db` | Pi | Keep |
| `settings.json` | Pi | Keep (has API keys) |
| `users.json` | Pi | Keep (has password hashes) — N.B. not currently used; users are in SQLite |
| `receipts/` | Pi | Keep |
| `backups/` | Pi | Keep |
| Everything else | Git | Overwritten by `git pull` |

`rsync` excludes all of the above on upload.

## Backups

- Daily auto-backup to `backups/` with 14-day rotation
- Manual backup via Settings → Backups → "Create backup now"
- Manual JSON export via Settings → Backups → "Export JSON"

Copy the backups off the Pi periodically:
```bash
rsync -avz nickw@100.100.28.58:~/tally/backups/ ~/tally-backups/
```

## Troubleshooting

- **`node:sqlite` experimental warning** — harmless, suppressed via `--no-warnings`
- **Client shows "No token" everywhere** — JWT secret changed or user was deleted. Log out and back in.
- **Receipt OCR fails** — you need an OpenAI key in Settings
- **TrueLayer "invalid_state"** — session expired (>10 min between clicking Connect and finishing OAuth). Just retry.
- **Port 3002 already in use** — `pm2 delete tally && pm2 start ecosystem.config.cjs`
