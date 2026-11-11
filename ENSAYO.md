# Ensayo general (sábado) y checklist del domingo

## Antes (desde la compu)
- [ ] `npx wrangler deploy` con la versión final y las migraciones 3, 4, 5 y 6 ya corridas.
- [ ] `node loadtest.mjs` (ver el comentario de arriba del archivo): tiene que terminar en «todo bien».
- [ ] **Pedime que saque el botón «Reiniciar toda la base»** del admin y volvé a desplegar.
- [ ] Importar la lista real de invitados en `/admin` e **imprimir las tarjetas con PIN** (los PINs se ven una sola vez).
- [ ] Generar los QRs, anotar dónde va cada uno (columna de ubicación), imprimirlos y **escanear uno con un celu**.
- [ ] Búsqueda del tesoro **cerrada** hasta que empiece (se abre con el botón rojo).

## Ensayo con gente (sábado)
- [ ] 8 a 10 celus conectados a la vez, algunos con datos móviles y otros con WiFi.
- [ ] Torneo de prueba de 4 jugadores completo: sorteo (mirarlo en `/tv`), apuestas desde 2 celus, cargar resultado, confirmar, disputa y resolverla desde `/admin`.
- [ ] `/tv` en el proyector (F11 para pantalla completa) y `/kiosk` en la PC de la Xbox (habilitar la contraseña una vez).
- [ ] Probar el cartel de apuestas del kiosco y de la TV: ¿se ve y se lee desde lejos?
- [ ] **Interfaz en celus reales:** probar en un iPhone y en un Android viejo (las pruebas automáticas se hicieron en Chrome de PC simulando un celu). Mirar que los botones muestren el «cargando», que los avisos aparezcan y que, al cortar los datos, salga el cartel «Sin conexión».
- [ ] Si agregás logos reales de equipos, cambiar `USE_LOGOS` a `true` en `public/teams.js`.
- [ ] **PIN en varios dispositivos:** entrar con una tarjeta en Safari y en Chrome (tienen que andar los dos), probar el botón «Salir» y volver a entrar. Al 4º celu tiene que decir que ya se usó en 3 dispositivos. Probar el botón PIN del admin para dar uno nuevo.
- [ ] **QR dentro de la app:** con la búsqueda abierta aparece la pestaña 🔎 QR; reclamar escribiendo el código de 6 caracteres impreso debajo del QR (imprimí los QRs de nuevo desde este admin: el código sale ahí).
- [ ] **Bonus de podio:** jugar un torneo de 4 y mirar que campeón (+15), subcampeón (+8) y los dos perdedores de semifinal (+4) reciban sus fichas. Todos los valores se cambian en «Configuración» del admin.
- [ ] **Piedra, papel o tijera:** crear un torneo (hasta 16 jugadores), jugar un cruce, cargar 3-1 y confirmar. Ojo con los tiempos: cada partido tiene espera + apuestas; si va lento, bajá `bet_cooldown_secs` y `bet_window_secs` en la configuración.
- [ ] **Foto-retos:** lanzar uno desde el admin con 3 o 4 celus: subir fotos, esperar (o forzar con «Pasar a la siguiente fase»), votar, ver el resultado en `/tv` y que se acrediten las fichas. Probar también desde un celu con cámara.
- [ ] Probar un jugador **sin celu**: cargar su resultado desde el kiosco.
- [ ] Exportar el JSON del admin y guardarlo (es tu respaldo).

## El domingo
- [ ] Brackets impresos en papel y una planilla en blanco por si se cae internet. El sistema nunca es requisito para jugar.
- [ ] Cargadores y un cable de red/hotspot de respaldo para la PC del kiosco.
- [ ] Cada tanto, **exportar el JSON** desde el admin.
