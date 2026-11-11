// Prueba de carga y de concurrencia. Correr SOLO contra tu sitio ya desplegado, antes del cumple.
// Windows PowerShell:
//   $env:BASE="https://TU-SITIO.workers.dev"; $env:ADMIN="tu_contraseña"; node loadtest.mjs
// Crea 3 usuarios "Test_..." y 3 QRs de prueba. Después usá el botón "Reiniciar toda la base" del admin.
const BASE = (process.env.BASE || '').replace(/\/$/, ''), ADMIN = process.env.ADMIN || '';
const CLIENTS = +process.env.CLIENTS || 30, SECS = +process.env.SECS || 60;
if (!BASE || !ADMIN) { console.log('Faltan las variables BASE y ADMIN (ver el comentario de arriba).'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, { body, admin, token } = {}) {
  const h = { 'content-type': 'application/json' };
  if (admin) h['x-admin-password'] = ADMIN;
  if (token) h.authorization = 'Bearer ' + token;
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, ms: performance.now() - t0, ...j };
}
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  OK    ' : '  FALLA ') + msg); if (!ok) fails++; };

// ---- 1) Polling de N clientes ----
async function polling() {
  console.log(`\n1) ${CLIENTS} clientes consultando /api/version cada ~4,5 s durante ${SECS} s`);
  const lat = []; let errors = 0, total = 0;
  const stop = Date.now() + SECS * 1000;
  await Promise.all(Array.from({ length: CLIENTS }, async (_, i) => {
    await sleep(Math.random() * 4500);
    while (Date.now() < stop) {
      try { const r = await api('/api/version'); total++; if (r.status !== 200) errors++; else lat.push(r.ms); }
      catch { total++; errors++; }
      await sleep(4500 + Math.random() * 500);
    }
  }));
  console.log(`   pedidos: ${total} · errores: ${errors} · mediana: ${pct(lat, .5).toFixed(0)} ms · p95: ${pct(lat, .95).toFixed(0)} ms · máx: ${Math.max(0, ...lat).toFixed(0)} ms`);
  check(errors === 0, 'sin errores');
  check(pct(lat, .95) < 1500, 'p95 menor a 1,5 s');
}

// ---- 2) Carreras en el reclamo de QR ----
async function qrRace() {
  console.log('\n2) Carreras en el reclamo de QR');
  const cfg = await api('/api/admin/config', { admin: true });
  const prev = cfg.qr_hunt_open;
  await api('/api/admin/config', { admin: true, body: { qr_hunt_open: 1 } });
  const sfx = Math.random().toString(36).slice(2, 6);
  const made = await api('/api/admin/users', { admin: true, body: { names: ['Test_A_' + sfx, 'Test_B_' + sfx, 'Test_C_' + sfx] } });
  const users = [];
  for (const u of made) { const l = await api('/api/login', { body: { user_id: u.id, pin: u.pin } }); users.push({ id: u.id, token: l.token }); }
  const before = await api('/api/admin/qr', { admin: true });
  const maxId = Array.isArray(before) ? Math.max(0, ...before.map(q => q.id)) : 0;
  await api('/api/admin/qr/generate', { admin: true, body: { facil: 3 } });
  const after = await api('/api/admin/qr', { admin: true });
  const mine = after.filter(q => q.id > maxId).map(q => q.token);
  const claim = (u, tk) => api('/api/qr/claim', { token: u.token, body: { token: tk } });

  const [r1, r2] = await Promise.all([claim(users[0], mine[0]), claim(users[1], mine[0])]);
  const oks = [r1, r2].filter(r => r.state === 'ok').length;
  check(oks === 1, `dos personas reclaman el MISMO QR a la vez → ganan ${oks} (debe ser 1) [${r1.state} / ${r2.state}]`);

  const [r3, r4] = await Promise.all([claim(users[2], mine[1]), claim(users[2], mine[2])]);
  const oks2 = [r3, r4].filter(r => r.state === 'ok').length;
  check(oks2 === 1, `una persona reclama DOS QRs distintos a la vez → se lleva ${oks2} (debe ser 1) [${r3.state} / ${r4.state}]`);

  const rk = await api('/api/ranking');
  const c = rk.find(x => x.id === users[2].id);
  const gain = c ? c.chips - 20 : null;
  check(gain !== null && gain > 0 && gain <= 12, `las fichas de esa persona subieron una sola vez (+${gain})`);
  await api('/api/admin/config', { admin: true, body: { qr_hunt_open: prev } });
}

await polling();
await qrRace();
console.log(fails ? `\nRESULTADO: ${fails} prueba(s) FALLARON` : '\nRESULTADO: todo bien ✅');
process.exit(fails ? 1 : 0);
