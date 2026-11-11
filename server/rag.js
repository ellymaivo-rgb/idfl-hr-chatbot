import fs from 'node:fs';
import { config } from './config.js';
import { ai, embed } from './gemini.js';
import { systemPrompt, userPrompt, NO_ANSWER } from './prompts.js';

let index = null;

export function loadIndex() {
  if (!fs.existsSync(config.indexPath)) {
    console.warn('⚠️  No knowledge index found. Run `npm run ingest` first.');
    index = { chunks: [] };
  } else {
    index = JSON.parse(fs.readFileSync(config.indexPath, 'utf8'));
    console.log(`📚 Loaded ${index.chunks.length} knowledge chunks.`);
  }
  return index;
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Return the most relevant chunks above the similarity threshold. */
export async function retrieve(query) {
  if (!index?.chunks.length) return [];
  const [q] = await embed([query], 'RETRIEVAL_QUERY');
  return index.chunks
    .map((c) => ({ ...c, score: dot(q, c.vector) }))
    .filter((c) => c.score >= config.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.topK);
}

/**
 * Answer a question. Calls onDelta(text) for streamed text.
 * Resolves to { answered: boolean, chunks }.
 */
export async function answer({ message, language, history = [] }, onDelta) {
  // Include recent user turns so follow-up questions ("what about foreigners?") retrieve well.
  const recentUser = history.filter((h) => h.role === 'user').slice(-2).map((h) => h.content);
  const chunks = await retrieve([...recentUser, message].join('\n'));

  const contents = [
    ...history.slice(-6).map((h) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
    { role: 'user', parts: [{ text: userPrompt(message, chunks) }] },
  ];

  const stream = await ai.models.generateContentStream({
    model: config.chatModel,
    contents,
    config: { systemInstruction: systemPrompt(language), temperature: 0.2 },
  });

  // Buffer the beginning to detect the NO_ANSWER sentinel before streaming to the user.
  let buffer = '';
  let decided = false;
  let answered = true;
  for await (const part of stream) {
    const text = part.text || '';
    if (!text) continue;
    if (decided) { if (answered) onDelta(text); continue; }
    buffer += text;
    const trimmed = buffer.trimStart();
    if (trimmed.length >= NO_ANSWER.length || !NO_ANSWER.startsWith(trimmed)) {
      decided = true;
      answered = !trimmed.startsWith(NO_ANSWER);
      if (answered) onDelta(buffer);
    }
  }
  if (!decided) {
    // Stream ended before we could decide (very short reply).
    answered = buffer.trim().length > 0 && !buffer.trim().startsWith(NO_ANSWER);
    if (answered) onDelta(buffer);
  }

  return { answered, chunks: answered ? chunks : [] };
}
