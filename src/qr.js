// Búsqueda del tesoro (paso 3): un solo QR por persona, reclamo atómico.
const CATS = ['facil', 'medio', 'dificil', 'extremo'];

// Código corto visible bajo cada QR: primeros 6 caracteres (hex, mayúsculas) del SHA-256 del token.
// Sirve para reclamar desde dentro de la app cuando el celu abre el QR en otro navegador.
async function codeOf(token) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
}

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(16)); // 128 bits
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function handleQr(req, env, p, m, H) {
  const db = env.DB, J = H.J;
  let mm;

  // ---------- Reclamo (usuario logueado) ----------
  if (p === '/api/qr/claim' && m === 'POST') {
    const u = await H.authUser(req, db);
    if (!u) return J({ error: 'Sesión vencida' }, 401);
    const body = await req.json();
    let token = body.token;
    const cfg = Object.fromEntries((await db.prepare('SELECT key,value FROM config').all()).results.map(r => [r.key, r.value]));
    if (cfg.qr_hunt_open !== '1') return J({ state: 'closed' });

    if (!token && body.code) {                          // por código corto (ej: A3F09C)
      const code = String(body.code).toUpperCase().replace(/[^0-9A-F]/g, '');
      if (code.length === 6)
        for (const r of (await db.prepare('SELECT token FROM qr_codes').all()).results)
          if ((await codeOf(r.token)) === code) { token = r.token; break; }
    }
    const qr = await db.prepare('SELECT * FROM qr_codes WHERE token=?').bind(String(token || '')).first();
    if (!qr) return J({ state: 'invalid' });
    const mine = await db.prepare('SELECT id FROM qr_codes WHERE claimed_by=?').bind(u.id).first();
    if (mine) return J({ state: 'already_used' });      // no revela si este QR estaba libre
    if (qr.claimed_by) return J({ state: 'taken' });    // no revela categoría ni quién

    const chips = Number(cfg['qr_' + qr.category] || 0);
    try {
      // Todo en una transacción: el UPDATE solo pega si sigue libre, y la fila del libro mayor
      // solo se inserta si el QR quedó a nombre de este usuario.
      await db.batch([
        db.prepare("UPDATE qr_codes SET claimed_by=?, claimed_at=datetime('now') WHERE id=? AND claimed_by IS NULL").bind(u.id, qr.id),
        db.prepare("INSERT INTO ledger(user_id,delta,reason,ref_type,ref_id,note) SELECT ?,?,'qr','qr',id,'QR encontrado' FROM qr_codes WHERE id=? AND claimed_by=?")
          .bind(u.id, chips, qr.id, u.id),
        H.bump(db)]);
    } catch (e) {
      return J({ state: 'already_used' });              // choque con el índice único por usuario
    }
    const after = await db.prepare('SELECT claimed_by FROM qr_codes WHERE id=?').bind(qr.id).first();
    if (after.claimed_by !== u.id) return J({ state: 'taken' });
    return J({ state: 'ok', category: qr.category, chips });
  }

  // ---------- Admin ----------
  if (p.startsWith('/api/admin/qr')) {
    if (!H.isAdmin(req, env)) return J({ error: 'Contraseña incorrecta' }, 403);

    if (p === '/api/admin/qr' && m === 'GET') {
      const { results } = await db.prepare(
        `SELECT q.id,q.token,q.category,q.hint,q.claimed_at,u.name AS claimed_by
         FROM qr_codes q LEFT JOIN users u ON u.id=q.claimed_by ORDER BY q.id`).all();
      return J(results);
    }
    if (p === '/api/admin/qr/generate' && m === 'POST') {
      const b = await req.json(), st = [];
      for (const c of CATS) {
        const n = Math.max(0, Math.min(100, parseInt(b[c], 10) || 0));
        for (let i = 0; i < n; i++)
          st.push(db.prepare('INSERT INTO qr_codes(token,category) VALUES(?,?)').bind(newToken(), c));
      }
      if (st.length) await db.batch(st);
      return J({ created: st.length });
    }
    if ((mm = p.match(/^\/api\/admin\/qr\/(\d+)\/hint$/)) && m === 'POST') {
      const { hint } = await req.json();
      await db.prepare('UPDATE qr_codes SET hint=? WHERE id=?').bind(String(hint || ''), mm[1]).run();
      return J({ ok: true });
    }
  }
  return null;
}
