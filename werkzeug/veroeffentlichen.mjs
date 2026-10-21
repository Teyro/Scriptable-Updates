// Veröffentlicht eine Scriptable-Skriptfassung im Update-Kanal (dieses Repo).
//   node werkzeug/veroeffentlichen.mjs <pfad/zum/Skript.js> "Neuerung 1" "Neuerung 2" …
// Liest SCRIPT_NAME, VERSION, UPDATE_ID und UPDATE_SCHLUESSEL aus dem Skript selbst (hier liegt
// kein Schlüssel). Mit Schlüssel wird ChaCha20-verschlüsselt (<ID>.js.enc), sonst Klartext (<ID>.js).
// Danach wird die Entschlüsselung mit dem Code aus dem Skript geprüft. Commit/Push macht man selbst.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

const [quelle, ...neu] = process.argv.slice(2);
if (!quelle) { console.error('Aufruf: node werkzeug/veroeffentlichen.mjs <Skript.js> "Neuerung" …'); process.exit(1); }
const code = fs.readFileSync(quelle, 'utf8');
const feld = (name) => (code.match(new RegExp('^const ' + name + ' = "([^"]*)";', 'm')) || [])[1];
const name = feld('SCRIPT_NAME'), version = feld('VERSION'), id = feld('UPDATE_ID'), schluessel = feld('UPDATE_SCHLUESSEL');
if (!name || !version || !id || schluessel === undefined) { console.error('SCRIPT_NAME/VERSION/UPDATE_ID/UPDATE_SCHLUESSEL fehlen im Skript'); process.exit(1); }
if (!code.startsWith('// Variables used by Scriptable.')) { console.error('Skript beginnt nicht mit dem Scriptable-Kopf'); process.exit(1); }

const ziel = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pruef = crypto.createHash('sha256').update(schluessel + ':' + code, 'utf8').digest('hex');
const manifest = { name, version, datum: new Date().toISOString().slice(0, 10), neu, pruef };
if (schluessel) {
  const nonce = crypto.randomBytes(12);
  // Node: IV = 4 Byte Zähler (0, little endian) + 12 Byte Nonce
  const c = crypto.createCipheriv('chacha20', Buffer.from(schluessel, 'hex'), Buffer.concat([Buffer.alloc(4), nonce]));
  const verschluesselt = Buffer.concat([c.update(Buffer.from(code, 'utf8')), c.final()]);
  fs.writeFileSync(path.join(ziel, id + '.js.enc'), verschluesselt);
  Object.assign(manifest, { datei: id + '.js.enc', verschluesselt: true, nonce: nonce.toString('hex') });
} else {
  fs.writeFileSync(path.join(ziel, id + '.js'), code);
  Object.assign(manifest, { datei: id + '.js', verschluesselt: false });
}
fs.writeFileSync(path.join(ziel, id + '.json'), JSON.stringify(manifest, null, 2) + '\n');

// Gegenprobe mit den Funktionen aus dem Skript (genau der Code, der auf dem iPhone läuft)
const baustein = code.slice(code.indexOf('// --- Hilfsfunktionen: UTF-8, Hex, SHA-256, ChaCha20'));
const kontext = {};
vm.runInNewContext(baustein.split('\n// ====')[0] + '\nthis.f = { utf8Bytes, utf8Text, hexBytes, sha256Hex, chacha20 };', kontext);
const f = kontext.f;
let zurueck;
if (schluessel) {
  const bytes = [...fs.readFileSync(path.join(ziel, id + '.js.enc'))];
  zurueck = f.utf8Text(f.chacha20(f.hexBytes(schluessel), f.hexBytes(manifest.nonce), bytes));
} else zurueck = fs.readFileSync(path.join(ziel, id + '.js'), 'utf8');
const ok = zurueck === code && f.sha256Hex(f.utf8Bytes(schluessel + ':' + zurueck)) === pruef;
console.log(`${name} ${version} → ${manifest.datei} (${schluessel ? 'verschlüsselt' : 'Klartext'}) – Gegenprobe ${ok ? 'OK' : 'FEHLGESCHLAGEN'}`);
if (!ok) process.exit(2);
