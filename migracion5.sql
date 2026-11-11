-- Migración 5: foto-retos. Correr UNA vez:
-- npx wrangler d1 execute cumple --remote --file=migracion5.sql
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
INSERT OR IGNORE INTO config(key,value) VALUES ('photo_secs','300'),('vote_secs','120'),('photo_prize','10'),('photo_part','2');
