// Generador de QR mínimo y local (modo byte, corrección M, versiones 1-10).
// Uso: qrMatrix("texto") -> array de filas de booleanos | qrSvg("texto", 4) -> string SVG
var qrMatrix = (function () {
  var ECC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];  // codewords ECC por bloque (M), v1..10
  var BLK = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];             // cantidad de bloques (M)

  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function divisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = mul(root, 2);
    }
    return r;
  }
  function remainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }
  function bit(x, i) { return ((x >>> i) & 1) !== 0; }

  return function (text) {
    var bytes = unescape(encodeURIComponent(text)).split('').map(function (c) { return c.charCodeAt(0); });
    var ver, cap;
    for (ver = 1; ver <= 10; ver++) {
      cap = Math.floor(rawModules(ver) / 8) - ECC[ver - 1] * BLK[ver - 1];
      if (bytes.length + 2 <= cap) break;
    }
    if (ver > 10) throw new Error('Texto demasiado largo');

    // Datos: modo byte (0100) + largo + bytes + terminador + relleno
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    for (var t = 0; t < 4 && bits.length < cap * 8; t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var by = 0; for (var k = 0; k < 8; k++) by = (by << 1) | bits[i + k]; data.push(by);
    }
    for (var pad = 0xEC; data.length < cap; pad ^= 0xEC ^ 0x11) data.push(pad);

    // ECC e intercalado
    var nb = BLK[ver - 1], el = ECC[ver - 1], raw = Math.floor(rawModules(ver) / 8);
    var ns = nb - raw % nb, sl = Math.floor(raw / nb), div = divisor(el), blocks = [];
    for (i = 0, k = 0; i < nb; i++) {
      var dat = data.slice(k, k + sl - el + (i < ns ? 0 : 1)); k += dat.length;
      var ec = remainder(dat, div);
      if (i < ns) dat.push(0);
      blocks.push(dat.concat(ec));
    }
    var all = [];
    for (i = 0; i < blocks[0].length; i++)
      blocks.forEach(function (b, j) { if (i !== sl - el || j >= ns) all.push(b[i]); });

    // Matriz
    var size = ver * 4 + 17, mod = [], fn = [];
    for (i = 0; i < size; i++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(x, y, d) { if (x >= 0 && x < size && y >= 0 && y < size) { mod[y][x] = d; fn[y][x] = true; } }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    function finder(x, y) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)); setF(x + dx, y + dy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var pos = [];
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      pos = [6]; for (var p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
      pos.forEach(function (a, ia) { pos.forEach(function (b, ib) {
        if ((ia === 0 && ib === 0) || (ia === 0 && ib === na - 1) || (ia === na - 1 && ib === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
          setF(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }); });
    }
    function fmt(mask) {
      var d = (0 << 3) | mask, r = d;      // nivel M = 0
      for (var j = 0; j < 10; j++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var b = ((d << 10) | r) ^ 0x5412, j;
      for (j = 0; j <= 5; j++) setF(8, j, bit(b, j));
      setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
      for (j = 9; j < 15; j++) setF(14 - j, 8, bit(b, j));
      for (j = 0; j < 8; j++) setF(size - 1 - j, 8, bit(b, j));
      for (j = 8; j < 15; j++) setF(8, size - 15 + j, bit(b, j));
      setF(8, size - 8, true);
    }
    fmt(0);
    if (ver >= 7) {
      var r = ver; for (i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vb = (ver << 12) | r;
      for (i = 0; i < 18; i++) { var c = bit(vb, i), a = size - 11 + i % 3, b2 = Math.floor(i / 3); setF(a, b2, c); setF(b2, a, c); }
    }
    // Codewords en zigzag
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j2 = 0; j2 < 2; j2++) {
        var x = right - j2, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && idx < all.length * 8) { mod[y][x] = bit(all[idx >>> 3], 7 - (idx & 7)); idx++; }
      }
    }
    function mask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) mod[y][x] = !mod[y][x];
      }
    }
    function penalty() {   // simplificado: rachas largas, bloques 2x2 y proporción de oscuros
      var s = 0, dark = 0, y, x, run, i2;
      for (y = 0; y < size; y++) for (var dir = 0; dir < 2; dir++) {
        run = 1;
        for (x = 1; x < size; x++) {
          var cur = dir ? mod[x][y] : mod[y][x], prev = dir ? mod[x - 1][y] : mod[y][x - 1];
          if (cur === prev) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1;
        }
      }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (x && y && mod[y][x] === mod[y][x - 1] && mod[y][x] === mod[y - 1][x] && mod[y][x] === mod[y - 1][x - 1]) s += 3;
      }
      return s + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    }
    var best = 0, bs = 1e9;
    for (var m = 0; m < 8; m++) {
      fmt(m); mask(m); var sc = penalty(); mask(m);
      if (sc < bs) { bs = sc; best = m; }
    }
    fmt(best); mask(best);
    return mod;
  };
})();

function qrSvg(text, px) {
  var m = qrMatrix(text), n = m.length, q = 4, d = '';
  for (var y = 0; y < n; y++) for (var x = 0; x < n; x++)
    if (m[y][x]) d += 'M' + (x + q) + ',' + (y + q) + 'h1v1h-1z';
  var s = n + q * 2;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" width="' + (px || 160) + '" height="' + (px || 160) +
    '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
if (typeof module !== 'undefined') module.exports = { qrMatrix: qrMatrix, qrSvg: qrSvg };
