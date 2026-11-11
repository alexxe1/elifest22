// Guarda la sesión en 3 lugares (localStorage, sessionStorage y cookie) para que no se pierda
// si el navegador bloquea alguno. Como el PIN es de un solo uso, perder la sesión obliga a pedir un PIN nuevo.
var Sess = {
  get: function () {
    var t = null;
    try { t = localStorage.getItem('tk'); } catch (e) {}
    if (!t) { try { t = sessionStorage.getItem('tk'); } catch (e) {} }
    if (!t) { var m = document.cookie.match(/(?:^|; )tk=([^;]+)/); t = m ? m[1] : null; }
    return t;
  },
  set: function (t) {
    try { localStorage.setItem('tk', t); } catch (e) {}
    try { sessionStorage.setItem('tk', t); } catch (e) {}
    try { document.cookie = 'tk=' + t + '; max-age=259200; path=/; SameSite=Lax'; } catch (e) {}
    return Sess.get() === t;     // false si el navegador no dejó guardar nada
  },
  clear: function () {
    try { localStorage.removeItem('tk'); } catch (e) {}
    try { sessionStorage.removeItem('tk'); } catch (e) {}
    try { document.cookie = 'tk=; max-age=0; path=/'; } catch (e) {}
  }
};
var SESS_WARN = 'Ojo: tu navegador no deja guardar la sesión. No cierres ni recargues esta pestaña, o vas a necesitar un PIN nuevo.';
