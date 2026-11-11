/**
 * Quick quality check: in-scope questions should be answered, out-of-scope refused.
 * Usage: npm test   (server must be running: npm start)
 */
const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const cases = [
  { q: 'Nhân viên được nghỉ phép năm bao nhiêu ngày?', lang: 'vi', expect: 'answer' },
  { q: 'Thời giờ làm việc bình thường tối đa mỗi tuần là bao nhiêu giờ?', lang: 'vi', expect: 'answer' },
  { q: 'What is the compulsory social insurance contribution rate for employees?', lang: 'en', expect: 'answer' },
  { q: 'What does the IDFL Code of Conduct say about conflicts of interest?', lang: 'en', expect: 'answer' },
  { q: 'Thời tiết Hà Nội hôm nay thế nào?', lang: 'vi', expect: 'refuse' },
  { q: 'Who won the 2022 FIFA World Cup?', lang: 'en', expect: 'refuse' },
  { q: 'Viết cho tôi một đoạn code Python sắp xếp mảng', lang: 'vi', expect: 'refuse' },
];

let pass = 0;
for (const c of cases) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: c.q, language: c.lang }),
  });
  const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  const refused = events.some((e) => e.type === 'refused');
  const sources = events.find((e) => e.type === 'sources')?.sources || [];
  const ok = (c.expect === 'refuse') === refused && !events.some((e) => e.type === 'error');
  if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} [${c.lang}] ${c.q}\n   → ${refused ? 'REFUSED' : 'ANSWERED'} | ${text.replace(/\s+/g, ' ').slice(0, 160)}…`);
  if (sources.length) console.log(`   sources: ${sources.map((s) => `${s.title} (${s.score})`).join('; ')}`);
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
