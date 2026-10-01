// FairPrice AI backend (Node 18+, no npm install needed)
// Run:  OPENAI_API_KEY=sk-... OWNER_PIN=1234 node server.js
// Then open http://localhost:3000   (keep fairprice-ai.html in the same folder)
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000, KEY = process.env.OPENAI_API_KEY || '', PIN = process.env.OWNER_PIN || '';
const DB = path.join(__dirname, 'data.json');

let db = { menu: {}, reviews: [] };
try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch (e) {}
const save = () => fs.writeFileSync(DB, JSON.stringify(db));
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(ok => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 15e6) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { ok({}); } });
});
const isOwner = req => !PIN || req.headers['x-pin'] === PIN;
const lastPost = {}; // simple spam guard: 1 review / 30s per IP

http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && (u === '/' || u === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'fairprice-ai.html')));
    }
    if (u === '/api/status') return send(res, 200, { ok: true, ai: !!KEY, pinRequired: !!PIN });

    if (u === '/api/menu') {
      if (req.method === 'GET') return send(res, 200, db.menu || {});
      if (req.method === 'POST') {
        if (!isOwner(req)) return send(res, 401, { error: 'Owner PIN required' });
        const b = await readBody(req);
        if (!Array.isArray(b.items)) return send(res, 400, { error: 'Invalid menu' });
        db.menu = { biz: b.biz, items: b.items, d: b.d }; save();
        return send(res, 200, { ok: true });
      }
    }

    if (u === '/api/reviews') {
      if (req.method === 'GET') return send(res, 200, { reviews: db.reviews.slice(0, 200) });
      if (req.method === 'POST') {
        const ip = req.socket.remoteAddress;
        if (Date.now() - (lastPost[ip] || 0) < 30000) return send(res, 429, { error: 'Please wait a little before sending another review.' });
        const b = await readBody(req);
        const rating = Math.round(+b.rating), comment = String(b.comment || '').trim().slice(0, 500);
        if (!(rating >= 1 && rating <= 5) || comment.length < 3) return send(res, 400, { error: 'Add a star rating and a short comment.' });
        lastPost[ip] = Date.now();
        db.reviews.unshift({ id: Date.now(), name: String(b.name || 'Guest').trim().slice(0, 40) || 'Guest', rating, comment, ts: Date.now() });
        db.reviews = db.reviews.slice(0, 2000); save();
        return send(res, 200, { ok: true });
      }
    }

    if (u === '/api/chat' && req.method === 'POST') {
      if (!KEY) return send(res, 400, { error: 'Server has no OPENAI_API_KEY set.' });
      if (!isOwner(req)) return send(res, 401, { error: 'Owner PIN required. Enter it on the QR & Reviews page.' });
      const b = await readBody(req);
      const model = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'].includes(b.model) ? b.model : 'gpt-4o-mini';
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        body: JSON.stringify({ model, messages: (b.messages || []).slice(-30) })
      });
      const j = await r.json();
      return send(res, r.ok ? 200 : r.status, r.ok ? j : { error: (j.error && j.error.message) || 'OpenAI error' });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) { send(res, 500, { error: 'Server error' }); }
}).listen(PORT, () => console.log('FairPrice AI running on http://localhost:' + PORT + (PIN ? '' : '  (tip: set OWNER_PIN to protect your menu & AI)')));