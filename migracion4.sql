-- Migración 4: agrega la espera antes de abrir las apuestas (segundos). Se puede correr más de una vez.
-- npx wrangler d1 execute cumple --remote --file=migracion4.sql
INSERT OR IGNORE INTO config(key,value) VALUES ('bet_cooldown_secs','45');
