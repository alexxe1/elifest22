// Nivel 3: apuestas por el ganador del partido en turno.
// Pozo compartido: pozo = apuestas + bote base; multiplicador del lado = pozo / fichas de ese lado (con tope).

const CFG = async db =>
  Object.fromEntries((await db.prepare('SELECT key,value FROM config').all()).results.map(r => [r.key, r.value]));

// Partido en turno: el primer 'open' con los dos jugadores definidos (el mismo criterio que torneos.js).
const CUR_SQL = `SELECT m.*, t.name AS tname,
  (m.bets_open=1 AND m.bets_close_at > datetime('now')) AS betting,
  CASE WHEN m.bets_open=1 THEN CAST(MAX(0,(julianday(m.bets_close_at)-julianday('now'))*86400) AS INTEGER) END AS secs_left,
  CASE WHEN m.bets_open=2 THEN CAST(MAX(0,(julianday(m.bets_close_at)-julianday('now'))*86400) AS INTEGER) END AS starts_in,
  (m.bets_open=2 AND m.bets_close_at <= datetime('now')) AS due
  FROM matches m JOIN tournaments t ON t.id=m.tournament_id
  WHERE m.player_a IS NOT NULL AND m.player_b IS NOT NULL
    AND (m.status='open' OR (m.status IN ('reported','disputed') AND COALESCE((SELECT value FROM config WHERE key='wait_confirm'),'1')!='0'))
  ORDER BY m.tournament_id,m.round,m.slot LIMIT 1`;

// Ciclo de cada partido en turno (sin tarea programada: se avanza en cada consulta de /api/version):
//   bets_open=0 (nunca programado) -> 2 (cooldown: bets_close_at = hora de apertura) -> 1 (ventana abierta: bets_close_at = cierre)
// Así los jugadores tienen unos segundos para llegar antes de que se abran las apuestas.
export async function ensureBetting(db, bump) {
  try {
    const cur = await db.prepare(CUR_SQL).first();
    if (!cur) return;
    const c = await CFG(db);
    const win = Math.max(10, parseInt(c.bet_window_secs, 10) || 90);
    const cool = c.bet_cooldown_secs == null ? 45 : Math.max(0, parseInt(c.bet_cooldown_secs, 10) || 0);
    const openNow = () => db.batch([
      db.prepare("UPDATE matches SET bets_open=1,bets_close_at=datetime('now',?) WHERE id=? AND (bets_open=2 OR bets_close_at IS NULL)")
        .bind('+' + win + ' seconds', cur.id), bump(db)]);
    if (cur.status === 'open' && cur.bets_close_at == null && cur.bets_open === 0) {
      if (cool > 0)
        await db.batch([
          db.prepare("UPDATE matches SET bets_open=2,bets_close_at=datetime('now',?) WHERE id=? AND bets_close_at IS NULL")
            .bind('+' + cool + ' seconds', cur.id), bump(db)]);
      else await openNow();
    } else if (cur.due) await openNow();
  } catch (e) { /* si falta la migración, las apuestas quedan apagadas pero el resto anda */ }
}

const ledgerIns = db => db.prepare(
  "INSERT OR IGNORE INTO ledger(user_id,delta,reason,ref_type,ref_id,note) VALUES(?,?,?,'bet',?,?)");

// Devuelve las sentencias que pagan (o devuelven) las apuestas de un partido. Se ejecutan dentro del batch de finalize().
export async function settleStatements(db, matchId, winnerId) {
  const bets = (await db.prepare("SELECT * FROM bets WHERE match_id=? AND status='open'").bind(matchId).all()).results;
  const close = db.prepare("UPDATE matches SET bets_open=0 WHERE id=?").bind(matchId);
  if (!bets.length) return [close];
  const c = await CFG(db), seed = Math.max(0, parseInt(c.bet_seed, 10) || 0), cap = Number(c.bet_mult_cap) || 6;
  const sum = l => l.reduce((s, b) => s + b.amount, 0);
  const winners = bets.filter(b => b.pick === winnerId), pot = sum(bets) + seed, st = [close];
  if (!winners.length) {                       // nadie le apostó al ganador: se devuelve todo
    bets.forEach(b => st.push(
      ledgerIns(db).bind(b.user_id, b.amount, 'bet_refund', b.id, 'Apuesta devuelta'),
      db.prepare("UPDATE bets SET status='refunded',payout=? WHERE id=?").bind(b.amount, b.id)));
    return st;
  }
  const mult = Math.min(pot / sum(winners), cap);
  bets.forEach(b => {
    if (b.pick === winnerId) {
      const pay = Math.floor(b.amount * mult);
      st.push(ledgerIns(db).bind(b.user_id, pay, 'bet_payout', b.id, 'Apuesta ganada x' + mult.toFixed(2)),
        db.prepare("UPDATE bets SET status='won',payout=? WHERE id=?").bind(pay, b.id));
    } else st.push(db.prepare("UPDATE bets SET status='lost',payout=0 WHERE id=?").bind(b.id));
  });
  return st;
}

async function state(db, uid) {
  const cur = await db.prepare(CUR_SQL).first();
  if (!cur) return { match: null };
  const c = await CFG(db), seed = Math.max(0, parseInt(c.bet_seed, 10) || 0), cap = Number(c.bet_mult_cap) || 6;
  const ps = (await db.prepare(
    'SELECT u.id,u.name,tp.team FROM users u LEFT JOIN tournament_players tp ON tp.user_id=u.id AND tp.tournament_id=? WHERE u.id IN (?,?)')
    .bind(cur.tournament_id, cur.player_a, cur.player_b).all()).results;
  const sums = (await db.prepare('SELECT pick,SUM(amount) s,COUNT(*) n FROM bets WHERE match_id=? GROUP BY pick').bind(cur.id).all()).results;
  const get = id => sums.find(x => x.pick === id) || { s: 0, n: 0 };
  const total = get(cur.player_a).s + get(cur.player_b).s + seed;
  const side = id => {
    const x = get(id), p = ps.find(q => q.id === id) || {};
    return { id, name: p.name, team: p.team, chips: x.s, bettors: x.n, mult: x.s > 0 ? Math.min(total / x.s, cap) : null };
  };
  const out = {
    match: { id: cur.id, status: cur.status, tournament: cur.tname, a: side(cur.player_a), b: side(cur.player_b) },
    betting: !!cur.betting, secs_left: cur.secs_left || 0, cooldown: cur.bets_open === 2, starts_in: cur.starts_in || 0, pot: total, seed, my_bet: null, max_bet: 0, is_player: false
  };
  if (uid) {
    out.is_player = uid === cur.player_a || uid === cur.player_b;
    out.my_bet = (await db.prepare('SELECT pick,amount FROM bets WHERE user_id=? AND match_id=?').bind(uid, cur.id).first()) || null;
    const bal = (await db.prepare('SELECT COALESCE(SUM(delta),0) b FROM ledger WHERE user_id=?').bind(uid).first()).b;
    const abs = parseInt(c.bet_max_abs, 10) || 10, pct = parseInt(c.bet_max_pct, 10) || 50;
    out.max_bet = bal < 1 ? 0 : Math.min(bal, abs, Math.max(1, Math.floor(bal * pct / 100)));
  }
  return out;
}

export async function handleBets(req, env, p, m, H) {
  const db = env.DB, J = H.J;
  let mm;
  if (p === '/api/bets/current' && m === 'GET') {
    try {
      const u = (req.headers.get('authorization') || '') ? await H.authUser(req, db) : null;
      return J(await state(db, u ? u.id : null));
    } catch (e) { return J({ match: null }); }
  }

  if (p === '/api/bets' && m === 'POST') {
    const u = await H.authUser(req, db);
    if (!u) return J({ error: 'Sesión vencida' }, 401);
    const b = await req.json(), amt = parseInt(b.amount, 10), pick = Number(b.pick);
    const st = await state(db, u.id);
    if (!st.match || st.match.id !== Number(b.match_id)) return J({ error: 'Ese partido no está abierto para apostar' }, 409);
    if (!st.betting) return J({ error: 'Se cerró el tiempo para apostar' }, 409);
    if (st.is_player) return J({ error: 'No podés apostar en tu propio partido' }, 403);
    if (st.my_bet) return J({ error: 'Ya apostaste en este partido' }, 409);
    if (pick !== st.match.a.id && pick !== st.match.b.id) return J({ error: 'Elegí a uno de los dos jugadores' }, 400);
    if (!(amt >= 1) || amt > st.max_bet) return J({ error: 'Podés apostar de 1 a ' + st.max_bet + ' fichas' }, 400);
    try {
      // Atómico: la apuesta solo se crea si hay saldo, la ventana sigue abierta y no sos del partido.
      const r = await db.batch([
        db.prepare(`INSERT INTO bets(user_id,match_id,pick,amount)
          SELECT ?,?,?,? WHERE ? >= 1
          AND (SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=?) >= ?
          AND EXISTS (SELECT 1 FROM matches WHERE id=? AND status='open' AND bets_open=1 AND bets_close_at > datetime('now')
                      AND ? NOT IN (player_a,player_b) AND ? IN (player_a,player_b))`)
          .bind(u.id, st.match.id, pick, amt, amt, u.id, amt, st.match.id, u.id, pick),
        db.prepare(`INSERT INTO ledger(user_id,delta,reason,ref_type,ref_id,note)
          SELECT user_id,-amount,'bet_stake','bet',id,'Apuesta' FROM bets WHERE user_id=? AND match_id=?
          AND NOT EXISTS (SELECT 1 FROM ledger WHERE reason='bet_stake' AND ref_type='bet' AND ref_id=bets.id)`)
          .bind(u.id, st.match.id),
        H.bump(db)]);
      if (!r[0].meta.changes) return J({ error: 'No se pudo apostar: se cerró el tiempo o no te alcanzan las fichas' }, 409);
    } catch (e) { return J({ error: 'Ya apostaste en este partido' }, 409); }   // choque con UNIQUE(user_id, match_id)
    return J({ ok: true });
  }

  // Admin: cerrar ya / reabrir / anular (devuelve todas las apuestas)
  if ((mm = p.match(/^\/api\/admin\/matches\/(\d+)\/bets$/)) && m === 'POST') {
    if (!H.isAdmin(req, env)) return J({ error: 'Contraseña incorrecta' }, 403);
    const { action, secs } = await req.json(), id = Number(mm[1]);
    if (action === 'close')
      await db.batch([db.prepare("UPDATE matches SET bets_open=1,bets_close_at=datetime('now','-1 seconds') WHERE id=?").bind(id), H.bump(db)]);
    else if (action === 'open')
      await db.batch([db.prepare("UPDATE matches SET bets_open=1,bets_close_at=datetime('now',?) WHERE id=? AND status='open'")
        .bind('+' + (parseInt(secs, 10) || 90) + ' seconds', id), H.bump(db)]);
    else if (action === 'void') {
      const bets = (await db.prepare("SELECT * FROM bets WHERE match_id=? AND status='open'").bind(id).all()).results;
      await db.batch([
        ...bets.flatMap(b => [ledgerIns(db).bind(b.user_id, b.amount, 'bet_refund', b.id, 'Apuesta anulada'),
          db.prepare("UPDATE bets SET status='refunded',payout=? WHERE id=?").bind(b.amount, b.id)]),
        db.prepare("UPDATE matches SET bets_open=1,bets_close_at=datetime('now','-1 seconds') WHERE id=?").bind(id),
        H.bump(db)]);
    } else return J({ error: 'Acción inválida' }, 400);
    return J({ ok: true });
  }
  return null;
}
