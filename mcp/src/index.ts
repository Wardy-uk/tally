#!/usr/bin/env node
/**
 * Tally MCP server — exposes your household finance data to any MCP client
 * (Claude Desktop, Claude Code, Cursor, etc).
 *
 * Usage:
 *   TALLY_BASE_URL=https://tally.nickward.co.uk \
 *   TALLY_USERNAME=nickw \
 *   TALLY_PASSWORD=... \
 *   node dist/index.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TallyClient } from './client.js';

const BASE_URL = process.env.TALLY_BASE_URL ?? 'https://tally.nickward.co.uk';
const TOKEN = process.env.TALLY_TOKEN;
const USERNAME = process.env.TALLY_USERNAME;
const PASSWORD = process.env.TALLY_PASSWORD;

const client = new TallyClient({
  baseUrl: BASE_URL,
  token: TOKEN,
  username: USERNAME,
  password: PASSWORD,
});

const server = new Server(
  {
    name: 'tally-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ===== Tool definitions =====

const TOOLS = [
  {
    name: 'tally_health',
    description: 'Check that the Tally server is reachable and responding.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tally_list_accounts',
    description:
      'List every bank account in Tally with its current balance, type, owner, and bank. Use this to see a snapshot of the household\'s financial position.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tally_list_transactions',
    description:
      'List transactions with optional filters. Useful for answering questions like "how much did we spend on groceries last month" or "show me all transactions at Tesco".',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'number', description: 'Filter by a specific Tally account id' },
        categoryId: {
          description: 'Filter by category id, or the string "none" for uncategorised only',
        },
        dateFrom: { type: 'string', description: 'ISO date (YYYY-MM-DD) — inclusive' },
        dateTo: { type: 'string', description: 'ISO date (YYYY-MM-DD) — inclusive' },
        search: { type: 'string', description: 'Free-text search in description or merchant' },
        type: { type: 'string', enum: ['income', 'expense'], description: 'Only income or only expense' },
        includeTransfers: { type: 'boolean', description: 'Include internal transfers (default false)' },
        limit: { type: 'number', description: 'Max rows (default 100, max 500)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tally_monthly_summary',
    description:
      'Get the income, expense, net, and top spending categories for a given month. Defaults to the current month.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM format, e.g. "2026-04". Defaults to current month.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tally_dashboard',
    description:
      'Get the full dashboard snapshot: net worth, monthly income/expense, 6-month trend, top merchants, recent transactions, salary widgets per user. One call gives you everything you need for a financial overview.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM format, defaults to current.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tally_budget_status',
    description:
      'Get the current status of every active budget: spent vs limit, percent used, and whether each is over/under. Defaults to the current month.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM format, defaults to current.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tally_list_categories',
    description: 'List all transaction categories (expense, income, transfer kinds).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tally_list_subscriptions',
    description:
      'List recurring charges Tally has detected (weekly / monthly / yearly subscriptions). Useful for finding things to cancel.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tally_list_rules',
    description: 'List auto-categorisation rules (merchant matches → category).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tally_sync_now',
    description:
      'Trigger a live bank sync via TrueLayer Open Banking. Pulls any new transactions since the last sync into Tally. Returns counts of imported/skipped/errors.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'tally_generate_insight',
    description:
      'Generate a structured AI insight for a month — summary, highlights, concerns, wins, advice. Requires the Tally OpenAI key to be configured.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM format, defaults to current.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tally_ask',
    description:
      'Ask Tally\'s built-in chat assistant a free-form question. The server has full context (all accounts, all transactions for this and last month, top categories) and responds in natural language.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The question to ask' },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  const respond = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  });

  try {
    switch (name) {
      case 'tally_health':
        return respond(await client.health());

      case 'tally_list_accounts':
        return respond(await client.listAccounts());

      case 'tally_list_transactions':
        return respond(await client.listTransactions(args as any));

      case 'tally_monthly_summary':
        return respond(await client.monthlySummary((args as any).month));

      case 'tally_dashboard':
        return respond(await client.dashboard((args as any).month));

      case 'tally_budget_status':
        return respond(await client.budgetStatus((args as any).month));

      case 'tally_list_categories':
        return respond(await client.listCategories());

      case 'tally_list_subscriptions':
        return respond(await client.listSubscriptions());

      case 'tally_list_rules':
        return respond(await client.listRules());

      case 'tally_sync_now':
        return respond(await client.triggerSync());

      case 'tally_generate_insight':
        return respond(await client.generateInsight((args as any).month));

      case 'tally_ask': {
        const message = (args as any).message as string;
        if (!message) throw new Error('message is required');
        return respond(await client.chat(message));
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${err.message ?? String(err)}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stderr, not stdout — stdout is the JSON-RPC channel
  console.error(`[tally-mcp] connected (base: ${BASE_URL})`);
}

main().catch((e) => {
  console.error('[tally-mcp] fatal', e);
  process.exit(1);
});
