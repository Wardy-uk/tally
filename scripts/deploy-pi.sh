#!/bin/bash
# Tally — Pi 5 deployment helper.
# Run on the Pi after cloning the repo.

set -e

cd "$(dirname "$0")/.."

echo "==> Installing dependencies (production only)"
npm ci --omit=dev || npm install --omit=dev

echo "==> Building client"
npm install --include=dev
npm run build

echo "==> Creating runtime directories"
mkdir -p receipts backups logs

echo "==> Installing pm2 if not present"
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
fi

echo "==> Starting under pm2"
pm2 startOrReload ecosystem.config.cjs
pm2 save

echo ""
echo "==> Done. Tally is running."
echo "    Logs:     pm2 logs tally"
echo "    Restart:  pm2 restart tally"
echo "    URL:      http://$(hostname -I | awk '{print $1}'):3002"
echo ""
echo "If this is the first install, run: sudo pm2 startup"
echo "then re-run pm2 save so it auto-starts on reboot."
