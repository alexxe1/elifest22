// Escudos de los equipos de FC 26. Si existe /logos/<slug>.png se usa el logo real;
// si no, se muestra una insignia con los colores del club y su sigla (ver logos/LEEME.txt).
// Poné true SOLO cuando hayas copiado los PNG en public/logos (ver logos/LEEME.txt). Con false no se pide ningún archivo extra.
var USE_LOGOS = true;
var TEAMS = [
  { s: 'napoli',     a: 'NAP', c: ['#12A0D7', '#ffffff'], n: ['Napoli', 'SSC Napoli'] },
  { s: 'leverkusen', a: 'LEV', c: ['#E32221', '#111111'], n: ['Bayer Leverkusen', 'Leverkusen'] },
  { s: 'arsenal',    a: 'ARS', c: ['#EF0107', '#ffffff'], n: ['Arsenal'] },
  { s: 'psg',        a: 'PSG', c: ['#004170', '#DA291C'], n: ['Paris Saint-Germain', 'PSG', 'Paris SG'] },
  { s: 'real-madrid',a: 'RMA', c: ['#ffffff', '#FEBE10'], n: ['Real Madrid'] },
  { s: 'barcelona',  a: 'BAR', c: ['#A50044', '#004D98'], n: ['Barcelona', 'FC Barcelona'] },
  { s: 'liverpool',  a: 'LIV', c: ['#C8102E', '#F6EB61'], n: ['Liverpool'] },
  { s: 'man-city',   a: 'MCI', c: ['#6CABDD', '#1C2C5B'], n: ['Manchester City', 'Man City'] },
  { s: 'bayern',     a: 'BAY', c: ['#DC052D', '#0066B2'], n: ['Bayern Munich', 'Bayern Múnich', 'Bayern'] },
  { s: 'atletico',   a: 'ATM', c: ['#CB3524', '#272E61'], n: ['Atletico Madrid', 'Atlético de Madrid', 'Atletico'] },
  { s: 'man-united', a: 'MUN', c: ['#DA291C', '#FBE122'], n: ['Manchester United', 'Man United', 'Man Utd'] },
  { s: 'chelsea',    a: 'CHE', c: ['#034694', '#ffffff'], n: ['Chelsea'] },
  { s: 'spurs',      a: 'TOT', c: ['#132257', '#ffffff'], n: ['Spurs', 'Tottenham', 'Tottenham Hotspur'] },
  { s: 'juventus', a: 'JUV', c: ['#000000', '#ffffff'], n: ['Juventus'] },
  { s: 'inter',    a: 'INT', c: ['#0068A8', '#000000'], n: ['Inter de Milán', 'Inter de Milan', 'Inter'] },
  { s: 'borussia', a: 'BVB', c: ['#FDE100', '#000000'], n: ['Borussia', 'Borussia Dortmund', 'Dortmund'] }
];
(function () {
  var norm = function (s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  };
  var idx = {};
  TEAMS.forEach(function (t) {
    t.n.forEach(function (n) { idx[norm(n)] = t; });
    if (USE_LOGOS) {                            // averigua una sola vez si hay logo real cargado
      var im = new Image();
      im.onload = function () { t.ok = true; };
      im.src = '/logos/' + t.s + '.png';
    }
  });
  window.teamIcon = function (name) {
    var t = idx[norm(name)];
    if (!t) return '';
    return '<span class="tm" style="--a:' + t.c[0] + ';--b:' + t.c[1] + '"><b>' + t.a + '</b>' +
      (t.ok ? '<img src="/logos/' + t.s + '.png" alt="">' : '') + '</span>';
  };
  window.teamTag = function (name) {
    var e = String(name).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    return teamIcon(name) + ' <small style="color:#9a9ab0">' + e + '</small>';
  };
  var st = document.createElement('style');
  st.textContent = '.tm{position:relative;display:inline-block;width:1.6em;height:1.6em;border-radius:50%;' +
    'background:linear-gradient(90deg,var(--a) 50%,var(--b) 50%);border:.08em solid rgba(255,255,255,.75);' +
    'vertical-align:-.45em;overflow:hidden}' +
    '.tm b{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:.46em;color:#fff;' +
    'text-shadow:0 0 .2em #000,0 0 .2em #000,0 0 .2em #000}' +
    '.tm img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#fff}';
  document.head.appendChild(st);
})();
