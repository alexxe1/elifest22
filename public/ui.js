// Feedback de interfaz: barra de progreso, botones "cargando", avisos (toast) y vibración suave.
(function () {
  var bar, el, tt, pend = 0, lastBtn = null;
  function ensure() {
    if (bar) return;
    bar = document.createElement('div'); bar.id = 'bar'; document.body.appendChild(bar);
    el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el);
  }
  // Se recuerda qué botón tocó la persona. Si el handler lanza un pedido a la red, ese botón queda "cargando".
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button');
    lastBtn = (b && !b.disabled && !b.closest('.tabs')) ? b : null;
    setTimeout(function () { lastBtn = null; }, 0);
  }, true);
  window.UI = {
    begin: function () {                       // solo pedidos iniciados con un toque (no el polling de fondo)
      var b = lastBtn; lastBtn = null;
      if (!b) return null;
      ensure(); b.classList.add('busy'); b.disabled = true; pend++;
      bar.className = ''; void bar.offsetWidth; bar.className = 'on';
      return { b: b, d: false };
    },
    end: function (o) {
      if (!o || o.d) return; o.d = true;
      o.b.classList.remove('busy'); o.b.disabled = false;
      pend = Math.max(0, pend - 1);
      if (!pend) { bar.className = 'done'; setTimeout(function () { if (!pend) bar.className = ''; }, 600); }
    }
  };
  // Avisos en cola: se muestran de a uno, nunca se pisan entre sí.
  var q = [], showing = false;
  function next() {
    var t = q.shift();
    if (!t) { showing = false; return; }
    showing = true;
    el.textContent = t.msg; el.className = 'show ' + (t.type || '');
    try { if (navigator.vibrate) navigator.vibrate(t.type === 'err' ? [40, 40, 40] : t.type === 'ok' ? 25 : 0); } catch (e) {}
    setTimeout(function () { el.className = ''; setTimeout(next, 220); }, t.ms || 2200);
  }
  window.toast = function (msg, type, ms) {
    ensure();
    if (q.length && q[q.length - 1].msg === msg) return;      // sin repetidos seguidos
    if (q.length >= 3) q.shift();
    q.push({ msg: msg, type: type, ms: ms });
    if (!showing) next();
  };
})();
