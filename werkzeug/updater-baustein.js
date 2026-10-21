// ============================================================
//  Updates – prüft einmal am Tag, ob es eine neue Version gibt, und installiert sie
//  (Standard) oder meldet sie. Quelle: github.com/Teyro/Scriptable-Updates – dort liegen
//  nur Versionsnummern und die Skripte; private Skripte verschlüsselt (ChaCha20), den
//  Schlüssel kennt nur dieses Skript. Vor dem Ersetzen wird geprüft, dass die Datei
//  vollständig und echt ist; die alte Fassung bleibt als Sicherung erhalten.
// ============================================================
const UPDATE_ID = "%%UPDATE_ID%%";
const UPDATE_SCHLUESSEL = "%%SCHLUESSEL%%"; // leer = öffentliches Skript, unverschlüsselt
const UPDATE_QUELLE = "https://raw.githubusercontent.com/Teyro/Scriptable-Updates/main/";
const UPDATE_DATEI = "scriptable-update-" + UPDATE_ID + ".json";

function updateStand() {
  const s = liesUpdateJSON() || {};
  return Object.assign({ modus: "auto", geprueft: 0, neu: null, gemeldet: "" }, s);
}
function liesUpdateJSON() {
  try {
    const f = FileManager.local();
    const p = f.joinPath(f.documentsDirectory(), UPDATE_DATEI);
    return f.fileExists(p) ? JSON.parse(f.readString(p)) : null;
  } catch (e) { return null; }
}
function schreibUpdateJSON(s) {
  try { const f = FileManager.local(); f.writeString(f.joinPath(f.documentsDirectory(), UPDATE_DATEI), JSON.stringify(s)); } catch (e) { /* egal */ }
}

/** "3.0.1" > "3.0"? */
function versionNeuer(a, b) {
  const x = String(a).split(".").map((n) => parseInt(n, 10) || 0), y = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

/** Fragt höchstens einmal am Tag (oder erzwungen) nach; liefert das Manifest einer neueren Version oder null. */
async function updatePruefen({ erzwingen = false } = {}) {
  const s = updateStand();
  if (s.modus === "aus" && !erzwingen) return null;
  if (!erzwingen && Date.now() - s.geprueft < 20 * 3600 * 1000) return s.neu && versionNeuer(s.neu.version, VERSION) ? s.neu : null;
  try {
    const r = new Request(UPDATE_QUELLE + encodeURIComponent(UPDATE_ID) + ".json?t=" + Math.floor(Date.now() / 3600000));
    r.timeoutInterval = 8;
    const m = await r.loadJSON();
    s.geprueft = Date.now();
    s.neu = m && m.version && versionNeuer(m.version, VERSION) ? m : null;
    schreibUpdateJSON(s);
    return s.neu;
  } catch (e) {
    return null; // offline o. Ä. – beim nächsten Mal
  }
}

/** Lädt, entschlüsselt und prüft die neue Fassung und ersetzt dieses Skript. Wirft bei Problemen. */
async function updateInstallieren(m) {
  const r = new Request(UPDATE_QUELLE + encodeURIComponent(m.datei) + "?v=" + encodeURIComponent(m.version));
  r.timeoutInterval = 20;
  let code;
  if (m.verschluesselt) {
    if (!UPDATE_SCHLUESSEL) throw new Error("Kein Schlüssel für verschlüsselte Updates");
    const bytes = (await r.loadData()).getBytes();
    code = utf8Text(chacha20(hexBytes(UPDATE_SCHLUESSEL), hexBytes(m.nonce), bytes));
  } else {
    code = await r.loadString();
  }
  if (sha256Hex(utf8Bytes(UPDATE_SCHLUESSEL + ":" + code)) !== m.pruef) throw new Error("Update-Datei beschädigt oder nicht echt – nichts geändert.");
  if (code.indexOf('const VERSION = "' + m.version + '"') < 0 || code.indexOf("// Variables used by Scriptable.") !== 0) throw new Error("Update-Datei unerwartet – nichts geändert.");
  const ziel = module.filename;
  const fmZiel = ziel.indexOf(FileManager.local().documentsDirectory()) === 0 ? FileManager.local() : FileManager.iCloud();
  // Sicherung der bisherigen Fassung (nicht im Skript-Ordner, damit sie nicht als Skript erscheint)
  try {
    const f = FileManager.local();
    if (fmZiel.isFileStoredIniCloud && fmZiel.isFileStoredIniCloud(ziel) && !fmZiel.isFileDownloaded(ziel)) await fmZiel.downloadFileFromiCloud(ziel);
    f.writeString(f.joinPath(f.libraryDirectory(), UPDATE_ID + "-sicherung-" + VERSION + ".js"), fmZiel.readString(ziel));
  } catch (e) { /* Sicherung ist nur ein Extra */ }
  fmZiel.writeString(ziel, code);
  const s = updateStand();
  s.neu = null;
  s.installiert = { version: m.version, ts: Date.now() };
  schreibUpdateJSON(s);
  return true;
}

/** Im Widget: einmal am Tag prüfen; automatisch installieren oder einmal melden. Wirft nie. */
async function updateImHintergrund() {
  try {
    const m = await updatePruefen();
    if (!m) return;
    const s = updateStand();
    if (s.modus === "auto") {
      await updateInstallieren(m);
      await updateMitteilung(`${SCRIPT_NAME} ist jetzt Version ${m.version}`, (m.neu || []).slice(0, 3).join(" · ") || "Das Widget wurde aktualisiert.", false);
    } else if (s.gemeldet !== m.version) {
      s.gemeldet = m.version;
      schreibUpdateJSON(s);
      await updateMitteilung(`Update für ${SCRIPT_NAME}: Version ${m.version}`, ((m.neu || []).slice(0, 3).join(" · ") || "Neue Version verfügbar.") + " – Tippen zum Installieren.", true);
    }
  } catch (e) { /* nächster Versuch beim nächsten Lauf */ }
}

async function updateMitteilung(titel, text, mitLink) {
  try {
    const n = new Notification();
    n.title = titel;
    n.body = text;
    n.identifier = "update-" + UPDATE_ID;
    if (mitLink) n.openURL = "scriptable:///run/" + encodeURIComponent(SCRIPT_NAME) + "?update=1";
    await n.schedule();
  } catch (e) { /* Mitteilungen nicht erlaubt */ }
}

/** In der App: neue Version anbieten. Gibt true zurück, wenn installiert wurde (dann Skript beenden). */
async function updateAnbieten({ erzwingen = false } = {}) {
  const m = await updatePruefen({ erzwingen });
  if (!m) {
    if (erzwingen) {
      const a = new Alert();
      a.title = "Kein Update";
      a.message = `${SCRIPT_NAME} ${VERSION} ist aktuell.`;
      a.addAction("OK");
      await a.presentAlert();
    }
    return false;
  }
  const a = new Alert();
  a.title = `Update: Version ${m.version}`;
  a.message = `Installiert: ${VERSION}${m.datum ? "\nNeu seit " + m.datum : ""}\n\n` + (m.neu || []).map((x) => "• " + x).join("\n");
  a.addAction("Jetzt installieren");
  a.addCancelAction("Später");
  if ((await a.presentAlert()) === -1) return false;
  try {
    await updateInstallieren(m);
  } catch (e) {
    const f = new Alert();
    f.title = "Update nicht installiert";
    f.message = String((e && e.message) || e);
    f.addAction("OK");
    await f.presentAlert();
    return false;
  }
  const ok = new Alert();
  ok.title = `Version ${m.version} installiert`;
  ok.message = "Bitte das Skript einmal schließen und neu starten. Widgets nutzen die neue Version beim nächsten Aktualisieren.";
  ok.addAction("OK");
  await ok.presentAlert();
  return true;
}

/** Menüpunkt „Updates“: Stand, automatisch/melden/aus, jetzt prüfen. */
async function updateMenue() {
  while (true) {
    const s = updateStand();
    const a = new Alert();
    a.title = "Updates";
    a.message = `Installiert: ${SCRIPT_NAME} ${VERSION}` + (s.geprueft ? `\nZuletzt geprüft: ${new Date(s.geprueft).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : "")
      + (s.neu && versionNeuer(s.neu.version, VERSION) ? `\nVerfügbar: ${s.neu.version}` : "");
    const namen = { auto: "automatisch installieren", melden: "nur melden", aus: "aus" };
    a.addAction("Jetzt nach Updates suchen");
    a.addAction(`Modus: ${namen[s.modus] || namen.auto}`);
    a.addCancelAction("Fertig");
    const w = await a.presentSheet();
    if (w === -1) return false;
    if (w === 0) { if (await updateAnbieten({ erzwingen: true })) return true; }
    if (w === 1) {
      const m = new Alert();
      m.title = "Updates";
      m.message = "Automatisch: Das Widget installiert neue Versionen selbst (einmal am Tag geprüft) und meldet es. Nur melden: Du bekommst eine Mitteilung und installierst per Tippen.";
      const keys = ["auto", "melden", "aus"];
      keys.forEach((k) => m.addAction(namen[k]));
      m.addCancelAction("Abbrechen");
      const x = await m.presentSheet();
      if (x >= 0) { s.modus = keys[x]; schreibUpdateJSON(s); }
    }
  }
}

// --- Hilfsfunktionen: UTF-8, Hex, SHA-256, ChaCha20 (Scriptable hat keine Krypto-Bibliothek) ---
function utf8Bytes(str) {
  const b = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const d = str.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
    if (c < 0x80) b.push(c);
    else if (c < 0x800) b.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else b.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return b;
}
function utf8Text(b) {
  let s = "";
  const teile = [];
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    let cp;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 31) << 6) | (b[i++] & 63);
    else if (c < 0xf0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    teile.push(String.fromCodePoint(cp));
    if (teile.length >= 4096) { s += teile.join(""); teile.length = 0; }
  }
  return s + teile.join("");
}
function hexBytes(h) { const b = []; for (let i = 0; i < h.length; i += 2) b.push(parseInt(h.substr(i, 2), 16)); return b; }
function sha256Hex(bytes) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const m = bytes.slice();
  const bits = bytes.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(Math.floor(bits / Math.pow(2, i * 8)) & 255);
  const w = new Array(64);
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
/** ChaCha20 (RFC 8439), Zähler ab 0; Ver- und Entschlüsseln sind dieselbe Operation. */
function chacha20(schluessel, nonce, daten) {
  const wort = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
  const st = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
  for (let i = 0; i < 8; i++) st.push(wort(schluessel, i * 4));
  st.push(0, wort(nonce, 0), wort(nonce, 4), wort(nonce, 8));
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  const qr = (x, a, b, c, d) => {
    x[a] = (x[a] + x[b]) | 0; x[d] = rotl(x[d] ^ x[a], 16);
    x[c] = (x[c] + x[d]) | 0; x[b] = rotl(x[b] ^ x[c], 12);
    x[a] = (x[a] + x[b]) | 0; x[d] = rotl(x[d] ^ x[a], 8);
    x[c] = (x[c] + x[d]) | 0; x[b] = rotl(x[b] ^ x[c], 7);
  };
  const aus = new Array(daten.length);
  for (let o = 0, zaehler = 0; o < daten.length; o += 64, zaehler++) {
    st[12] = zaehler;
    const x = st.slice();
    for (let i = 0; i < 10; i++) {
      qr(x, 0, 4, 8, 12); qr(x, 1, 5, 9, 13); qr(x, 2, 6, 10, 14); qr(x, 3, 7, 11, 15);
      qr(x, 0, 5, 10, 15); qr(x, 1, 6, 11, 12); qr(x, 2, 7, 8, 13); qr(x, 3, 4, 9, 14);
    }
    for (let i = 0; i < 16; i++) {
      const v = (x[i] + st[i]) | 0;
      for (let j = 0; j < 4 && o + i * 4 + j < daten.length; j++) aus[o + i * 4 + j] = daten[o + i * 4 + j] ^ ((v >>> (8 * j)) & 255);
    }
  }
  return aus;
}
