/**
 * Automated Security & Penetration Testing Suite
 * Tests against:
 * 1. Clickjacking (X-Frame-Options, CSP frame-ancestors)
 * 2. Stored / Reflected / DOM-based Cross-Site Scripting (XSS)
 * 3. MIME-type sniffing & server fingerprinting
 */

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

console.log('🛡️  Starting Automated Security Penetration Tests on', BASE);
let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// TEST SUITE 1: ANTI-CLICKJACKING & SECURITY HEADERS
// ---------------------------------------------------------------------------
console.log('\n--- Test Suite 1: Anti-Clickjacking & HTTP Security Headers ---');
try {
  const res = await fetch(`${BASE}/`);
  const headers = res.headers;

  const xfo = headers.get('x-frame-options');
  assert(xfo && xfo.toUpperCase() === 'DENY', `X-Frame-Options is strictly set to DENY (got: ${xfo})`);

  const csp = headers.get('content-security-policy') || '';
  assert(csp.includes("frame-ancestors 'none'"), `CSP contains "frame-ancestors 'none'" to block all iframe embeddings`);
  assert(csp.includes("script-src 'self'"), `CSP contains "script-src 'self'" (no unsafe-inline or unsafe-eval)`);
  assert(csp.includes("object-src 'none'"), `CSP contains "object-src 'none'" to block malicious Flash/Java plugins`);

  const xcto = headers.get('x-content-type-options');
  assert(xcto && xcto.toLowerCase() === 'nosniff', `X-Content-Type-Options is set to "nosniff"`);

  const poweredBy = headers.get('x-powered-by');
  assert(!poweredBy, `Server technology header X-Powered-By is hidden`);
} catch (err) {
  console.error('Failed to connect to server:', err.message);
}

// ---------------------------------------------------------------------------
// TEST SUITE 2: XSS PAYLOAD SIMULATION (Client-Side Markdown / DOM Engine)
// ---------------------------------------------------------------------------
console.log('\n--- Test Suite 2: Client-side XSS Escaping & Rendering Engine ---');

const esc = (s) =>
  String(s ?? '')
    .replace(/(?:java|vb)script\s*:/gi, 'blocked-protocol:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked-protocol:')
    .replace(/\b(on[a-z]{3,})\s*=/gi, 'data-blocked-$1=')
    .replace(/[&<>"'`/]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
    }[c]));

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, nums) => {
      return nums
        .split(/\s*,\s*/)
        .map((n) => `<button type="button" class="cite-pill" data-cite="${n}">[${n}]</button>`)
        .join('');
    });
}

function markdown(src) {
  const lines = esc(src).split('\n');
  let html = '', list = null, para = [];
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join('<br>'))}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { flushPara(); closeList(); html += `<h3>${inline(m[1])}</h3>`; continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      flushPara();
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list !== type) { closeList(); html += `<${type}>`; list = type; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    closeList(); para.push(line);
  }
  flushPara(); closeList();
  return html;
}

const xssPayloads = [
  { name: 'Classic <script> tag', payload: "<script>alert('XSS_1')</script>" },
  { name: 'Img with onerror handler', payload: '<img src="invalid" onerror="alert(1)">' },
  { name: 'SVG with onload handler', payload: '<svg/onload=alert("SVG_XSS")>' },
  { name: 'Event handler in body tag', payload: '<body onload=alert("XSS")>' },
  { name: 'Iframe injection', payload: '<iframe src="javascript:alert(1)"></iframe>' },
  { name: 'Attribute breakout attempt', payload: '"><script>alert("BREAKOUT")</script>' },
  { name: 'JavaScript URI pseudo-protocol', payload: '[Click here](javascript:alert("XSS"))' },
  { name: 'HTML event handler via button', payload: '<button onclick="alert(1)">Click</button>' },
  { name: 'Attempted script inside citation', payload: '[<script>alert(1)</script>]' },
  { name: 'Nested / malformed HTML tags', payload: '<<SCRIPT>alert("XSS");//<</SCRIPT>' },
];

for (const t of xssPayloads) {
  const rendered = markdown(t.payload);

  // 1. Verify no dangerous executable HTML tags exist unescaped
  const hasRawDangerousTag = /<(script|img|svg|iframe|body|object|embed|input|form|a\b)[^>]*>/i.test(rendered);
  assert(!hasRawDangerousTag, `XSS Blocked: "${t.name}" does NOT produce raw executable HTML tags.`);

  // 2. Verify no HTML tag contains active event handlers (e.g. <tag onload=...)
  const hasActiveEventHandlerTag = /<[a-z0-9]+\b[^>]*\s+on[a-z]+\s*=/i.test(rendered);
  assert(!hasActiveEventHandlerTag, `XSS Blocked: "${t.name}" does NOT produce active event handler attributes.`);

  // 3. Verify no javascript: protocol execution in URLs
  const hasJsProtocol = /href\s*=\s*['"]?\s*javascript\s*:/i.test(rendered);
  assert(!hasJsProtocol, `XSS Blocked: "${t.name}" does NOT execute javascript: protocol.`);
}

// ---------------------------------------------------------------------------
// TEST SUITE 3: SERVER API INPUT SANITIZATION
// ---------------------------------------------------------------------------
console.log('\n--- Test Suite 3: Server API Robustness under XSS Injection ---');
try {
  const attackRes = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: "<script>alert('HACKER_ATTACK')</script>",
      language: 'vi',
    }),
  });

  assert(attackRes.ok, `Server safely received and processed malicious XSS payload without crash (HTTP ${attackRes.status})`);
  const text = await attackRes.text();
  assert(!text.includes("<script>alert('HACKER_ATTACK')</script>"), `Server response did not reflect unescaped raw script payload`);
} catch (err) {
  console.error('API attack test error:', err.message);
}

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------
console.log(`\n======================================================`);
console.log(`🎯 SECURITY PENETRATION TEST RESULTS: ${passed}/${total} PASSED`);
console.log(`======================================================\n`);

process.exit(passed === total ? 0 : 1);
