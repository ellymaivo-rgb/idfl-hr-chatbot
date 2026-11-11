import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  apiKey: process.env.GEMINI_API_KEY,
  chatModel: process.env.CHAT_MODEL || 'gemini-3.5-flash',
  embedModel: process.env.EMBED_MODEL || 'gemini-embedding-001',
  docsDirs: (process.env.DOCS_DIRS || '../Internal Policies & Handbooks;../Taxation & Labor Legislation')
    .split(';').map((d) => d.trim()).filter(Boolean).map((d) => path.resolve(ROOT, d)),
  minScore: Number(process.env.MIN_SCORE || 0.55),
  topK: Number(process.env.TOP_K || 8),
  port: Number(process.env.PORT || 3000),
  indexPath: path.join(ROOT, 'data', 'index.json'),
};

export function requireKey() {
  if (!config.apiKey || config.apiKey === 'your-key-here') {
    console.error('\n❌ Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.\n   Get one free at https://aistudio.google.com/apikey\n');
    process.exit(1);
  }
}
