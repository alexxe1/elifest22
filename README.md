# ELIFEST 22 🎉

Sistema digital para una fiesta de ~26 personas: fichas, ranking en vivo, torneos con brackets y apuestas,
búsqueda del tesoro con QRs y foto-retos con votación. Pensado para usarse **una sola noche** desde los celulares
de los invitados, con pantalla de TV y una PC "kiosco" junto a la Xbox.

Corre en **Cloudflare Workers + D1 (SQLite)**. Frontend en HTML y JavaScript puro, sin build ni frameworks.

## Qué incluye
- **Fichas y ranking** con libro mayor (el saldo es siempre la suma de movimientos, nunca un campo editable).
- **Torneos** de eliminación directa con sorteo en vivo: FC 26, tenis de mesa y piedra, papel o tijera. Resultado cargado por un
  jugador y confirmado por el rival (o resuelto por el admin). Bonus de campeón, subcampeón y semifinalistas.
- **Apuestas** por el ganador del partido en turno: ventana con cuenta regresiva y pozo compartido (el multiplicador sale
  de cuánta gente apostó a cada lado).
- **Búsqueda del tesoro**: QRs de 4 categorías, uno por persona, reclamables escaneando o escribiendo un código corto.
- **Foto-retos**: misión al azar, subida de fotos, votación anónima y premio a la más votada.
- **Pantallas**: celu (`/`), TV (`/tv`), kiosco (`/kiosk`) y panel admin (`/admin`).

## Estructura
```
wrangler.toml        configuración del Worker (nombre, D1, carpeta de archivos estáticos)
schema.sql           base de datos completa (instalación nueva)
migracion3..6.sql    SOLO para bases creadas con versiones viejas (ver más abajo)
src/                 backend (Worker): index, torneos, bets, qr, photos
public/              frontend: index, admin, tv, kiosk, claim + ui.css/ui.js/session.js/teams.js/qrcode.js
public/logos/        logos de equipos (opcional, ver LEEME.txt)
loadtest.mjs         prueba de carga y de concurrencia
ENSAYO.md            checklist de pruebas y del día del evento
LEVEL3.md            diseño de las apuestas
```

## Instalación (primera vez)
Requisitos: Node.js y una cuenta gratuita de Cloudflare.

```bash
npx wrangler login
npx wrangler d1 create cumple            # copiá el database_id a wrangler.toml
npx wrangler d1 execute cumple --remote --file=schema.sql
npx wrangler secret put ADMIN_PASSWORD   # la contraseña del admin (no se guarda en el código)
npx wrangler deploy
```

Después abrí `https://TU-SITIO.workers.dev/admin`, importá la lista de invitados (un nombre por línea) e imprimí las tarjetas con el PIN.

> `schema.sql` ya incluye todo. Las `migracion*.sql` **no** se corren en una instalación nueva.

## Actualizar una base existente
Si venías de una versión vieja, corré en orden lo que te falte:
```bash
npx wrangler d1 execute cumple --remote --file=migracion3.sql   # apuestas
npx wrangler d1 execute cumple --remote --file=migracion4.sql   # espera antes de apostar
npx wrangler d1 execute cumple --remote --file=migracion5.sql   # foto-retos
npx wrangler d1 execute cumple --remote --file=migracion6.sql   # bonus, fichas por juego, dispositivos por PIN
npx wrangler deploy
```

## Configuración
Casi todos los valores se cambian en vivo desde `/admin` → *Configuración*: fichas iniciales y por jugar/ganar,
bonus de podio, duración y espera de las apuestas, premios de los foto-retos, dispositivos por PIN, etc.
Las misiones de los foto-retos están en `src/photos.js`. Los equipos de FC 26, en `public/teams.js`.

**Logos de equipos (opcional):** copiá los PNG en `public/logos/` con los nombres de `public/logos/LEEME.txt` y poné
`USE_LOGOS = true` en `public/teams.js`. Sin logos se muestra una insignia con los colores del club.

## Desarrollo y pruebas
```bash
npx wrangler dev                          # servidor local con base local
npx wrangler d1 execute cumple --local --file=schema.sql
node loadtest.mjs                         # ver instrucciones al inicio del archivo (30 clientes + carreras)
```
La lista de pruebas para el ensayo está en `ENSAYO.md`.

## Seguridad y privacidad
- La contraseña del admin vive solo como secreto de Cloudflare (`wrangler secret`), nunca en el código.
- PINs y sesiones se guardan hasheados. El PIN sirve para un máximo de dispositivos configurable (3 por defecto).
- Los datos de la fiesta (nombres, PINs, fotos) están en la base de datos, no en el repositorio.
  **No subas** exportaciones del admin ni capturas de las tarjetas.
- El botón *Reiniciar toda la base* del admin es solo para pruebas; conviene quitarlo antes del evento.

## Límites conocidos
Pensado para ~26 personas y una sola noche. Torneos de hasta 16 jugadores. Sin recuperación automática de PINs perdidos
(se resetean desde el admin). Las fotos viven en la base de datos y no entran en el respaldo JSON.
