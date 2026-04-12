import OpenAI from 'openai';
import { Settings } from '../db/settings-store.js';

let client: OpenAI | null = null;
let lastKey: string | null = null;

export function getOpenAI(): OpenAI | null {
  const key = Settings.get<string>('openai_api_key') ?? process.env.OPENAI_API_KEY ?? null;
  if (!key) return null;
  if (client && lastKey === key) return client;
  client = new OpenAI({ apiKey: key });
  lastKey = key;
  return client;
}

export function getModel(): string {
  return Settings.get<string>('openai_model') ?? 'gpt-4o-mini';
}

export function isConfigured(): boolean {
  return getOpenAI() !== null;
}
