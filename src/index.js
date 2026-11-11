// Cumple 2026 - Worker (pasos 1 y 2)
import { handleTorneos } from './torneos.js';
import { handleQr } from './qr.js';
import { handleBets, ensureBetting } from './bets.js';
import { handlePhotos, ensurePhoto } from './photos.js';
const J = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const newPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
const hashPin = async (pin, salt = rnd(8)) => salt + ':' + await sha(salt + pin);
const checkPin = async (pin, stored) => { const [s, h] = stored.split(':'); return (await sha(s + pin)) === h; };

// Sube el contador: los clientes lo ven en /api/version y recién ahí recargan.
const bump = db => db.prepare("UPDATE config SET value = CAST(value AS INTEGER)+1 WHERE key='data_version'");

async function authUser(req, db) {
  const t = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!t) return null;
  return await db.prepare(
    'SELECT u.id,u.name,u.has_phone FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?'
  ).bind(await sha(t)).first();
}
const isAdmin = (req, env) => !!env.ADMIN_PASSWORD && (req.headers.get('x-admin-password') || '').trim() === String(env.ADMIN_PASSWORD).trim();

const balanceSql = 'SELECT COALESCE(SUM(delta),0) AS b FROM ledger WHERE user_id=?';

// Valores por defecto de la configuración (se usan solo para "Restaurar configuración"; el reinicio de datos NO los toca).
const DEFAULT_CFG = { initial_chips: 20, chips_play: 2, chips_win: 3, ppt_chips_play: 1, ppt_chips_win: 2,
  bonus_champion: 15, bonus_runnerup: 8, bonus_semi: 4, wait_confirm: 1, max_sessions: 3,
  qr_facil: 3, qr_medio: 6, qr_dificil: 12, qr_extremo: 30, qr_hunt_open: 0,
  photo_secs: 300, vote_secs: 120, photo_prize: 10, photo_part: 2,
  bet_window_secs: 90, bet_cooldown_secs: 45, bet_max_abs: 10, bet_max_pct: 50, bet_seed: 4, bet_mult_cap: 6 };

// Límite de frecuencia de las tareas por reloj (apuestas y foto-retos): como mucho una vez por segundo por instancia.
let lastEnsure = 0;

const worker = {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname, m = req.method, db = env.DB;
    if (p.startsWith('/q/')) return env.ASSETS.fetch(new Request(new URL('/claim', url), req)); // página de reclamo de QR
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      // ---------- público ----------
      if (p === '/api/version') {
        if (Date.now() - lastEnsure > 1000) {
          lastEnsure = Date.now();
          await ensureBetting(db, bump);
          await ensurePhoto(db, bump);
        }
        const r = await db.prepare("SELECT value FROM config WHERE key='data_version'").first();
        return J({ v: Number(r.value) });
      }
      // Un solo pedido con todo lo que necesita la pantalla del celu / la TV (antes eran 5 pedidos por cada cambio).
      if (p === '/api/state') {
        const get = pp => worker.fetch(new Request(new URL(pp, url), { headers: req.headers }), env).then(r => r.json()).catch(() => ({}));
        const [me, ranking, tournaments, bets, photo] = await Promise.all(
          ['/api/me', '/api/ranking', '/api/tournaments', '/api/bets/current', '/api/photo/current'].map(get));
        const hunt = await db.prepare("SELECT value FROM config WHERE key='qr_hunt_open'").first();
        const got = me && me.id ? await db.prepare('SELECT 1 x FROM qr_codes WHERE claimed_by=?').bind(me.id).first() : null;
        return J({ me, ranking, tournaments, bets, photo, qr: { open: !!hunt && hunt.value === '1', claimed: !!got } });
      }
      if (p === '/api/names') {
        const { results } = await db.prepare('SELECT id,name FROM users ORDER BY name').all();
        return J(results);
      }
      if (p === '/api/ranking') {
        const { results } = await db.prepare(
          `SELECT u.id,u.name,COALESCE(SUM(l.delta),0) AS chips,COALESCE(MAX(l.id),0) AS last
           FROM users u LEFT JOIN ledger l ON l.user_id=u.id
           GROUP BY u.id ORDER BY chips DESC,last ASC`).all();
        return J(results.map(({ id, name, chips }) => ({ id, name, chips })));
      }
      if (p === '/api/login' && m === 'POST') {
        const { user_id, pin } = await req.json();
        const u = await db.prepare('SELECT * FROM users WHERE id=?').bind(user_id).first();
        if (!u) return J({ error: 'Ese usuario no existe' }, 404);
        const n = await db.prepare(
          "SELECT COUNT(*) c FROM login_attempts WHERE user_id=? AND created_at > datetime('now','-5 minutes')"
        ).bind(u.id).first();
        if (n.c >= 5) return J({ error: 'Demasiados intentos. Esperá 5 minutos.' }, 429);
        if (!(await checkPin(String(pin || ''), u.pin_hash))) {
          await db.prepare('INSERT INTO login_attempts(user_id) VALUES(?)').bind(u.id).run();
          return J({ error: 'PIN incorrecto' }, 401);
        }
        // El PIN sirve para hasta `max_sessions` dispositivos (por defecto 3: ej. Safari + Chrome + un celu nuevo).
        // El conteo es atómico: dos intentos a la vez no se saltean el límite. "Salir" libera el lugar; si el admin
        // resetea el PIN, se borran todas las sesiones y la tarjeta nueva vuelve a empezar.
        const token = rnd(24);
        const lim = Math.max(1, parseInt((await db.prepare("SELECT value FROM config WHERE key='max_sessions'").first())?.value, 10) || 3);
        const ins = await db.prepare('INSERT INTO sessions(token_hash,user_id) SELECT ?,? WHERE (SELECT COUNT(*) FROM sessions WHERE user_id=?) < ?')
          .bind(await sha(token), u.id, u.id, lim).run();
        if (!ins.meta.changes) return J({ error: 'Este PIN ya se usó en ' + lim + ' dispositivos. Avisale al organizador para que te dé uno nuevo.' }, 403);
        await bump(db).run();
        return J({ token, name: u.name });
      }

      // ---------- usuario logueado ----------
      if (p === '/api/logout' && m === 'POST') {          // libera el lugar de este dispositivo
        const t = (req.headers.get('authorization') || '').replace('Bearer ', '');
        if (t) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(t)).run();
        return J({ ok: true });
      }
      if (p === '/api/me') {
        const u = await authUser(req, db);
        if (!u) return J({ error: 'Sesión vencida' }, 401);
        const b = await db.prepare(balanceSql).bind(u.id).first();
        const { results } = await db.prepare(
          'SELECT delta,reason,note,created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 15').bind(u.id).all();
        return J({ id: u.id, name: u.name, chips: b.b, moves: results });
      }

      const tr = await handleTorneos(req, env, p, m, { J, authUser: r => authUser(r, db), isAdmin: r => isAdmin(r, env), bump });
      if (tr) return tr;
      const qrr = await handleQr(req, env, p, m, { J, authUser: r => authUser(r, db), isAdmin: r => isAdmin(r, env), bump });
      if (qrr) return qrr;
      const btr = await handleBets(req, env, p, m, { J, authUser: r => authUser(r, db), isAdmin: r => isAdmin(r, env), bump });
      if (btr) return btr;
      const phr = await handlePhotos(req, env, p, m, { J, authUser: r => authUser(r, db), isAdmin: r => isAdmin(r, env), bump });
      if (phr) return phr;

      // ---------- admin ----------
      if (p.startsWith('/api/admin/')) {
        if (!isAdmin(req, env)) return J({ error: 'Contraseña incorrecta' }, 403);

        if (p === '/api/admin/ping') return J({ ok: true });

        if (p === '/api/admin/users' && m === 'GET') {
          const { results } = await db.prepare(
            `SELECT u.id,u.name,u.has_phone,COALESCE(SUM(l.delta),0) AS chips,
                    (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id) AS entered
             FROM users u LEFT JOIN ledger l ON l.user_id=u.id GROUP BY u.id ORDER BY u.name`).all();
          return J(results);
        }

        // Importar lista de nombres: crea usuarios con PIN y fichas iniciales.
        if (p === '/api/admin/users' && m === 'POST') {
          const { names } = await req.json();
          const init = Number((await db.prepare("SELECT value FROM config WHERE key='initial_chips'").first()).value);
          const out = [];
          for (const raw of names) {
            const name = String(raw).trim();
            if (!name) continue;
            const pin = newPin();
            const ph = await hashPin(pin);
            try {
              const r = await db.prepare('INSERT INTO users(name,pin_hash) VALUES(?,?)').bind(name, ph).run();
              await db.prepare("INSERT INTO ledger(user_id,delta,reason,note) VALUES(?,?, 'initial','Fichas iniciales')")
                .bind(r.meta.last_row_id, init).run();
              out.push({ id: r.meta.last_row_id, name, pin });
            } catch (e) { out.push({ name, error: 'ya existe' }); }
          }
          await bump(db).run();
          return J(out);
        }

        let mm;
        if ((mm = p.match(/^\/api\/admin\/users\/(\d+)\/resetpin$/)) && m === 'POST') {
          const pin = newPin();
          await db.prepare('UPDATE users SET pin_hash=? WHERE id=?').bind(await hashPin(pin), mm[1]).run();
          await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(mm[1]).run();
          return J({ pin });
        }
        if ((mm = p.match(/^\/api\/admin\/users\/(\d+)\/phone$/)) && m === 'POST') {
          const { has_phone } = await req.json();
          await db.prepare('UPDATE users SET has_phone=? WHERE id=?').bind(has_phone ? 1 : 0, mm[1]).run();
          return J({ ok: true });
        }

        // Ajuste manual: siempre es una fila nueva con nota.
        if (p === '/api/admin/adjust' && m === 'POST') {
          const { user_id, delta, note } = await req.json();
          const d = parseInt(delta, 10);
          if (!d) return J({ error: 'Cantidad inválida' }, 400);
          await db.batch([
            db.prepare("INSERT INTO ledger(user_id,delta,reason,note) VALUES(?,?, 'admin',?)")
              .bind(user_id, d, note || 'Ajuste del admin'),
            bump(db)]);
          return J({ ok: true });
        }

        if (p === '/api/admin/config' && m === 'GET') {
          const { results } = await db.prepare('SELECT key,value FROM config').all();
          return J(Object.fromEntries(results.map(r => [r.key, r.value])));
        }
        if (p === '/api/admin/config' && m === 'POST') {
          const body = await req.json();
          const stmts = Object.entries(body).filter(([k]) => k !== 'data_version')
            .map(([k, v]) => db.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
              .bind(k, String(v)));
          await db.batch([...stmts, bump(db)]);
          return J({ ok: true });
        }

        // Reinicio total (solo para desarrollo): borra todo y deja la config por defecto.
        if (p === '/api/admin/reset' && m === 'POST') {
          const { confirm } = await req.json();
          if (confirm !== 'BORRAR') return J({ error: 'Falta la confirmación' }, 400);
          await db.batch([
            ...['photo_votes', 'photos', 'photo_challenges', 'bets', 'ledger', 'matches', 'tournament_players', 'tournaments', 'qr_codes',
              'sessions', 'login_attempts', 'users'].map(t => db.prepare(`DELETE FROM ${t}`)),
            bump(db)]);                       // la configuración se conserva
          return J({ ok: true });
        }
        if (p === '/api/admin/reset_config' && m === 'POST') {
          await db.batch([...Object.entries(DEFAULT_CFG).map(([k, v]) =>
            db.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, String(v))), bump(db)]);
          return J({ ok: true });
        }

        // Exportación completa (respaldo)
        if (p === '/api/admin/export') {
          const out = {};
          for (const t of ['users', 'ledger', 'tournaments', 'tournament_players', 'matches', 'qr_codes', 'bets', 'config']) {
            const q = t === 'users' ? 'SELECT id,name,has_phone,created_at FROM users' : `SELECT * FROM ${t}`;
            out[t] = (await db.prepare(q).all()).results;
          }
          return J(out);
        }
      }
      return J({ error: 'No encontrado' }, 404);
    } catch (e) {
      console.error(e);
      return J({ error: 'Error del servidor: ' + (e && e.message) }, 500);
    }
  }
};

export default worker;
