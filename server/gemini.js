import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

export const ai = new GoogleGenAI({ apiKey: config.apiKey });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Embed a list of texts. taskType: RETRIEVAL_DOCUMENT | RETRIEVAL_QUERY */
export async function embed(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await ai.models.embedContent({
        model: config.embedModel,
        contents: texts,
        config: { taskType, outputDimensionality: 768 },
      });
      return res.embeddings.map((e) => normalize(e.values));
    } catch (err) {
      const status = err?.status || err?.code;
      if (attempt < 5 && (status === 429 || status >= 500)) {
        const wait = Math.min(65000, 10000 * 2 ** attempt);
        console.warn(`  rate-limited / server error (${status}), retrying in ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

function normalize(v) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
