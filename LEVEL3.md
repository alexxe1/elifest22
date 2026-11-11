# LEVEL3.md: apuestas por el ganador (diseño, sin implementar)

## 1. Idea en una línea
Cada partido tiene una **ventana corta para apostar**. Todas las fichas apostadas forman un **pozo**, y quienes aciertan se lo reparten. Como el pozo es compartido, **el multiplicador sale solo de cuánta gente apostó a cada lado**: al que menos fe le tienen le paga más (x3, x5…) y al favorito le paga poco (x1.2). No hace falta inventar cuotas.

## 2. Reglas

| Regla | Valor por defecto (editable en config) |
|---|---|
| Se apuesta por el ganador de un partido **ajeno** | los jugadores del partido no pueden apostar |
| Una apuesta por persona y partido, sin cambiarla | `UNIQUE(user_id, match_id)` ya existe |
| Ventana de apuestas | `bet_window_secs` = 90 |
| Monto mínimo | 1 ficha |
| Monto máximo por apuesta | `min(saldo, bet_max_abs, bet_max_pct % del saldo)` = min(saldo, 10, 50 %) |
| Bote base de la casa | `bet_seed` = 4 fichas por partido |
| Tope del multiplicador | `bet_mult_cap` = x6 |
| Sin celu | no apuesta, sin nada especial |

**Flujo de un partido:**
1. Cuando un partido pasa a ser el partido en turno, primero hay una **espera de 45 s** (`bet_cooldown_secs`, para que los jugadores lleguen) y después **las apuestas se abren solas** (no hace falta que el admin esté presente). El admin solo puede cerrar antes, reabrir o anular.
2. Cuenta regresiva en celus y TV. Se ve el reparto de fichas por lado y el multiplicador actual de cada uno.
3. Pasada la ventana (o si el admin toca **Cerrar ya**), se cierran las apuestas y el partido pasa a `playing`. **Mientras las apuestas están abiertas no se puede cargar el resultado.** Así nadie apuesta sabiendo quién ganó.
4. Se juega, se confirma el resultado, y en la misma operación se pagan las apuestas.

## 3. Cómo se calcula el pago (pozo compartido)

```
pozo        = fichas apostadas por todos + bote base
multiplicador del lado X = pozo / fichas apostadas al lado X     (tope x6)
pago de cada acertante   = floor(apuesta × multiplicador)
```

**Ejemplo.** Ana vs Beto. Apuestan 12 fichas a Ana (3 personas) y 4 a Beto (1 persona). Bote base: 4. Pozo: 20.
- Si gana Ana: x1.67. Quien puso 4 cobra 6 (ganancia +2).
- Si gana Beto: x5 → el que apostó 4 cobra 20 (ganancia +16). **Esa es la épica.**

**Casos borde:**
- Nadie apostó al ganador → se devuelven todas las apuestas (`bet_refund`) y el bote base desaparece. Si todos erraron juntos, nadie pierde.
- Todos apostaron al ganador → cobran poco más de lo apostado (reparten el bote base).
- Partido cancelado o anulado por el admin → devolución de todo.
- Los redondeos hacia abajo dejan sobrar como mucho 1 ficha por apuesta; no se reparte.

## 4. Por qué no se desbalancea
- **Zero-sum casi total.** Lo que ganan unos lo pierden otros. Lo único que entra de afuera es el bote base (4 fichas × unos 7 partidos ≈ 28 fichas en toda la noche, contra unas 500 en circulación).
- **Tope por apuesta** (10 fichas y 50 % del saldo): nadie se juega la noche en un partido, y el que va primero no puede aplastar a los demás.
- **Tope de multiplicador x6**: un solo apostador contra todos no se lleva un pozo gigante.
- **Una apuesta por partido y ventana corta**: no se puede apostar a ambos lados ni cubrirse.
- **Los jugadores no apuestan en su partido**, para que no se pueda arreglar un resultado. El admin puede anular cualquier apuesta o partido con devolución.
- **Los premios siguen dependiendo de jugar**: jugar y ganar siguen dando fichas, y las apuestas mueven pero no reemplazan eso.

## 5. Cambios al modelo (migración chica, sin perder datos)

```sql
ALTER TABLE matches ADD COLUMN bets_close_at TEXT;   -- 'YYYY-MM-DD HH:MM:SS' UTC
ALTER TABLE bets    ADD COLUMN payout INTEGER;
INSERT INTO config(key,value) VALUES
 ('bet_window_secs','90'),('bet_max_abs','10'),('bet_max_pct','50'),
 ('bet_seed','4'),('bet_mult_cap','6');
```
Se corre con `npx wrangler d1 execute cumple --remote --command "..."` o un `migracion3.sql`.

## 6. Endpoints

- `GET /api/bets/match/:id` → `{abierta, segundos_restantes, lado_a:{fichas,mult}, lado_b:{fichas,mult}, mi_apuesta, max_apuesta}`
- `POST /api/bets` `{match_id, pick, amount}`
- `POST /api/admin/matches/:id/bets/open` `{secs}` · `.../bets/close` · `.../bets/void`
- El pago se engancha en `finalize()` de `torneos.js`, dentro del mismo `db.batch`.

**El servidor es el único reloj.** Una apuesta vale solo si `bets_open = 1` y `bets_close_at > datetime('now')`. No hace falta tarea programada: el cierre se evalúa en cada consulta.

**Apuesta atómica** (dos sentencias en un `db.batch`; si una falla, no pasa nada):

```sql
INSERT INTO bets(user_id,match_id,pick,amount)
SELECT :u,:m,:pick,:amt
WHERE :amt >= 1
  AND (SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=:u) >= :amt
  AND EXISTS (SELECT 1 FROM matches WHERE id=:m AND bets_open=1
              AND bets_close_at > datetime('now')
              AND :u NOT IN (player_a,player_b) AND :pick IN (player_a,player_b));

INSERT INTO ledger(user_id,delta,reason,ref_type,ref_id,note)
SELECT user_id,-amount,'bet_stake','bet',id,'Apuesta'
FROM bets WHERE user_id=:u AND match_id=:m
  AND NOT EXISTS (SELECT 1 FROM ledger WHERE reason='bet_stake' AND ref_type='bet' AND ref_id=bets.id);
```

Si alguien toca dos veces seguidas, la segunda choca con `UNIQUE(user_id, match_id)` y no se descuenta nada. El saldo no puede quedar negativo porque se verifica en la misma sentencia que inserta.

**Pago:** por cada apuesta ganadora, una fila `bet_payout` (`ref_type='bet'`, `ref_id`=id de la apuesta), protegida por el índice único del libro mayor: si el pago se ejecuta dos veces, no se duplica.

## 7. Pantallas
- **Celu:** en el partido en turno, cuenta regresiva, dos botones grandes (uno por jugador) con su multiplicador actual, selector de monto con el máximo permitido, y «tu apuesta: 5 a Ana».
- **TV:** barras de fichas por lado, cuenta regresiva y etiqueta **🔥 Underdog** en el lado con menos fe. Si gana un multiplicador de x3 o más: cartel **¡SORPRESA!**.
- **Admin / kiosco:** botones Abrir apuestas, Cerrar ya y Anular.

## 8. Decisiones tomadas
1. Apertura **automática** al llegar el turno del partido. La PC del kiosco (`/kiosk`) muestra un cartel gigante con cronómetro mientras dura la ventana.
2. Bote base de la casa: **4 fichas** por partido.

**Estado: implementado.** Código en `src/bets.js`; migración para bases existentes en `migracion3.sql`.
