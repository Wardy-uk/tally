# Tally MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants (Claude Desktop, Claude Code, Cursor, etc) live access to your Tally household finance data.

Once installed, you can ask your AI:

> "How much did we spend on eating out last month?"
> "Which subscriptions should we cancel?"
> "What's our net worth right now?"
> "Why was April's spend so high?"
> "Trigger a bank sync"

…and the AI will call Tally's real API under the hood.

## What it exposes

| Tool | What it does |
|---|---|
| `tally_health` | Connectivity check |
| `tally_list_accounts` | Every account + current balance |
| `tally_list_transactions` | Filter by date, account, category, type, search |
| `tally_monthly_summary` | Income/expense/net + category breakdown |
| `tally_dashboard` | Full snapshot: net worth, KPIs, trend, top merchants, salary widgets |
| `tally_budget_status` | Budgets vs actual for a month |
| `tally_list_categories` | All categories |
| `tally_list_subscriptions` | Auto-detected recurring charges |
| `tally_list_rules` | Auto-categorisation rules |
| `tally_sync_now` | Trigger a live TrueLayer bank sync |
| `tally_generate_insight` | GPT-generated monthly review |
| `tally_ask` | Free-form question through Tally's own chat |

## Install

```bash
cd mcp
npm install
npm run build
```

This produces `dist/index.js`.

## Configure

Three environment variables:

| Var | Default | Required |
|---|---|---|
| `TALLY_BASE_URL` | `https://tally.nickward.co.uk` | No |
| `TALLY_USERNAME` | — | One of these |
| `TALLY_PASSWORD` | — | is needed |
| `TALLY_TOKEN` | — | or this |

Either set `TALLY_USERNAME` + `TALLY_PASSWORD` (the server will auto-login and refresh tokens), or paste a long-lived JWT into `TALLY_TOKEN` directly.

## Add to Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS:

```json
{
  "mcpServers": {
    "tally": {
      "command": "node",
      "args": ["C:/Users/NickW/Claude/finance/mcp/dist/index.js"],
      "env": {
        "TALLY_BASE_URL": "https://tally.nickward.co.uk",
        "TALLY_USERNAME": "nickw",
        "TALLY_PASSWORD": "your-password"
      }
    }
  }
}
```

Restart Claude Desktop and the tools will appear in the tools menu.

## Add to Claude Code

Claude Code reads from `~/.claude/mcp.json` or the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "tally": {
      "command": "node",
      "args": ["/absolute/path/to/finance/mcp/dist/index.js"],
      "env": {
        "TALLY_BASE_URL": "https://tally.nickward.co.uk",
        "TALLY_USERNAME": "nickw",
        "TALLY_PASSWORD": "your-password"
      }
    }
  }
}
```

Then in Claude Code: `/mcp` to verify connection.

## Add to Cursor / other MCP clients

Same pattern — most clients accept a `command` + `args` + `env` config block.

## Security

Your Tally creds are stored in the MCP client config. That file is local to your machine — treat it like a `.env`. Don't commit it to git.

Prefer `TALLY_TOKEN` (which you can revoke by logging out of Tally on all devices) over `TALLY_PASSWORD` if your client supports pasting tokens.

## Dev

```bash
npm run dev  # tsx watch
```

Outputs to stdout (JSON-RPC) and stderr (logs). You can manually drive it:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

## Troubleshooting

- **"No Tally token or username/password configured"** → set the env vars in your MCP client config, not just your shell
- **"Login failed: 401"** → wrong username/password. Log in to Tally in the browser first to confirm they work
- **Network errors** → the MCP server runs on the machine where the AI client lives. If that machine can't reach `tally.nickward.co.uk` (e.g. you're off the tailnet and the app is on private DNS) the server can't either
