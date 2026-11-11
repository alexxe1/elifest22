// Foto-retos con votación. Fases: collecting (suben fotos) -> voting (todos votan) -> finished (fichas).
// Las fases avanzan solas por reloj (se evalúa en cada consulta de /api/version), el admin puede forzarlas.
// Sin apuestas. Fichas: 'play' (participar) y 'win' (foto más votada), con ref_type='photo' (índice único = sin duplicados).

export const MISSIONS = [
  'La mejor foto de mi perro Toby',
  'Un objeto que parezca tener cara',
  'Una foto desde el ángulo más raro posible',
  'Una foto con aura',
  'Un festejo de gol en el último minuto (lo puede hacer otra persona)',
  'La cosa más rara que encuentres'
];

const CFG = async db =>
  Object.fromEntries((await db.prepare('SELECT key,value FROM config').all()).results.map(r => [r.key, r.value]));
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

async function advance(db, c, bump) {
  const cfg = await CFG(db);
  if (c.status === 'collecting') {
    const n = (await db.prepare('SELECT COUNT(*) n FROM photos WHERE challenge_id=?').bind(c.id).first()).n;
    if (n < 2)   // sin al menos 2 fotos no hay nada para votar
      return db.batch([db.prepare("UPDATE photo_challenges SET status='cancelled',phase_ends_at=datetime('now') WHERE id=? AND status='collecting'").bind(c.id), bump(db)]);
    const vs = Math.max(20, num(cfg.vote_secs, 120));
    return db.batch([db.prepare("UPDATE photo_challenges SET status='voting',phase_ends_at=datetime('now',?) WHERE id=? AND status='collecting'")
      .bind('+' + vs + ' seconds', c.id), bump(db)]);
  }
  // voting -> finished: cuenta votos y reparte fichas (empate en el primer puesto: todos los empatados cobran el premio)
  const photos = (await db.prepare(
    'SELECT p.id,p.user_id,COUNT(v.user_id) votes FROM photos p LEFT JOIN photo_votes v ON v.photo_id=p.id WHERE p.challenge_id=? GROUP BY p.id')
    .bind(c.id).all()).results;
  const max = Math.max(0, ...photos.map(p => p.votes));
  const prize = num(cfg.photo_prize, 10), part = num(cfg.photo_part, 2);
  const L = (u, d, r, note) => db.prepare(
    "INSERT OR IGNORE INTO ledger(user_id,delta,reason,ref_type,ref_id,note) VALUES(?,?,?,'photo',?,?)").bind(u, d, r, c.id, note);
  const st = [db.prepare("UPDATE photo_challenges SET status='finished',phase_ends_at=datetime('now') WHERE id=? AND status='voting'").bind(c.id)];
  photos.forEach(p => {
    if (part > 0) st.push(L(p.user_id, part, 'play', 'Foto-reto: participaste'));
    if (max > 0 && p.votes === max && prize > 0) st.push(L(p.user_id, prize, 'win', 'Foto-reto: ¡foto más votada!'));
  });
  st.push(bump(db));
  return db.batch(st);
}

export async function ensurePhoto(db, bump) {
  try {
    const c = await db.prepare(
      "SELECT *, (phase_ends_at <= datetime('now')) AS due FROM photo_challenges WHERE status IN ('collecting','voting') ORDER BY id DESC LIMIT 1").first();
    if (c && c.due) await advance(db, c, bump);
  } catch (e) { /* si falta la migración 5, los foto-retos quedan apagados y lo demás anda */ }
}

async function state(db, uid) {
  const c = await db.prepare(
    `SELECT *, CAST(MAX(0,(julianday(phase_ends_at)-julianday('now'))*86400) AS INTEGER) AS secs_left,
     CAST(MAX(0,(julianday('now')-julianday(phase_ends_at))*86400) AS INTEGER) AS since_end
     FROM photo_challenges ORDER BY id DESC LIMIT 1`).first();
  if (!c) return { challenge: null };
  const active = c.status === 'collecting' || c.status === 'voting';
  const cfg = await CFG(db);
  const out = { challenge: { id: c.id, mission: c.mission, status: c.status, secs_left: active ? c.secs_left : 0, since_end: c.since_end },
    prize: num(cfg.photo_prize, 10), part: num(cfg.photo_part, 2), my_photo: null, my_vote: null };
  const photos = (await db.prepare('SELECT id,user_id FROM photos WHERE challenge_id=? ORDER BY id').bind(c.id).all()).results;
  const mine = uid ? photos.find(p => p.user_id === uid) : null;
  out.my_photo = mine ? mine.id : null;
  if (uid) {
    const v = await db.prepare('SELECT photo_id FROM photo_votes WHERE challenge_id=? AND user_id=?').bind(c.id, uid).first();
    out.my_vote = v ? v.photo_id : null;
  }
  if (c.status === 'voting')   // anónimas y sin conteo hasta que termina la votación
    out.photos = photos.map((p, i) => ({ id: p.id, n: i + 1, mine: p.user_id === uid }));
  if (c.status === 'finished') {
    const rs = (await db.prepare(
      `SELECT p.id,u.name,COUNT(v.user_id) votes FROM photos p JOIN users u ON u.id=p.user_id
       LEFT JOIN photo_votes v ON v.photo_id=p.id WHERE p.challenge_id=? GROUP BY p.id ORDER BY votes DESC,p.id`).bind(c.id).all()).results;
    const max = Math.max(0, ...rs.map(r => r.votes));
    out.results = rs.map(r => ({ ...r, n: photos.findIndex(p => p.id === r.id) + 1, winner: max > 0 && r.votes === max }));
  }
  return out;
}

export async function handlePhotos(req, env, p, m, H) {
  const db = env.DB, J = H.J;
  let mm;

  if (p === '/api/photo/current' && m === 'GET') {
    try {
      const u = (req.headers.get('authorization') || '') ? await H.authUser(req, db) : null;
      return J(await state(db, u ? u.id : null));
    } catch (e) { return J({ challenge: null }); }
  }

  if ((mm = p.match(/^\/api\/photo\/img\/(\d+)$/)) && m === 'GET') {
    const r = await db.prepare('SELECT data FROM photos WHERE id=?').bind(mm[1]).first();
    if (!r) return new Response('no', { status: 404 });
    const bin = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
    return new Response(bin, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=600' } });
  }

  if (p === '/api/photo/submit' && m === 'POST') {
    const u = await H.authUser(req, db);
    if (!u) return J({ error: 'Sesión vencida' }, 401);
    const { data } = await req.json();
    const pre = 'data:image/jpeg;base64,';
    if (typeof data !== 'string' || !data.startsWith(pre)) return J({ error: 'Foto inválida' }, 400);
    const b64 = data.slice(pre.length);
    if (b64.length > 450000 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return J({ error: 'La foto es muy pesada o inválida' }, 400);
    await ensurePhoto(db, H.bump);
    const c = await db.prepare("SELECT id FROM photo_challenges WHERE status='collecting' ORDER BY id DESC LIMIT 1").first();
    if (!c) return J({ error: 'No hay foto-reto abierto para subir fotos' }, 409);
    // Una foto por persona y reto; si vuelve a subir, reemplaza la anterior (mientras dure el tiempo).
    const r = await db.prepare(
      `INSERT INTO photos(challenge_id,user_id,data)
       SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM photo_challenges WHERE id=? AND status='collecting' AND phase_ends_at > datetime('now'))
       ON CONFLICT(challenge_id,user_id) DO UPDATE SET data=excluded.data`).bind(c.id, u.id, b64, c.id).run();
    if (!r.meta.changes) return J({ error: 'Se acabó el tiempo para subir fotos' }, 409);
    return J({ ok: true });
  }

  if (p === '/api/photo/vote' && m === 'POST') {
    const u = await H.authUser(req, db);
    if (!u) return J({ error: 'Sesión vencida' }, 401);
    const { photo_id } = await req.json();
    await ensurePhoto(db, H.bump);
    const c = await db.prepare("SELECT id FROM photo_challenges WHERE status='voting' ORDER BY id DESC LIMIT 1").first();
    if (!c) return J({ error: 'La votación no está abierta' }, 409);
    const ph = await db.prepare('SELECT user_id FROM photos WHERE id=? AND challenge_id=?').bind(Number(photo_id), c.id).first();
    if (!ph) return J({ error: 'Esa foto no está en la votación' }, 404);
    if (ph.user_id === u.id) return J({ error: 'No podés votar tu propia foto' }, 403);
    // Un voto por persona; puede cambiarlo hasta que cierre la votación.
    const r = await db.prepare(
      `INSERT INTO photo_votes(challenge_id,user_id,photo_id)
       SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM photo_challenges WHERE id=? AND status='voting' AND phase_ends_at > datetime('now'))
       ON CONFLICT(challenge_id,user_id) DO UPDATE SET photo_id=excluded.photo_id`).bind(c.id, u.id, Number(photo_id), c.id).run();
    if (!r.meta.changes) return J({ error: 'Se cerró la votación' }, 409);
    return J({ ok: true });
  }

  // ---------- Admin ----------
  if (p.startsWith('/api/admin/photo')) {
    if (!H.isAdmin(req, env)) return J({ error: 'Contraseña incorrecta' }, 403);

    if (p === '/api/admin/photo/state' && m === 'GET') {
      const c = await db.prepare(
        `SELECT *, CAST(MAX(0,(julianday(phase_ends_at)-julianday('now'))*86400) AS INTEGER) AS secs_left FROM photo_challenges ORDER BY id DESC LIMIT 1`).first();
      if (!c) return J({ challenge: null, photos: [] });
      const photos = (await db.prepare(
        `SELECT p.id,u.name,COUNT(v.user_id) votes FROM photos p JOIN users u ON u.id=p.user_id
         LEFT JOIN photo_votes v ON v.photo_id=p.id WHERE p.challenge_id=? GROUP BY p.id ORDER BY p.id`).bind(c.id).all()).results;
      return J({ challenge: { id: c.id, mission: c.mission, status: c.status, secs_left: c.secs_left }, photos });
    }

    if (p === '/api/admin/photo/start' && m === 'POST') {
      const b = await req.json();
      const act = await db.prepare("SELECT id FROM photo_challenges WHERE status IN ('collecting','voting')").first();
      if (act) return J({ error: 'Ya hay un foto-reto en marcha. Cancelalo o esperá a que termine.' }, 409);
      let mission = String(b.mission || '').trim().slice(0, 140);
      if (!mission) {
        const used = new Set((await db.prepare('SELECT mission FROM photo_challenges').all()).results.map(r => r.mission));
        const free = MISSIONS.filter(x => !used.has(x)), pool = free.length ? free : MISSIONS;
        mission = pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length];
      }
      const secs = Math.max(30, num((await CFG(db)).photo_secs, 300));
      await db.batch([
        db.prepare("INSERT INTO photo_challenges(mission,status,phase_ends_at) VALUES(?, 'collecting', datetime('now',?))").bind(mission, '+' + secs + ' seconds'),
        H.bump(db)]);
      return J({ ok: true, mission });
    }

    if (p === '/api/admin/photo/next' && m === 'POST') {
      const c = await db.prepare("SELECT id FROM photo_challenges WHERE status IN ('collecting','voting') ORDER BY id DESC LIMIT 1").first();
      if (!c) return J({ error: 'No hay foto-reto en marcha' }, 409);
      await db.prepare("UPDATE photo_challenges SET phase_ends_at=datetime('now','-1 seconds') WHERE id=?").bind(c.id).run();
      await ensurePhoto(db, H.bump);
      return J({ ok: true });
    }

    if (p === '/api/admin/photo/cancel' && m === 'POST') {
      await db.batch([db.prepare("UPDATE photo_challenges SET status='cancelled',phase_ends_at=datetime('now') WHERE status IN ('collecting','voting')"), H.bump(db)]);
      return J({ ok: true });
    }

    // Moderación: borrar una foto (y sus votos) mientras el reto sigue en marcha
    if (p === '/api/admin/photo/delete' && m === 'POST') {
      const { photo_id } = await req.json(), id = Number(photo_id);
      await db.batch([
        db.prepare("DELETE FROM photo_votes WHERE photo_id=? AND challenge_id IN (SELECT id FROM photo_challenges WHERE status IN ('collecting','voting'))").bind(id),
        db.prepare("DELETE FROM photos WHERE id=? AND challenge_id IN (SELECT id FROM photo_challenges WHERE status IN ('collecting','voting'))").bind(id)]);
      return J({ ok: true });
    }
  }
  return null;
}
