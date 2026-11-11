/**
 * Ingest knowledge documents (.docx, .pdf, .txt, .md) into data/index.json.
 * Usage: npm run ingest
 * Unchanged chunks reuse their previous embeddings, so re-running is cheap.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mammoth from 'mammoth';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { config, requireKey } from '../server/config.js';

const DRY = process.argv.includes('--dry'); // preview extraction/chunking only, no API calls
if (!DRY) requireKey();
const { embed } = DRY ? {} : await import('../server/gemini.js');

const CHUNK_CHARS = 2500;
const OVERLAP_CHARS = 400;
const BATCH = Number(process.env.EMBED_BATCH || 20);
const DELAY_MS = Number(process.env.EMBED_DELAY_MS || 15000); // pause between batches (free-tier rate limits)
const EXTS = new Set(['.docx', '.pdf', '.txt', '.md']);

function walk(dir) {
  if (!fs.existsSync(dir)) { console.warn(`⚠️  Folder not found: ${dir}`); return []; }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (e.name.startsWith('~$') || e.name.startsWith('.')) return [];
    return EXTS.has(path.extname(e.name).toLowerCase()) ? [p] : [];
  });
}

async function extract(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') return (await mammoth.extractRawText({ path: file })).value;
  if (ext === '.pdf') return (await pdf(fs.readFileSync(file))).text;
  return fs.readFileSync(file, 'utf8');
}

function clean(text) {
  return text
    .replace(/\r/g, '')
    .replace(/\.{4,}|…{2,}/g, ' ') // table-of-contents dot leaders
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const DOC_TYPES = /^(BỘ LUẬT|LUẬT|NGHỊ ĐỊNH|THÔNG TƯ|QUYẾT ĐỊNH|THÔNG BÁO|NGHỊ QUYẾT|VĂN BẢN HỢP NHẤT|CHỈ THỊ)\b/;

/** Build a human-friendly title, e.g. "45/2019/QH14 – Bộ luật Lao động" */
function makeTitle(file, text) {
  const base = path.basename(file, path.extname(file));
  const m = base.match(/^(.+?)_\d{5,}$/); // legal docs: 45_2019_QH14_333670
  const code = m ? m[1].replace(/_/g, '/') : base;
  if (!m) return code;
  const lines = text.slice(0, 3000).split('\n').map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => DOC_TYPES.test(l));
  if (i === -1) return code;
  let t = lines[i];
  const isUpper = (l) => /\p{L}/u.test(l) && l === l.toUpperCase() && !/^(GIÁM ĐỐC|TỔNG GIÁM ĐỐC|CHÍNH PHỦ|BỘ TRƯỞNG|QUỐC HỘI|CĂN CỨ)/.test(l);
  for (let j = i + 1; j < lines.length && j <= i + 4 && t.length < 160 && isUpper(lines[j]) && !DOC_TYPES.test(lines[j]); j++) t += ' ' + lines[j];
  t = t.toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return `${code} – ${t.slice(0, 140)}`;
}

/** Split into overlapping chunks, preferring breaks before "Điều"/"Article"/"Chương" headings. */
function chunk(text) {
  const paras = text.split(/\n+/).filter(Boolean);
  const chunks = [];
  let cur = '';
  const isHeading = (p) => /^(Điều|Article|Chương|Chapter|Mục|Section|PHẦN|Part)\s+[\dIVXLC]+/i.test(p);
  for (const p of paras) {
    const wouldOverflow = cur.length + p.length > CHUNK_CHARS;
    const softBreak = isHeading(p) && cur.length > CHUNK_CHARS * 0.6;
    if (cur && (wouldOverflow || softBreak)) {
      chunks.push(cur.trim());
      cur = (softBreak ? '' : cur.slice(-OVERLAP_CHARS).replace(/^\S*\s/, '')) + '\n';
    }
    if (p.length > CHUNK_CHARS) {
      // very long paragraph: hard-split
      for (let i = 0; i < p.length; i += CHUNK_CHARS - OVERLAP_CHARS) chunks.push(p.slice(i, i + CHUNK_CHARS));
      cur = '';
    } else cur += p + '\n';
  }
  if (cur.trim().length > 40) chunks.push(cur.trim());
  return chunks;
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

// ---------------------------------------------------------------------------
const CACHE_PATH = path.join(path.dirname(config.indexPath), `embed-cache-${config.embedModel}.json`);
const previous = new Map();
if (fs.existsSync(CACHE_PATH)) {
  for (const [h, v] of Object.entries(JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')))) previous.set(h, v);
}

const files = config.docsDirs.flatMap(walk);
console.log(`📂 Found ${files.length} documents in:\n   ${config.docsDirs.join('\n   ')}\n`);

const chunks = [];
for (const file of files) {
  try {
    const text = clean(await extract(file));
    if (text.length < 50) { console.warn(`⚠️  No text extracted (scanned?): ${path.basename(file)}`); continue; }
    const title = makeTitle(file, text);
    const rel = path.relative(path.resolve(config.docsDirs[0], '..'), file);
    const category = path.dirname(rel).split(path.sep).slice(0, 2).join(' / ');
    const parts = chunk(text);
    parts.forEach((t, i) => {
      const body = `[${title}]\n${t}`;
      chunks.push({ id: `${hash(rel)}-${i}`, source: rel, title, category, text: t, hash: hash(body), body });
    });
    console.log(`✅ ${title}  (${parts.length} chunks)`);
  } catch (err) {
    console.error(`❌ Failed: ${path.basename(file)} — ${err.message}`);
  }
}

const todo = chunks.filter((c) => !previous.has(c.hash));
console.log(`\n🧮 ${chunks.length} chunks total, ${chunks.length - todo.length} cached, ${todo.length} to embed...`);
if (DRY) {
  const avg = Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / (chunks.length || 1));
  console.log(`(dry run) avg chunk ${avg} chars. Sample:\n---\n${chunks[Math.floor(chunks.length / 2)]?.body.slice(0, 600)}\n---`);
  process.exit(0);
}
const saveCache = () => fs.writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(previous)));
fs.mkdirSync(path.dirname(config.indexPath), { recursive: true });
let failed = null;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  try {
    const vectors = await embed(batch.map((c) => c.body), 'RETRIEVAL_DOCUMENT');
    batch.forEach((c, j) => previous.set(c.hash, vectors[j].map((x) => +x.toFixed(5))));
    saveCache();
  } catch (err) {
    failed = err;
    break;
  }
  process.stdout.write(`   ${Math.min(i + BATCH, todo.length)}/${todo.length}\r`);
  if (i + BATCH < todo.length) await new Promise((r) => setTimeout(r, DELAY_MS));
}

const out = chunks.filter((c) => previous.has(c.hash)).map(({ body, ...c }) => ({ ...c, vector: previous.get(c.hash) }));
fs.writeFileSync(config.indexPath, JSON.stringify({ model: config.embedModel, createdAt: new Date().toISOString(), chunks: out }));
console.log(`\n💾 Saved ${out.length}/${chunks.length} chunks → ${path.relative(process.cwd(), config.indexPath)}`);
if (failed) {
  console.error(`\n⚠️  Stopped early: ${failed.status || ''} ${String(failed.message).slice(0, 200)}`);
  console.error('   Progress is saved. Run `npm run ingest` again later to continue where it stopped.');
  process.exit(1);
}
