-- Migración Nivel 3 (apuestas). Correr UNA sola vez sobre la base existente:
-- npx wrangler d1 execute cumple --remote --file=migracion3.sql
ALTER TABLE matches ADD COLUMN bets_close_at TEXT;
ALTER TABLE bets ADD COLUMN payout INTEGER;
INSERT OR IGNORE INTO config(key,value) VALUES
 ('bet_window_secs','90'),('bet_max_abs','10'),('bet_max_pct','50'),('bet_seed','4'),('bet_mult_cap','6');
