CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  has_phone INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Intentos fallidos de login (límite: 5 cada 5 minutos por usuario)
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX login_attempts_user ON login_attempts(user_id, created_at);

CREATE TABLE ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL, -- initial | play | win | qr | admin | bet_stake | bet_payout | bet_refund
  ref_type TEXT,        -- match | qr | bet
  ref_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ledger_once ON ledger(user_id, reason, ref_type, ref_id)
  WHERE reason IN ('play','win','qr','bet_payout','bet_refund');

CREATE TABLE tournaments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  game TEXT NOT NULL,
  format TEXT NOT NULL,
  best_of INTEGER NOT NULL DEFAULT 1,
  points_to_win INTEGER,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  seed INTEGER,
  team TEXT,
  group_name TEXT,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
  round INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  player_a INTEGER REFERENCES users(id),
  player_b INTEGER REFERENCES users(id),
  next_match_id INTEGER REFERENCES matches(id),
  next_slot TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  score_a INTEGER, score_b INTEGER,
  games_json TEXT,
  winner INTEGER REFERENCES users(id),
  reported_by INTEGER REFERENCES users(id),
  confirmed_by INTEGER REFERENCES users(id),
  bets_open INTEGER NOT NULL DEFAULT 0,
  bets_close_at TEXT                     -- Nivel 3: cierre de la ventana de apuestas (UTC)
);

CREATE TABLE qr_codes (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  hint TEXT,
  claimed_by INTEGER REFERENCES users(id),
  claimed_at TEXT
);
CREATE UNIQUE INDEX one_qr_per_user ON qr_codes(claimed_by) WHERE claimed_by IS NOT NULL;

CREATE TABLE bets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  match_id INTEGER NOT NULL REFERENCES matches(id),
  pick INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payout INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, match_id)
);

CREATE TABLE photo_challenges (
  id INTEGER PRIMARY KEY,
  mission TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'collecting', -- collecting | voting | finished | cancelled
  phase_ends_at TEXT,                         -- fin de la fase actual (UTC); al terminar = momento en que terminó
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES photo_challenges(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  data TEXT NOT NULL,                         -- JPEG en base64 (ya reducido en el celu)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (challenge_id, user_id)
);
CREATE TABLE photo_votes (
  challenge_id INTEGER NOT NULL REFERENCES photo_challenges(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  PRIMARY KEY (challenge_id, user_id)
);

CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO config(key,value) VALUES
 ('initial_chips','20'),('chips_play','2'),('chips_win','3'),
 ('qr_facil','3'),('qr_medio','6'),('qr_dificil','12'),('qr_extremo','30'),
 ('qr_hunt_open','0'),('data_version','1'),
 ('photo_secs','300'),('vote_secs','120'),('photo_prize','10'),('photo_part','2'),
 ('ppt_chips_play','1'),('ppt_chips_win','2'),('bonus_champion','15'),('bonus_runnerup','8'),('bonus_semi','4'),
 ('wait_confirm','1'),('max_sessions','3'),
 ('bet_window_secs','90'),('bet_cooldown_secs','45'),('bet_max_abs','10'),('bet_max_pct','50'),('bet_seed','4'),('bet_mult_cap','6');
