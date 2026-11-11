-- Migración 6: claves nuevas de configuración. Se puede correr más de una vez.
-- npx wrangler d1 execute cumple --remote --file=migracion6.sql
INSERT OR IGNORE INTO config(key,value) VALUES
 ('ppt_chips_play','1'),('ppt_chips_win','2'),
 ('bonus_champion','15'),('bonus_runnerup','8'),('bonus_semi','4'),
 ('wait_confirm','1'),('max_sessions','3');
