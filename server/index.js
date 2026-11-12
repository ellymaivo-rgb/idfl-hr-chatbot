import express from 'express';
import path from 'node:path';
import { config, requireKey, ROOT } from './config.js';
import { loadIndex, answer } from './rag.js';
import { REFUSALS, ERRORS } from './prompts.js';

requireKey();
loadIndex();

const app = express();

// Security Middleware: Clickjacking & XSS Protection
app.disable('x-powered-by');
app.use((req, res, next) => {
  // 1. Anti-Clickjacking: Strictly prevent any website from embedding this app in an iframe
  res.setHeader('X-Frame-Options', 'DENY');

  // 2. Content-Security-Policy (CSP): Modern multi-layer protection against XSS and Clickjacking
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "connect-src 'self'; " +
      "img-src 'self' data:; " +
      "frame-ancestors 'none'; " +
      "object-src 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self';"
  );

  // 3. Prevent MIME-sniffing exploits
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 4. Referrer & Permissions Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  next();
});

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(ROOT, 'public')));

/**
 * POST /api/chat  { message, language: 'vi'|'en', history: [{role, content}] }
 * Streams newline-delimited JSON events:
 *   {type:'delta', text} ... {type:'sources', sources:[...]} {type:'done'}
 */
app.post('/api/chat', async (req, res) => {
  const language = req.body?.language === 'en' ? 'en' : 'vi';
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
  if (!message) return res.status(400).json({ error: 'Empty message' });

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  try {
    const { answered, chunks } = await answer({ message, language, history }, (text) => send({ type: 'delta', text }));
    if (!answered) {
      send({ type: 'delta', text: REFUSALS[language] });
      send({ type: 'refused' });
    } else {
      // Map sources with their 1-based index corresponding to <doc id="...">
      const sources = chunks.map((c, i) => ({
        id: i + 1,
        title: c.title,
        category: c.category,
        file: path.basename(c.source),
        score: +c.score.toFixed(3),
        excerpt: c.text.length > 350 ? c.text.slice(0, 350).trim() + '...' : c.text.trim(),
      }));
      send({ type: 'sources', sources });
    }
  } catch (err) {
    console.error('Chat error:', err?.message || err);
    send({ type: 'error', text: ERRORS[language] });
  }
  send({ type: 'done' });
  res.end();
});

app.listen(config.port, () => console.log(`🚀 HR chatbot running at http://localhost:${config.port}`));
