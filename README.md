# Scriptable-Updates

Update-Kanal für meine Scriptable-Widgets (iOS). Die Widgets prüfen hier einmal am Tag, ob es eine
neue Version gibt, und installieren sie (oder melden sie, je nach Einstellung im Skript unter
„⬆️ Updates“).

- `<Name>.json` – Version, Datum, Neuerungen, Prüfsumme
- `<Name>.js` – öffentliches Skript im Klartext (ALDI TALK Widget)
- `<Name>.js.enc` – privates Skript, ChaCha20-verschlüsselt; den Schlüssel kennt nur das Skript selbst

Vor dem Ersetzen prüft jedes Skript die Prüfsumme (mit dem Schlüssel verknüpft) und behält die
alte Fassung als Sicherung.

Veröffentlichen: `node werkzeug/veroeffentlichen.mjs <pfad/zum/Skript.js> "Neuerung 1" "Neuerung 2"`
– das Werkzeug macht danach eine Gegenprobe mit dem Entschlüsselungs-Code aus dem Skript.
