import { settleStatements } from './bets.js';
// Torneos (paso 2): sorteo, bracket de eliminación directa, reporte/confirmación, fichas.
const shuffle = a => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function validScore(sa, sb, bestOf) {
  if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0 || sa === sb) return 'Resultado inválido';
  if (bestOf > 1) {
    const need = Math.ceil(bestOf / 2);
    if (Math.max(sa, sb) !== need || Math.min(sa, sb) >= need)
      return 'En este torneo se gana con ' + need + ' games (ej: ' + need + '-1)';
  }
  return null;
}

// Pasa al ganador a la siguiente ronda (o cierra el torneo si era la final).
function advance(db, mt, win) {
  if (!mt.next_match_id)
    return [db.prepare("UPDATE tournaments SET status='finished' WHERE id=?").bind(mt.tournament_id)];
  const col = mt.next_slot === 'a' ? 'player_a' : 'player_b';
  return [
    db.prepare(`UPDATE matches SET ${col}=? WHERE id=?`).bind(win, mt.next_match_id),
    db.prepare("UPDATE matches SET status='open' WHERE id=? AND status='pending' AND player_a IS NOT NULL AND player_b IS NOT NULL")
      .bind(mt.next_match_id)
  ];
}

// Confirma el partido y acredita fichas. Idempotente: el índice único del libro mayor evita duplicados.
async function finalize(db, mt, sa, sb, by, H) {
  const rows = (await db.prepare('SELECT key,value FROM config').all()).results;
  const c = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const n = (k, d) => { const v = parseInt(c[k], 10); return Number.isFinite(v) ? v : d; };
  const ppt = mt.game === 'Piedra, papel o tijera';
  const play = ppt ? n('ppt_chips_play', 1) : n('chips_play', 2);
  const winChips = ppt ? n('ppt_chips_win', 2) : n('chips_win', 3);
  const win = sa > sb ? mt.player_a : mt.player_b;
  const lose = win === mt.player_a ? mt.player_b : mt.player_a;
  // Bonus de podio: campeón y subcampeón al cerrar la final; cada perdedor de semifinal (+4). Una sola vez por persona y torneo.
  const R = (await db.prepare('SELECT MAX(round) r FROM matches WHERE tournament_id=?').bind(mt.tournament_id).first()).r;
  const bonus = (u, d, note) => d > 0 ? db.prepare(
    "INSERT OR IGNORE INTO ledger(user_id,delta,reason,ref_type,ref_id,note) VALUES(?,?,'win','tournament',?,?)").bind(u, d, mt.tournament_id, note) : null;
  const podium = (!mt.next_match_id
    ? [bonus(win, n('bonus_champion', 15), '🏆 Bonus campeón'), bonus(lose, n('bonus_runnerup', 8), 'Bonus subcampeón')]
    : (R >= 2 && mt.round === R - 1 ? [bonus(lose, n('bonus_semi', 4), 'Bonus semifinalista')] : [])).filter(Boolean);
  const L = (u, d, r) => db.prepare(
    "INSERT OR IGNORE INTO ledger(user_id,delta,reason,ref_type,ref_id,note) VALUES(?,?,?,'match',?,?)")
    .bind(u, d, r, mt.id, r === 'win' ? 'Ganaste un partido' : 'Jugaste un partido');
  const betSt = await settleStatements(db, mt.id, win).catch(() => []);
  await db.batch([
    db.prepare("UPDATE matches SET status='confirmed',score_a=?,score_b=?,winner=?,confirmed_by=? WHERE id=?")
      .bind(sa, sb, win, by, mt.id),
    L(mt.player_a, play, 'play'),
    L(mt.player_b, play, 'play'),
    L(win, winChips, 'win'),
    ...podium,
    ...advance(db, mt, win),
    ...betSt,
    H.bump(db)
  ]);
}

async function createTournament(db, b, H) {
  const ids = shuffle((b.user_ids || []).map(Number));
  const n = ids.length;
  if (n < 2 || n > 16) return H.J({ error: 'Elegí entre 2 y 16 jugadores' }, 400);
  let teams = (b.teams || []).map(s => String(s).trim()).filter(Boolean);
  if (teams.length && teams.length < n) return H.J({ error: 'Faltan equipos: hay ' + teams.length + ' y son ' + n + ' jugadores' }, 400);
  teams = shuffle(teams);

  const t = await db.prepare(
    "INSERT INTO tournaments(name,game,format,best_of,points_to_win,status) VALUES(?,?,'single_elim',?,?,'running')")
    .bind(b.name, b.game, b.best_of || 1, b.points_to_win || null).run();
  const tid = t.meta.last_row_id;
  await db.batch(ids.map((u, i) =>
    db.prepare('INSERT INTO tournament_players(tournament_id,user_id,seed,team) VALUES(?,?,?,?)')
      .bind(tid, u, i + 1, teams[i] || null)));

  // Bracket: se crea de la final hacia atrás para conocer next_match_id.
  let size = 2; while (size < n) size *= 2;
  const R = Math.log2(size), byRound = {};
  let upper = [];
  for (let r = R; r >= 1; r--) {
    const cur = [];
    for (let s = 0; s < size / 2 ** r; s++) {
      const nx = r < R ? upper[Math.floor(s / 2)] : null;
      const res = await db.prepare(
        'INSERT INTO matches(tournament_id,round,slot,next_match_id,next_slot) VALUES(?,?,?,?,?)')
        .bind(tid, r, s, nx, nx ? (s % 2 ? 'b' : 'a') : null).run();
      cur.push(res.meta.last_row_id);
    }
    byRound[r] = cur; upper = cur;
  }
  // Primera ronda: 1 vs último, 2 vs anteúltimo... Si falta rival, pasa directo (bye).
  for (let s = 0; s < size / 2; s++) {
    const id = byRound[1][s], a = ids[s], bb = ids[size - 1 - s] ?? null;
    if (bb === null) {
      const mt = await db.prepare('SELECT * FROM matches WHERE id=?').bind(id).first();
      await db.batch([
        db.prepare("UPDATE matches SET player_a=?,status='confirmed',winner=? WHERE id=?").bind(a, a, id),
        ...advance(db, mt, a)]);
    } else {
      await db.prepare("UPDATE matches SET player_a=?,player_b=?,status='open' WHERE id=?").bind(a, bb, id).run();
    }
  }
  await H.bump(db).run();
  return H.J({ id: tid });
}

export async function handleTorneos(req, env, p, m, H) {
  const db = env.DB, J = H.J;
  let mm;

  // Público: todos los torneos con jugadores y partidos (lo usan el celu y la TV).
  if (p === '/api/tournaments' && m === 'GET') {
    const ts = (await db.prepare('SELECT * FROM tournaments ORDER BY id DESC').all()).results;
    const pl = (await db.prepare(
      'SELECT tp.tournament_id tid,u.id,u.name,tp.team FROM tournament_players tp JOIN users u ON u.id=tp.user_id').all()).results;
    const ms = (await db.prepare(
      'SELECT id,tournament_id tid,round,slot,player_a,player_b,status,score_a,score_b,winner,reported_by FROM matches ORDER BY tournament_id,round,slot').all()).results;
    // Se juega de a un partido (una sola Xbox): el actual es el primer 'open' en orden.
    // Con `wait_confirm` (por defecto sí) el siguiente partido espera a que se confirme (o se resuelva) el anterior.
    const wc = await db.prepare("SELECT value FROM config WHERE key='wait_confirm'").first();
    const waitConfirm = !wc || wc.value !== '0';
    const cur = ms.find(x => x.player_a && x.player_b && (x.status === 'open' || (waitConfirm && (x.status === 'reported' || x.status === 'disputed'))));
    return J(ts.map(t => ({
      ...t,
      current_match_id: cur ? cur.id : null,
      players: pl.filter(x => x.tid === t.id),
      matches: ms.filter(x => x.tid === t.id)
    })));
  }

  // Jugador: reportar o confirmar (confirmar = reportar el mismo resultado).
  if ((mm = p.match(/^\/api\/matches\/(\d+)\/report$/)) && m === 'POST') {
    const u = await H.authUser(req, db);
    if (!u) return J({ error: 'Sesión vencida' }, 401);
    const b = await req.json();
    const mt = await db.prepare(
      'SELECT m.*,t.best_of,t.game FROM matches m JOIN tournaments t ON t.id=m.tournament_id WHERE m.id=?').bind(mm[1]).first();
    if (!mt) return J({ error: 'Partido inexistente' }, 404);
    if (u.id !== mt.player_a && u.id !== mt.player_b) return J({ error: 'No sos parte de este partido' }, 403);
    if (!['open', 'playing', 'reported'].includes(mt.status)) return J({ error: 'Este partido ya no se puede cargar' }, 409);
    const sa = parseInt(b.score_a, 10), sb = parseInt(b.score_b, 10);
    const err = validScore(sa, sb, mt.best_of);
    if (err) return J({ error: err }, 400);

    // Primer reporte: solo el partido que está en juego ahora, y con las apuestas ya cerradas.
    if (mt.status === 'open' || mt.status === 'playing') {
      const bo = await db.prepare("SELECT 1 x FROM matches WHERE id=? AND bets_open IN (1,2) AND bets_close_at > datetime('now')").bind(mt.id).first().catch(() => null);
      if (bo) return J({ error: 'Todavía están las apuestas (o su cuenta regresiva). Esperá a que terminen para cargar el resultado.' }, 409);
      const cur = await db.prepare("SELECT id FROM matches WHERE player_a IS NOT NULL AND player_b IS NOT NULL AND (status='open' OR (status IN ('reported','disputed') AND COALESCE((SELECT value FROM config WHERE key='wait_confirm'),'1')!='0')) ORDER BY tournament_id,round,slot LIMIT 1").first();
      if (!cur || cur.id !== mt.id) return J({ error: 'Todavía no es tu turno: se juega de a un partido.' }, 409);
    }

    if (mt.status === 'reported' && mt.reported_by !== u.id) {
      if (mt.score_a === sa && mt.score_b === sb) {
        await finalize(db, mt, sa, sb, u.id, H);
        return J({ ok: true, state: 'confirmed' });
      }
      await db.batch([db.prepare("UPDATE matches SET status='disputed' WHERE id=?").bind(mt.id), H.bump(db)]);
      return J({ ok: true, state: 'disputed' });
    }
    await db.batch([
      db.prepare("UPDATE matches SET status='reported',score_a=?,score_b=?,reported_by=? WHERE id=?").bind(sa, sb, u.id, mt.id),
      H.bump(db)]);
    return J({ ok: true, state: 'reported' });
  }

  // Admin
  if (p.startsWith('/api/admin/tournaments') || p.match(/^\/api\/admin\/matches\//)) {
    if (!H.isAdmin(req, env)) return J({ error: 'Contraseña incorrecta' }, 403);
    if (p === '/api/admin/tournaments' && m === 'POST') return createTournament(db, await req.json(), H);

    // Eliminar un torneo (en curso o terminado): borra partidos y apuestas y REVIERTE las fichas que dio (jugar, ganar, bonus, apuestas).
    if ((mm = p.match(/^\/api\/admin\/tournaments\/(\d+)\/delete$/)) && m === 'POST') {
      const t = Number(mm[1]), M = '(SELECT id FROM matches WHERE tournament_id=?)';
      await db.batch([
        db.prepare(`DELETE FROM ledger WHERE (ref_type='match' AND ref_id IN ${M})
          OR (ref_type='bet' AND ref_id IN (SELECT id FROM bets WHERE match_id IN ${M}))
          OR (ref_type='tournament' AND ref_id=?)`).bind(t, t, t),
        db.prepare(`DELETE FROM bets WHERE match_id IN ${M}`).bind(t),
        db.prepare('UPDATE matches SET next_match_id=NULL WHERE tournament_id=?').bind(t),
        db.prepare('DELETE FROM matches WHERE tournament_id=?').bind(t),
        db.prepare('DELETE FROM tournament_players WHERE tournament_id=?').bind(t),
        db.prepare('DELETE FROM tournaments WHERE id=?').bind(t),
        H.bump(db)]);
      return J({ ok: true });
    }

    // Resolver a mano (disputas, jugadores sin celu, lo que sea)
    if ((mm = p.match(/^\/api\/admin\/matches\/(\d+)\/resolve$/)) && m === 'POST') {
      const b = await req.json();
      const mt = await db.prepare(
        'SELECT m.*,t.best_of,t.game FROM matches m JOIN tournaments t ON t.id=m.tournament_id WHERE m.id=?').bind(mm[1]).first();
      if (!mt || !mt.player_a || !mt.player_b) return J({ error: 'Partido no disponible' }, 400);
      if (mt.status === 'confirmed') return J({ error: 'Ya estaba confirmado' }, 409);
      const sa = parseInt(b.score_a, 10), sb = parseInt(b.score_b, 10);
      const err = validScore(sa, sb, mt.best_of);
      if (err) return J({ error: err }, 400);
      await finalize(db, mt, sa, sb, null, H);
      return J({ ok: true });
    }
  }
  return null;
}
