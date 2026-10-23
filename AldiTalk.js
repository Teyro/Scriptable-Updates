// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: signal;

// ============================================================
//  ALDI TALK Widget 3.0 für Scriptable (iOS) – Deutsch & English
//
//  Größen: klein, mittel, groß – und Sperrbildschirm (rund, rechteckig, Textzeile).
//  Zeigt Datenvolumen (alle Pakete zusammen), Guthaben, Laufzeit, Tagesbudget,
//  Verbrauch der letzten 14 Tage und eine Prognose, ob das Volumen reicht.
//  Warnt per Mitteilung, wenn das Volumen knapp oder das Guthaben vor der
//  Verlängerung zu niedrig ist.
//
//  Roaming: Das Widget erkennt, in welchem Land du bist – per Standort (GPS),
//  ersatzweise über die Zeitzone des iPhones, oder du legst das Land selbst fest.
//  Im EU-Ausland zeigt es das Roaming-Volumen (EU-Fair-Use-Grenze von ALDI TALK),
//  außerhalb der EU eine Kosten-Warnung.
//
//  Einrichten:
//  1. Skript in Scriptable anlegen und GENAU so benennen wie SCRIPT_NAME.
//  2. Skript einmal IN DER APP starten -> Zugangsdaten eingeben.
//  3. Widget auf den Home- oder Sperrbildschirm legen, Skript "AldiTalk" wählen.
//
//  Widget-Parameter (optional, beim Bearbeiten des Widgets), mit Komma kombinierbar:
//    "2"                  -> zweiter Vertrag des Kontos (bei mehreren Rufnummern)
//    "hell"               -> Design (aldi, dunkel, hell, auto)
//    "roaming" / "inland" -> immer Roaming- bzw. Inlandsvolumen
//    "en" / "de"          -> Sprache dieses Widgets
//    "alle"               -> alle Rufnummern des Kontos untereinander (bis zu 4)
//    "standby"            -> kleines Widget mit riesiger Zahl (StandBy-Modus)
//
//  Siri: in der Kurzbefehle-App die Aktion „Skript ausführen“ mit diesem Skript
//  anlegen (z. B. „ALDI TALK“ nennen) – Siri sagt dann Volumen, Verlängerung und Guthaben.
//
//  Lehnt ALDI TALK die Zugangsdaten ab, probiert das Widget NICHT weiter
//  (sonst sperrt ALDI TALK das Konto) – einmal das Skript in der App öffnen.
// ============================================================

const SCRIPT_NAME = "AldiTalk";
// Tatsächlicher Name in Scriptable (falls umbenannt, z. B. „PCA“) – für Links aus Widget und Mitteilungen
const AUFRUF_NAME = (typeof Script !== "undefined" && typeof Script.name === "function" && Script.name()) || SCRIPT_NAME;
const VERSION = "3.4";

// --- Endpunkte (Stand: Kundenportal 2026) ---------------------
const PORTAL = "https://www.alditalk-kundenportal.de";
const AUTH = "https://login.alditalk-kundenbetreuung.de";
const AUTH_API = AUTH + "/signin/json/authenticate?realm=%2Falditalk&authIndexType=service&authIndexValue=Login";
const OVERVIEW = PORTAL + "/portal/auth/uebersicht/";
const BOOKING = PORTAL + "/portal/auth/buchungsuebersicht/";
const BFF207 = PORTAL + "/scs/bff/scs-207-customer-master-data-bff/customer-master-data";
const BFF209 = PORTAL + "/scs/bff/scs-209-selfcare-dashboard-bff/selfcare-dashboard";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UNIT_TO_GB = {
  bytes: 1024 ** 3, byte: 1024 ** 3, b: 1024 ** 3,
  kilobytes: 1024 ** 2, kilobyte: 1024 ** 2, kb: 1024 ** 2,
  megabytes: 1024, megabyte: 1024, mb: 1024,
  gigabytes: 1, gigabyte: 1, gb: 1,
};
const ZEIT_LIMIT_S = 20;              // einzelne Anfrage – Widgets haben insgesamt nur ~30 s
const VERLAUF_TAGE = 60;

const K_USER = "alditalk_user";
const K_PASS = "alditalk_pass";

const IM_WIDGET = !!(config.runsInWidget || config.runsInAccessoryWidget);

// ============================================================
//  Einstellungen (in der App unter "Einstellungen" änderbar)
// ============================================================
const STANDARD = {
  design: "aldi",            // aldi | dunkel | hell | auto
  sprache: "auto",           // auto (wie das iPhone) | de | en
  warnGB: 1.0,               // Volumen-Warnung (Ring rot + Mitteilung)
  warnGuthaben: 5.0,         // Guthaben-Warnung kurz vor der Verlängerung (€)
  mitteilungen: true,
  cacheMin: 30,              // so oft wird wirklich neu eingeloggt
  vertrag: 0,                // welcher Vertrag (bei mehreren Rufnummern)
  roaming: "auto",           // auto (nach Land) | an (immer Roaming) | aus (immer Inland)
  landManuell: "",           // "" = automatisch erkennen, sonst Ländercode ("DK")
  landIntervall: 1440,       // Standort im Widget prüfen alle … Minuten (Zeitzonenwechsel: sofort)
  tipps: true,               // Mitteilungen: Volumen übrig, ungewöhnlicher Verbrauch, Tarif verlängert
  erinnerung: 0,             // Erinnerung an die Verlängerung: 0 = aus, sonst Tage vorher
  vertragNamen: {},          // eigene Namen für Rufnummern ("0157 1234567" -> "Kim")
  budgetWarnung: true,       // Mitteilung, wenn heute mehr als das Tagesbudget verbraucht ist
  haSync: false,             // Werte als Sensoren an Home Assistant schicken
};

// Dateien: lokal – oder (iCloud-Abgleich an) Einstellungen, Verlauf & Co. in iCloud, damit
// iPhone und iPad dasselbe sehen. Standort und Zwischenspeicher bleiben je Gerät.
const fm = FileManager.local();
const ORDNER = fm.documentsDirectory();
const ICLOUD_MERKER = "alditalk-icloud.an";
const ICLOUD = (() => { try { return fm.fileExists(fm.joinPath(ORDNER, ICLOUD_MERKER)); } catch (e) { return false; } })();
const SYNC_DATEIEN = /^alditalk-(einstellungen|verlauf|zeitraeume|aufladungen|mitteilungen|erinnerung)/;
let fmWolke = null, ORDNER_WOLKE = null;
function wolke() {
  if (!fmWolke) {
    fmWolke = FileManager.iCloud();
    ORDNER_WOLKE = fmWolke.joinPath(fmWolke.documentsDirectory(), "ALDI-TALK-Daten");
    if (!fmWolke.fileExists(ORDNER_WOLKE)) fmWolke.createDirectory(ORDNER_WOLKE, true);
  }
  return fmWolke;
}
const inWolke = (name) => ICLOUD && SYNC_DATEIEN.test(name);
const fmFuer = (name) => (inWolke(name) ? wolke() : fm);
const pfad = (name) => (inWolke(name) ? wolke().joinPath(ORDNER_WOLKE, name) : fm.joinPath(ORDNER, name));
if (ICLOUD) {
  // Dateien aus iCloud vorher herunterladen (sonst liest man einen Platzhalter)
  try {
    const f = wolke();
    for (const n of f.listContents(ORDNER_WOLKE)) {
      const p = f.joinPath(ORDNER_WOLKE, n);
      if (!f.isFileDownloaded(p)) await f.downloadFileFromiCloud(p);
    }
  } catch (e) { /* offline – dann mit dem, was da ist */ }
}

function liesJSON(name, ersatz) {
  try {
    const p = pfad(name), f = fmFuer(name);
    if (f.fileExists(p)) return JSON.parse(f.readString(p));
  } catch (e) { /* kaputte Datei – Ersatz nehmen */ }
  return ersatz;
}
function schreibJSON(name, wert) { fmFuer(name).writeString(pfad(name), JSON.stringify(wert)); }
function loesche(name) { const p = pfad(name), f = fmFuer(name); if (f.fileExists(p)) f.remove(p); }

const einstellungen = Object.assign({}, STANDARD, liesJSON("alditalk-einstellungen.json", {}));
function speichereEinstellungen() { schreibJSON("alditalk-einstellungen.json", einstellungen); }

// Widget-Parameter, z. B. "2", "hell", "roaming", "en" oder "2, hell, en".
const widgetParam = String(args.widgetParameter || "").toLowerCase().split(/[,; ]+/).filter(Boolean);
let vertragIndex = einstellungen.vertrag;
let designWahl = einstellungen.design;
let roamingWahl = einstellungen.roaming;
let spracheWahl = einstellungen.sprache;
let alleVertraege = false;
let standbyWahl = false;
for (const teil of widgetParam) {
  if (/^\d+$/.test(teil)) vertragIndex = Math.max(0, parseInt(teil, 10) - 1);
  else if (["aldi", "dunkel", "hell", "auto"].includes(teil)) designWahl = teil;
  else if (teil === "roaming") roamingWahl = "an";
  else if (teil === "inland") roamingWahl = "aus";
  else if (teil === "de" || teil === "en") spracheWahl = teil;
  else if (teil === "alle" || teil === "all") alleVertraege = true;
  else if (teil === "standby") standbyWahl = true;
}

// ============================================================
//  Sprache / Language
// ============================================================
function ermittleSprache() {
  if (spracheWahl === "de" || spracheWahl === "en") return spracheWahl;
  try { return /^de/i.test(Device.language()) ? "de" : "en"; } catch (e) { return "de"; }
}
let L = ermittleSprache();

const TEXTE = {
  de: {
    unbegrenzt: "unbegrenzt", frei: "frei", von: "von", heute: "heute", gb_von: (x) => `GB von ${x}`, gb_frei: "GB frei",
    gb_roaming_frei: "GB Roaming frei", gb_tag: "GB/Tag", tage: (n) => (n === 0 ? "heute" : n === 1 ? "1 Tag" : `${n} Tage`), tage_kurz: (n) => (n === 0 ? "heute" : `${n} T`),
    noch_tage: (n) => (n === 0 ? "endet heute" : `noch ${n} T`), noch_tage_lang: (n) => (n === 0 ? "endet heute" : n === 1 ? "noch 1 Tag" : `noch ${n} Tage`),
    status_leer: "⚠︎ aufgebraucht", status_kritisch: "⚠︎ fast leer", status_warnung: "⚠︎ wird knapp", status_gut: "alles gut",
    alles_gruen: "Alles im grünen Bereich", nicht_aktuell: "nicht aktuell",
    guthaben: "Guthaben", laufzeit: "Laufzeit", gueltig_bis: "gültig bis", pro_tag: "pro Tag", tagesbudget: "Tagesbudget",
    prognose: "Prognose", status: "Status", reicht: "reicht ✓", leer_am: (d) => `⚠︎ leer am ${d}`, kein_verbrauch: "kein Verbrauch",
    sammelt: "sammelt noch Daten", durchschnitt: (x) => `Ø ${x} GB pro Tag`, bis_laufzeitende: "bis zum Laufzeitende",
    verbrauch_pro_tag: "Verbrauch pro Tag", verbrauch_hinweis: "Letzte 14 Tage, geschätzt aus den Abfragen des Widgets",
    verlauf_sammelt: "Verlauf sammelt sich noch", heute_gb: (x) => `heute ${x} GB`, budget: "Budget",
    als_tabelle: "Als Tabelle anzeigen", tag: "Tag", verbrauch: "Verbrauch", pakete: "Pakete",
    nur_deutschland: "Gilt nur in Deutschland", minuten: "Minuten", sms: "SMS", flat: "Flat",
    nachbuchen: "Nachbuchen", aktualisieren: "Aktualisieren", portal: "Portal",
    aktualisiert: (x) => `Aktualisiert ${x}`, stand: (x) => `Stand ${x}`, tippen_oeffnen: "Tippen zum Öffnen", hallo: (n) => `Hallo ${n}`,
    gerade_eben: "gerade eben", vor_min: (n) => `vor ${n} Min`, vor_std: (n) => `vor ${n} Std`, am: (d) => `am ${d}`,
    wochentage: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
    // Land & Roaming
    roaming: "Roaming", eu_ausland: "EU-Ausland", ausland: "Ausland", inland: "Inland", eu_roaming: "EU-Roaming",
    ausserhalb_eu: "außerhalb der EU", zone_inland: "Inland", zone_eu: "EU-Roaming", zone_welt: "Ausland außerhalb der EU",
    hinweis_nicht_eu: "Außerhalb der EU – Datennutzung kann extra kosten",
    hinweis_normal: "Im EU-Ausland gilt dein normales Volumen",
    hinweis_geschaetzt: "Geschätzt: ⅔ des Tarifvolumens (EU-Fair-Use)",
    hinweis_nur_roaming: "Es zählt nur das EU-Roaming-Volumen. Tarif- und Gratis-Volumen gelten nur in Deutschland.",
    roaming_fest: "Roaming fest eingeschaltet", standort: "Standort", land: "Land",
    quelle_gps: "per GPS", quelle_zeitzone: "per Zeitzone", quelle_manuell: "manuell festgelegt", quelle_alt: "zuletzt bekannt",
    geprueft: (x) => `geprüft ${x}`, standort_unbekannt: "Standort noch unbekannt",
    ortung_erlauben: "Ortungsdienste für Scriptable erlauben („Beim Verwenden der App oder Widgets“)",
    pruefung_fehlgeschlagen: "letzte GPS-Prüfung fehlgeschlagen",
    neu_pruefen: "Neu prüfen", roaming_volumen: "Roaming-Volumen", datenvolumen: "Datenvolumen",
    gps_zeitzone_uneinig: (a, b) => `GPS sagt ${a}, Zeitzone sagt ${b} – GPS gewinnt`,
    // Fehler
    f_zugangsdaten_abgelehnt: "Zugangsdaten abgelehnt – Skript in der App öffnen",
    f_kein_login: "Kein Login – Skript einmal in der App öffnen",
    f_portal: "Kundenportal antwortet nicht wie erwartet (evtl. Wartungsarbeiten)",
    f_kein_vertrag: "Kein Vertrag gefunden", f_tarifdaten: "Tarifdaten nicht abrufbar", f_kein_paket: "Kein Datenpaket gefunden",
    f_login_unerwartet: "Login-Antwort unerwartet", f_login_ohne: "Login abgelehnt (ohne Begründung)",
    f_gesperrt: "Rufnummer oder Passwort falsch (nach mehreren Fehlversuchen sperrt ALDI TALK das Konto vorübergehend)",
    f_passwort: "Rufnummer oder Passwort falsch", f_login_abgelehnt: (m) => `Login abgelehnt: ${m}`,
    f_wartung: "ALDI TALK: Wartungsarbeiten – später noch einmal", f_unerwartet: (w) => `${w}: unerwartete Antwort vom Server`,
    f_pow: "Proof-of-Work nicht gelöst", f_zeit: "Zeitüberschreitung", f_land: "Land nicht erkannt",
    vertrag_n: (n) => `Vertrag ${n}`,
    // Mitteilungen
    n_land_eu: (v) => `EU-Roaming: ${v}.`, n_land_welt: (v) => `Außerhalb der EU – mobiles Surfen kann extra kosten. ${v}.`,
    n_volumen_frei: (x, art) => `${x} GB ${art} frei`, n_unbegrenzt: "Unbegrenztes Datenvolumen",
    n_fast_leer: (art) => `ALDI TALK: ${art} fast aufgebraucht`,
    n_nur_noch: (x) => `Nur noch ${x} GB frei`, n_noch_laufzeit: (n) => ` – noch ${n} Tage Laufzeit.`,
    n_aufladen: "ALDI TALK: Guthaben aufladen",
    n_verlaengerung: (n, g) => `Verlängerung in ${n} Tag${n === 1 ? "" : "en"}, Guthaben nur ${g}.`,
    n_knapp: "ALDI TALK: Volumen wird knapp",
    n_knapp_text: (x, d) => `Bei deinem Verbrauch (${x} GB/Tag) ist es etwa am ${d} leer.`,
    n_uebrig: "ALDI TALK: Volumen übrig",
    n_uebrig_text: (x, n, proTag) => `Noch ${x} GB Tarif-Volumen und nur ${n === 1 ? "1 Tag" : n + " Tage"} bis zur Verlängerung – du kannst ruhig mehr nutzen (etwa ${proTag} GB pro Tag).`,
    n_ungewoehnlich: "ALDI TALK: ungewöhnlich hoher Verbrauch",
    n_ungewoehnlich_text: (x, schnitt) => `Heute schon ${x} GB verbraucht – sonst etwa ${schnitt} GB am Tag. Läuft vielleicht ein Update, Backup oder Foto-Upload über das Mobilnetz?`,
    n_verlaengert: "ALDI TALK: Tarif verlängert",
    n_verlaengert_text: (gb, bis, verbraucht, guthaben, abgebucht) => `Wieder ${gb} GB bis ${bis}` + (bis.endsWith(".") ? "" : ".") + (verbraucht ? ` Im letzten Zeitraum etwa ${verbraucht} GB genutzt.` : "") + ` Guthaben jetzt ${guthaben}` + (abgebucht ? ` (${abgebucht} weniger als vorher).` : "."),
    n_tipp_roaming: "Tipp: Einstellungen › Mobilfunk › Datenroaming aus.",
    // Rückblick & Tarif-Check
    rueckblick: "Rückblick", rueckblick_leer: "Füllt sich ab der nächsten Verlängerung: wie viel du je Zeitraum genutzt hast und ob dein Tarif dazu passt.",
    rueckblick_bis: (d) => `bis ${d}`, unvollstaendig: "unvollständig",
    tarif_kleiner: (avg, tarif) => `Du nutzt im Schnitt ${avg} von ${tarif} GB. Ein kleinerer Tarif könnte reichen – und günstiger sein.`,
    tarif_groesser: (avg, tarif) => `Du brauchst im Schnitt ${avg} GB – fast alles oder mehr als deine ${tarif} GB. Ein größerer Tarif kann günstiger sein als oft nachzubuchen.`,
    tarif_passt: (avg, tarif) => `Dein Tarif passt: im Schnitt ${avg} von ${tarif} GB genutzt.`,
    // Siri
    siri_fehler: (f) => `ALDI TALK konnte ich gerade nicht abfragen. ${f}`,
    siri_unbegrenzt: "Du hast unbegrenztes Datenvolumen.",
    siri_volumen: (x, y) => `Du hast noch ${x} von ${y} Gigabyte.`,
    siri_roaming: (land, x, y) => `In ${land} hast du noch ${x} von ${y} Gigabyte Roaming-Volumen.`,
    siri_verlaengerung: (n) => (n === 0 ? " Dein Tarif verlängert sich heute." : n === 1 ? " Dein Tarif verlängert sich morgen." : ` Dein Tarif verlängert sich in ${n} Tagen.`),
    siri_reicht: " Bei deinem Verbrauch reicht das.", siri_leer: (d) => ` Bei deinem Verbrauch ist es etwa am ${d} leer.`,
    siri_guthaben: (g) => ` Guthaben: ${g}.`, siri_stand: (x) => ` Stand: ${x}.`,
    m_siri: "🎙 Siri & Kurzbefehle", siri_probe: "▶︎ Probehören",
    siri_anleitung: "So fragst du Siri nach deinem Volumen:\n\n1. Kurzbefehle-App öffnen → „+“.\n2. Aktion „Skript ausführen“ (Scriptable) hinzufügen und dieses Skript wählen.\n3. Den Kurzbefehl z. B. „ALDI TALK“ nennen.\n\nDann reicht: „Hey Siri, ALDI TALK“.",
    // Erinnerung
    e_tipps: (an) => `Tipps (Volumen übrig, hoher Verbrauch, Verlängerung): ${an ? "an" : "aus"}`,
    e_erinnerung: (n) => `Erinnerung an Verlängerung: ${n ? (n === 1 ? "1 Tag vorher" : n + " Tage vorher") : "aus"}`,
    erinnerung: "Erinnerung an Verlängerung", erinnerung_text: "Trägt die Verlängerung in die Erinnerungen-App ein – jedes Mal automatisch neu.",
    erinnerung_aus: "Aus", erinnerung_n: (n) => (n === 1 ? "1 Tag vorher" : `${n} Tage vorher`),
    erinnerung_titel: (d) => `ALDI TALK: Verlängerung am ${d}`,
    erinnerung_notiz: (g) => `Guthaben zuletzt: ${g}. Reicht das Guthaben nicht, verlängert ALDI TALK den Tarif nicht.`,
    erinnerung_fehler: "Kein Zugriff auf Erinnerungen – bitte in den iOS-Einstellungen bei Scriptable erlauben.",
    erinnerung_ok: (d) => `Eingetragen für ${d}, 18 Uhr.`,
    e_namen: "Namen der Rufnummern", name_text: "Eigener Name, z. B. „Kim“ – leer lassen für die Rufnummer.",
    // 3.4
    heute_von: (x, y) => `${x} / ${y} GB`, heute_label: "Heute",
    n_budget: "ALDI TALK: Tagesbudget überschritten",
    n_budget_text: (x, y) => `Heute schon ${x} GB verbraucht – dein Tagesbudget sind ${y} GB. Morgen ist es dann etwas weniger.`,
    e_budget: (an) => `Tagesbudget-Warnung: ${an ? "an" : "aus"}`,
    standby_frei: "GB frei",
    aufladungen: "Aufladungen", aufladungen_hinweis: "Erkannt, wenn das Guthaben zwischen zwei Abfragen steigt.",
    aufladungen_summe: (j, x) => `${j} bisher: ${x}`,
    tageszeit: "Wann du surfst", tageszeit_sammelt: "Sammelt sich noch – nach ein paar Tagen steht hier, wann du am meisten verbrauchst.",
    tageszeit_namen: ["Nacht", "Vormittag", "Nachmittag", "Abend"], tageszeit_spannen: ["0–6", "6–12", "12–18", "18–24"],
    tageszeit_satz: (n, sp, p) => `Am meisten verbrauchst du ${n === "Nacht" ? "nachts" : n === "Vormittag" ? "vormittags" : n === "Nachmittag" ? "nachmittags" : "abends"} (${sp} Uhr): ${p} %.`,
    m_reise: "🧳 Reise-Vorschau", reise_titel: (f, l) => `${f} ${l}`,
    reise_inland: "Inland – hier gilt dein normales Datenvolumen.",
    reise_eu: (x) => `Gehört zum EU-Roaming: Telefonieren und SMS wie zu Hause. Fürs Surfen zählt nur dein EU-Roaming-Volumen – ${x}. Tarif- und Gratis-Volumen gelten dort nicht.`,
    reise_eu_wert: (x, y) => `zurzeit ${x} von ${y} GB`, reise_eu_geschaetzt: (x) => `geschätzt etwa ${x} GB (⅔ des Tarifs)`,
    reise_welt: "Außerhalb der EU: kein Inklusiv-Volumen, Surfen und Telefonieren können teuer werden. Tipp: Einstellungen › Mobilfunk › Datenroaming aus, WLAN nutzen – oder im Kundenportal nach einem Auslandspaket schauen.",
    m_ha: "🏠 Home Assistant", ha_aus: "aus", ha_an: (h) => `an (${h})`,
    ha_text: "Schickt Restvolumen, Guthaben, Laufzeit und den heutigen Verbrauch als Sensoren an Home Assistant (sensor.aldi_talk_…) – für Dashboards und Automationen. Nach einem Neustart von Home Assistant erscheinen sie beim nächsten Abruf wieder.",
    ha_vorhanden: (h) => `Zugang verwenden: ${h}`, ha_eingeben: "Adresse und Token eingeben", ha_abschalten: "Ausschalten",
    ha_adresse: "Home-Assistant-Adresse", ha_token: "Langlebiges Zugriffstoken (Profil → Sicherheit)",
    ha_ok: "Verbunden – die Sensoren erscheinen nach dem nächsten Abruf.", ha_fehler: (m) => `Hat nicht geklappt: ${m}`,
    ha_letzter: (x) => `Zuletzt gesendet: ${x}`, ha_admin: "Home Assistant verlangt dafür ein Token eines Administrators.",
    m_icloud: (an) => `☁️ iPhone & iPad abgleichen: ${an ? "an" : "aus"}`,
    icloud_text: "Einstellungen, Verlauf, Rückblick und Aufladungen über iCloud teilen – so sehen iPhone und iPad dasselbe. Standort und Zugangsdaten bleiben je Gerät. Danach das Skript einmal neu starten.",
    icloud_an: "Einschalten", icloud_aus: "Ausschalten", icloud_fertig: "Erledigt – bitte das Skript einmal schließen und neu starten.",
    // Menüs
    login_titel: "ALDI TALK Login",
    login_text: "Zugangsdaten des Kundenportals (Rufnummer bzw. Benutzername und Passwort). Sie werden nur im iOS-Schlüsselbund gespeichert.",
    login_user: "Rufnummer / Benutzername", login_pass: "Passwort", speichern: "Speichern", abbrechen: "Abbrechen",
    abgelehnt_text: (m) => `ALDI TALK hat die gespeicherten Zugangsdaten abgelehnt:\n\n${m}\n\nHast du dein Passwort geändert? Dann bitte neu eingeben.`,
    neu_eingeben: "Zugangsdaten neu eingeben", nochmal_alte: "Nochmal mit den alten versuchen",
    m_uebersicht: "📊 Übersicht", m_aktualisieren: "↻ Jetzt aktualisieren", m_nachbuchen: "＋ Datenvolumen nachbuchen",
    m_portal: "🌐 Kundenportal öffnen", m_vorschau: "🖼 Widget-Vorschau", m_land: "🌍 Land & Roaming",
    m_einstellungen: "⚙️ Einstellungen", m_zugang: "🔑 Zugangsdaten ändern", fertig: "Fertig", zurueck: "Zurück",
    menue_volumen: (x, y) => `${x} von ${y} GB frei`, menue_guthaben: (g) => `Guthaben ${g}`,
    vorschau: "Widget-Vorschau", klein: "Klein", mittel: "Mittel", gross: "Groß",
    sperr_rund: "Sperrbildschirm rund", sperr_rechteck: "Sperrbildschirm rechteckig",
    einstellungen: "Einstellungen", design: "Design", sprache: "Sprache",
    design_aldi: "ALDI-Blau", design_dunkel: "Dunkel", design_hell: "Hell", design_auto: "Automatisch (hell/dunkel)",
    sprache_auto: "Automatisch (wie iPhone)", sprache_de: "Deutsch", sprache_en: "English",
    e_volumen_warnung: (x) => `Volumen-Warnung ab: ${x} GB`, e_guthaben_warnung: (x) => `Guthaben-Warnung unter: ${x}`,
    e_mitteilungen: (an) => `Mitteilungen: ${an ? "an" : "aus"}`, e_intervall: (n) => `Aktualisieren alle: ${n} Min`,
    e_vertrag: (v) => `Vertrag: ${v}`, e_verlauf: "Verbrauchsverlauf löschen", e_debug: "🧪 Daten für Fehlersuche kopieren",
    e_reset: "Alles zurücksetzen (inkl. Zugangsdaten)",
    reset_frage: "Alles zurücksetzen?", reset_text: "Zugangsdaten, Einstellungen, Verlauf und zwischengespeicherte Daten werden gelöscht.",
    volumen_warnung: "Volumen-Warnung", volumen_warnung_text: "Ab wie vielen GB Restvolumen warnen?",
    guthaben_warnung: "Guthaben-Warnung", guthaben_warnung_text: "Warnen, wenn kurz vor der Verlängerung weniger Guthaben da ist als (€):",
    aktualisieren_alle: "Aktualisieren alle …", minuten_n: (n) => `${n} Minuten`, vertrag: "Vertrag",
    verlauf_frage: "Verlauf löschen?", verlauf_text: "Der Verbrauch der letzten Tage und die Prognose beginnen neu.",
    fehlersuche: "Fehlersuche",
    debug_kopiert: "Die Paketdaten des Portals sind kopiert – ohne Rufnummer, Namen und Guthaben. Du kannst sie jetzt z. B. in eine Nachricht einfügen.",
    debug_leer: "Noch keine Daten – bitte erst einmal aktualisieren.", ja: "Ja", nein: "Nein", ok: "OK",
    // Land-Menü
    l_titel: "Land & Roaming",
    l_anzeige: (x) => `Roaming-Anzeige: ${x}`, l_anzeige_auto: "Automatisch (nach Land)", l_anzeige_an: "Immer Roaming-Volumen",
    l_anzeige_aus: "Aus (immer Inland)", l_land: (x) => `Land: ${x}`, l_automatisch: "automatisch erkennen",
    l_intervall: (x) => `Standort prüfen: ${x}`, l_jetzt: "📍 Standort jetzt prüfen", l_verlauf: "🗺 Länderverlauf",
    l_land_waehlen: "Land festlegen", l_auto_empfohlen: "🛰 Automatisch erkennen (empfohlen)",
    l_eu: "EU / EWR", l_andere: "andere Länder", l_kein_verlauf: "Noch kein Länderwechsel erkannt.",
    l_iv_stuendlich: "stündlich", l_iv_6: "alle 6 Stunden", l_iv_taeglich: "einmal am Tag",
    l_iv_hinweis: "Wechselt das iPhone die Zeitzone (z. B. bei der Einreise), prüft das Widget sofort neu.",
    l_ergebnis: "Ergebnis",
  },
  en: {
    unbegrenzt: "unlimited", frei: "left", von: "of", heute: "today", gb_von: (x) => `GB of ${x}`, gb_frei: "GB left",
    gb_roaming_frei: "GB roaming left", gb_tag: "GB/day", tage: (n) => (n === 0 ? "today" : `${n} day${n === 1 ? "" : "s"}`), tage_kurz: (n) => (n === 0 ? "today" : `${n} d`),
    noch_tage: (n) => (n === 0 ? "ends today" : `${n} d left`), noch_tage_lang: (n) => (n === 0 ? "ends today" : `${n} day${n === 1 ? "" : "s"} left`),
    status_leer: "⚠︎ used up", status_kritisch: "⚠︎ almost empty", status_warnung: "⚠︎ running low", status_gut: "all good",
    alles_gruen: "All good", nicht_aktuell: "not up to date",
    guthaben: "Balance", laufzeit: "Renews in", gueltig_bis: "valid until", pro_tag: "per day", tagesbudget: "Daily budget",
    prognose: "Forecast", status: "Status", reicht: "enough ✓", leer_am: (d) => `⚠︎ empty ${d}`, kein_verbrauch: "no usage",
    sammelt: "collecting data", durchschnitt: (x) => `avg ${x} GB per day`, bis_laufzeitende: "until renewal",
    verbrauch_pro_tag: "Usage per day", verbrauch_hinweis: "Last 14 days, estimated from the widget's checks",
    verlauf_sammelt: "history is still building", heute_gb: (x) => `today ${x} GB`, budget: "Budget",
    als_tabelle: "Show as table", tag: "Day", verbrauch: "Usage", pakete: "Packs",
    nur_deutschland: "Valid in Germany only", minuten: "Minutes", sms: "SMS", flat: "Flat",
    nachbuchen: "Top up", aktualisieren: "Refresh", portal: "Portal",
    aktualisiert: (x) => `Updated ${x}`, stand: (x) => `As of ${x}`, tippen_oeffnen: "Tap to open", hallo: (n) => `Hi ${n}`,
    gerade_eben: "just now", vor_min: (n) => `${n} min ago`, vor_std: (n) => `${n} h ago`, am: (d) => `on ${d}`,
    wochentage: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
    roaming: "Roaming", eu_ausland: "EU abroad", ausland: "Abroad", inland: "Germany", eu_roaming: "EU roaming",
    ausserhalb_eu: "outside the EU", zone_inland: "Home (Germany)", zone_eu: "EU roaming", zone_welt: "Abroad outside the EU",
    hinweis_nicht_eu: "Outside the EU – data may cost extra",
    hinweis_normal: "In the EU your normal allowance applies",
    hinweis_geschaetzt: "Estimated: ⅔ of the plan's volume (EU fair use)",
    hinweis_nur_roaming: "Only the EU roaming allowance counts. Plan and bonus volume are valid in Germany only.",
    roaming_fest: "Roaming always on", standort: "Location", land: "Country",
    quelle_gps: "via GPS", quelle_zeitzone: "via time zone", quelle_manuell: "set manually", quelle_alt: "last known",
    geprueft: (x) => `checked ${x}`, standort_unbekannt: "Location not known yet",
    ortung_erlauben: "Allow location access for Scriptable (\"While Using the App or Widgets\")",
    pruefung_fehlgeschlagen: "last GPS check failed",
    neu_pruefen: "Check again", roaming_volumen: "roaming allowance", datenvolumen: "data",
    gps_zeitzone_uneinig: (a, b) => `GPS says ${a}, time zone says ${b} – using GPS`,
    f_zugangsdaten_abgelehnt: "Login rejected – open the script in the app",
    f_kein_login: "Not logged in – open the script in the app once",
    f_portal: "Customer portal answered unexpectedly (maybe maintenance)",
    f_kein_vertrag: "No contract found", f_tarifdaten: "Plan data not available", f_kein_paket: "No data pack found",
    f_login_unerwartet: "Unexpected login response", f_login_ohne: "Login rejected (no reason given)",
    f_gesperrt: "Wrong number or password (after several failed attempts ALDI TALK locks the account temporarily)",
    f_passwort: "Wrong number or password", f_login_abgelehnt: (m) => `Login rejected: ${m}`,
    f_wartung: "ALDI TALK: maintenance – try again later", f_unerwartet: (w) => `${w}: unexpected server response`,
    f_pow: "Proof of work not solved", f_zeit: "Timed out", f_land: "Country not recognised",
    vertrag_n: (n) => `Contract ${n}`,
    n_land_eu: (v) => `EU roaming: ${v}.`, n_land_welt: (v) => `Outside the EU – mobile data may cost extra. ${v}.`,
    n_volumen_frei: (x, art) => `${x} GB ${art} left`, n_unbegrenzt: "Unlimited data",
    n_fast_leer: (art) => `ALDI TALK: ${art} almost used up`,
    n_nur_noch: (x) => `Only ${x} GB left`, n_noch_laufzeit: (n) => ` – renews in ${n} day${n === 1 ? "" : "s"}.`,
    n_aufladen: "ALDI TALK: top up your balance",
    n_verlaengerung: (n, g) => `Renewal in ${n} day${n === 1 ? "" : "s"}, balance only ${g}.`,
    n_knapp: "ALDI TALK: data running low",
    n_knapp_text: (x, d) => `At your usage (${x} GB/day) it will run out around ${d}.`,
    n_uebrig: "ALDI TALK: data left over",
    n_uebrig_text: (x, n, proTag) => `Still ${x} GB of plan data and only ${n} day${n === 1 ? "" : "s"} until renewal – feel free to use more (about ${proTag} GB per day).`,
    n_ungewoehnlich: "ALDI TALK: unusually high usage",
    n_ungewoehnlich_text: (x, schnitt) => `Already ${x} GB used today – usually about ${schnitt} GB a day. Maybe an update, backup or photo upload is running over mobile data?`,
    n_verlaengert: "ALDI TALK: plan renewed",
    n_verlaengert_text: (gb, bis, verbraucht, guthaben, abgebucht) => `${gb} GB again until ${bis}.` + (verbraucht ? ` Last period you used about ${verbraucht} GB.` : "") + ` Balance now ${guthaben}` + (abgebucht ? ` (${abgebucht} less than before).` : "."),
    n_tipp_roaming: "Tip: Settings › Mobile Data › turn off Data Roaming.",
    rueckblick: "Review", rueckblick_leer: "Fills up from the next renewal: how much you used per period and whether your plan fits.",
    rueckblick_bis: (d) => `until ${d}`, unvollstaendig: "incomplete",
    tarif_kleiner: (avg, tarif) => `On average you use ${avg} of ${tarif} GB. A smaller plan might do – and cost less.`,
    tarif_groesser: (avg, tarif) => `On average you need ${avg} GB – nearly all or more than your ${tarif} GB. A bigger plan can be cheaper than topping up often.`,
    tarif_passt: (avg, tarif) => `Your plan fits: on average ${avg} of ${tarif} GB used.`,
    siri_fehler: (f) => `I couldn't check ALDI TALK right now. ${f}`,
    siri_unbegrenzt: "You have unlimited data.",
    siri_volumen: (x, y) => `You have ${x} of ${y} gigabytes left.`,
    siri_roaming: (land, x, y) => `In ${land} you have ${x} of ${y} gigabytes of roaming data left.`,
    siri_verlaengerung: (n) => (n === 0 ? " Your plan renews today." : n === 1 ? " Your plan renews tomorrow." : ` Your plan renews in ${n} days.`),
    siri_reicht: " At your usage that's enough.", siri_leer: (d) => ` At your usage it will run out around ${d}.`,
    siri_guthaben: (g) => ` Balance: ${g}.`, siri_stand: (x) => ` As of ${x}.`,
    m_siri: "🎙 Siri & Shortcuts", siri_probe: "▶︎ Listen",
    siri_anleitung: "How to ask Siri for your data:\n\n1. Open the Shortcuts app → “+”.\n2. Add the action “Run Script” (Scriptable) and choose this script.\n3. Name the shortcut e.g. “ALDI TALK”.\n\nThen just say: “Hey Siri, ALDI TALK”.",
    e_tipps: (an) => `Tips (data left over, high usage, renewal): ${an ? "on" : "off"}`,
    e_erinnerung: (n) => `Renewal reminder: ${n ? n + " day" + (n === 1 ? "" : "s") + " before" : "off"}`,
    erinnerung: "Renewal reminder", erinnerung_text: "Adds the renewal to the Reminders app – automatically renewed every time.",
    erinnerung_aus: "Off", erinnerung_n: (n) => `${n} day${n === 1 ? "" : "s"} before`,
    erinnerung_titel: (d) => `ALDI TALK: renewal on ${d}`,
    erinnerung_notiz: (g) => `Last balance: ${g}. If the balance is too low, ALDI TALK won't renew the plan.`,
    erinnerung_fehler: "No access to Reminders – please allow it for Scriptable in the iOS settings.",
    erinnerung_ok: (d) => `Added for ${d}, 6 pm.`,
    e_namen: "Names of phone numbers", name_text: "Your own name, e.g. “Kim” – leave empty for the number.",
    heute_von: (x, y) => `${x} / ${y} GB`, heute_label: "Today",
    n_budget: "ALDI TALK: daily budget exceeded",
    n_budget_text: (x, y) => `Already ${x} GB used today – your daily budget is ${y} GB. Tomorrow it will be a little less.`,
    e_budget: (an) => `Daily budget warning: ${an ? "on" : "off"}`,
    standby_frei: "GB left",
    aufladungen: "Top-ups", aufladungen_hinweis: "Detected when the balance rises between two checks.",
    aufladungen_summe: (j, x) => `${j} so far: ${x}`,
    tageszeit: "When you use data", tageszeit_sammelt: "Still collecting – after a few days you'll see when you use the most.",
    tageszeit_namen: ["Night", "Morning", "Afternoon", "Evening"], tageszeit_spannen: ["0–6", "6–12", "12–18", "18–24"],
    tageszeit_satz: (n, sp, p) => `You use the most data in the ${n.toLowerCase() === "night" ? "night" : n.toLowerCase()} (${sp} h): ${p} %.`,
    m_reise: "🧳 Travel preview", reise_titel: (f, l) => `${f} ${l}`,
    reise_inland: "Germany – your normal data allowance applies.",
    reise_eu: (x) => `EU roaming: calls and texts like at home. For data only your EU roaming allowance counts – ${x}. Plan and bonus volume don't apply there.`,
    reise_eu_wert: (x, y) => `currently ${x} of ${y} GB`, reise_eu_geschaetzt: (x) => `estimated about ${x} GB (⅔ of the plan)`,
    reise_welt: "Outside the EU: no included data, data and calls can get expensive. Tip: Settings › Mobile Data › turn off Data Roaming and use Wi-Fi – or look for a travel pack in the customer portal.",
    m_ha: "🏠 Home Assistant", ha_aus: "off", ha_an: (h) => `on (${h})`,
    ha_text: "Sends remaining data, balance, renewal and today's usage as sensors to Home Assistant (sensor.aldi_talk_…) – for dashboards and automations. After a Home Assistant restart they reappear with the next check.",
    ha_vorhanden: (h) => `Use access: ${h}`, ha_eingeben: "Enter address and token", ha_abschalten: "Turn off",
    ha_adresse: "Home Assistant address", ha_token: "Long-lived access token (Profile → Security)",
    ha_ok: "Connected – the sensors appear after the next check.", ha_fehler: (m) => `Didn't work: ${m}`,
    ha_letzter: (x) => `Last sent: ${x}`, ha_admin: "Home Assistant requires an administrator's token for this.",
    m_icloud: (an) => `☁️ Sync iPhone & iPad: ${an ? "on" : "off"}`,
    icloud_text: "Share settings, history, review and top-ups via iCloud so iPhone and iPad show the same. Location and login stay per device. Restart the script afterwards.",
    icloud_an: "Turn on", icloud_aus: "Turn off", icloud_fertig: "Done – please close and restart the script.",
    login_titel: "ALDI TALK login",
    login_text: "Customer portal login (phone number or user name and password). Stored only in the iOS keychain.",
    login_user: "Phone number / user name", login_pass: "Password", speichern: "Save", abbrechen: "Cancel",
    abgelehnt_text: (m) => `ALDI TALK rejected the saved login:\n\n${m}\n\nDid you change your password? Then please enter it again.`,
    neu_eingeben: "Enter login again", nochmal_alte: "Try the old login again",
    m_uebersicht: "📊 Overview", m_aktualisieren: "↻ Refresh now", m_nachbuchen: "＋ Buy more data",
    m_portal: "🌐 Open customer portal", m_vorschau: "🖼 Widget preview", m_land: "🌍 Country & roaming",
    m_einstellungen: "⚙️ Settings", m_zugang: "🔑 Change login", fertig: "Done", zurueck: "Back",
    menue_volumen: (x, y) => `${x} of ${y} GB left`, menue_guthaben: (g) => `Balance ${g}`,
    vorschau: "Widget preview", klein: "Small", mittel: "Medium", gross: "Large",
    sperr_rund: "Lock screen circular", sperr_rechteck: "Lock screen rectangular",
    einstellungen: "Settings", design: "Design", sprache: "Language",
    design_aldi: "ALDI blue", design_dunkel: "Dark", design_hell: "Light", design_auto: "Automatic (light/dark)",
    sprache_auto: "Automatic (like iPhone)", sprache_de: "Deutsch", sprache_en: "English",
    e_volumen_warnung: (x) => `Data warning below: ${x} GB`, e_guthaben_warnung: (x) => `Balance warning below: ${x}`,
    e_mitteilungen: (an) => `Notifications: ${an ? "on" : "off"}`, e_intervall: (n) => `Refresh every: ${n} min`,
    e_vertrag: (v) => `Contract: ${v}`, e_verlauf: "Clear usage history", e_debug: "🧪 Copy data for troubleshooting",
    e_reset: "Reset everything (incl. login)",
    reset_frage: "Reset everything?", reset_text: "Login, settings, history and cached data will be deleted.",
    volumen_warnung: "Data warning", volumen_warnung_text: "Warn when less than how many GB are left?",
    guthaben_warnung: "Balance warning", guthaben_warnung_text: "Warn shortly before renewal if the balance is below (€):",
    aktualisieren_alle: "Refresh every …", minuten_n: (n) => `${n} minutes`, vertrag: "Contract",
    verlauf_frage: "Clear history?", verlauf_text: "Daily usage and the forecast start over.",
    fehlersuche: "Troubleshooting",
    debug_kopiert: "The portal's pack data has been copied – without phone number, name and balance. You can paste it into a message now.",
    debug_leer: "No data yet – please refresh first.", ja: "Yes", nein: "No", ok: "OK",
    l_titel: "Country & roaming",
    l_anzeige: (x) => `Roaming display: ${x}`, l_anzeige_auto: "Automatic (by country)", l_anzeige_an: "Always roaming allowance",
    l_anzeige_aus: "Off (always Germany)", l_land: (x) => `Country: ${x}`, l_automatisch: "detect automatically",
    l_intervall: (x) => `Check location: ${x}`, l_jetzt: "📍 Check location now", l_verlauf: "🗺 Country history",
    l_land_waehlen: "Set country", l_auto_empfohlen: "🛰 Detect automatically (recommended)",
    l_eu: "EU / EEA", l_andere: "other countries", l_kein_verlauf: "No country change detected yet.",
    l_iv_stuendlich: "hourly", l_iv_6: "every 6 hours", l_iv_taeglich: "once a day",
    l_iv_hinweis: "If the iPhone changes its time zone (e.g. when entering a country), the widget checks again right away.",
    l_ergebnis: "Result",
  },
};

/** Übersetzter Text; Funktionen bekommen die weiteren Argumente. */
function t(schluessel, ...werte) {
  const s = TEXTE[L][schluessel] !== undefined ? TEXTE[L][schluessel] : TEXTE.de[schluessel];
  if (s === undefined) return schluessel;
  return typeof s === "function" ? s(...werte) : s;
}

// ============================================================
//  Design
// ============================================================
// Farben geprüft (Kontrast ≥ 3:1 zur Fläche, Farbsehschwäche): Balken-/Ringfarbe
// #2a9ee0 auf Navy, #2a78d6 auf Weiß. Statusfarben (Warnung/kritisch) stehen nie
// allein, sondern immer mit Symbol und Text ("⚠︎ wird knapp").
const DESIGNS = {
  aldi: {
    dunkel: true,
    oben: "#0b1a36", unten: "#15396b", glanz: "#2a9ee0",
    text: "#ffffff", text2: "#ffffffa6", text3: "#ffffff70",
    karte: "#ffffff14", spur: "#ffffff24", akzent: "#2a9ee0", akzentHell: "#7fd0ff",
    knopf: "#f59c00", knopfText: "#1a1a1a", grau: "#ffffff52",
  },
  dunkel: {
    dunkel: true,
    oben: "#121316", unten: "#1f2228", glanz: "#3987e5",
    text: "#ffffff", text2: "#c3c2b7", text3: "#898781",
    karte: "#ffffff10", spur: "#ffffff1f", akzent: "#3987e5", akzentHell: "#86b6ef",
    knopf: "#f59c00", knopfText: "#1a1a1a", grau: "#ffffff45",
  },
  hell: {
    dunkel: false,
    oben: "#ffffff", unten: "#e9f0fa", glanz: "#2a78d6",
    text: "#0b1b33", text2: "#52514e", text3: "#898781",
    karte: "#0c1c3a0d", spur: "#0c1c3a1a", akzent: "#2a78d6", akzentHell: "#6da7ec",
    knopf: "#f59c00", knopfText: "#1a1a1a", grau: "#0c1c3a33",
  },
};
const STATUS = { warnung: "#fab219", kritisch: "#d03b3b", kritischDunkel: "#ff6b6b", gut: "#0ca30c" };

function design() {
  let name = designWahl;
  if (name === "auto") {
    let dunkel = true;
    try { dunkel = Device.isUsingDarkAppearance(); } catch (e) { /* Standard: dunkel */ }
    name = dunkel ? "aldi" : "hell";
  }
  return DESIGNS[name] || DESIGNS.aldi;
}

/** Farbe aus "#rrggbb" oder "#rrggbbaa". */
function farbe(hex) {
  const h = hex.replace("#", "");
  if (h.length === 8) return new Color("#" + h.slice(0, 6), parseInt(h.slice(6), 16) / 255);
  return new Color("#" + h);
}

// ============================================================
//  Zugangsdaten (Keychain) und Login-Sperre
// ============================================================
async function getCredentials({ fragen = !IM_WIDGET } = {}) {
  if (Keychain.contains(K_USER) && Keychain.contains(K_PASS)) {
    return { user: Keychain.get(K_USER), pass: Keychain.get(K_PASS) };
  }
  if (!fragen) return null;

  const a = new Alert();
  a.title = t("login_titel");
  a.message = t("login_text");
  a.addTextField(t("login_user"));
  a.addSecureTextField(t("login_pass"));
  a.addAction(t("speichern"));
  a.addCancelAction(t("abbrechen"));
  if ((await a.presentAlert()) === -1) return null;
  const user = a.textFieldValue(0).trim();
  const pass = a.textFieldValue(1);
  if (!user || !pass) return null;
  Keychain.set(K_USER, user);
  Keychain.set(K_PASS, pass);
  hebeLoginSperreAuf();
  return { user, pass };
}

function vergissZugangsdaten() {
  if (Keychain.contains(K_USER)) Keychain.remove(K_USER);
  if (Keychain.contains(K_PASS)) Keychain.remove(K_PASS);
}

const SPERRE = "alditalk-loginfehler.json";
const loginSperreAktiv = () => fmFuer(SPERRE).fileExists(pfad(SPERRE));
const loginSperreText = () => liesJSON(SPERRE, {}).text || "";
const setzeLoginSperre = (text) => schreibJSON(SPERRE, { text, ts: Date.now() });
const hebeLoginSperreAuf = () => loesche(SPERRE);

// ============================================================
//  Land erkennen und Roaming
//  Quellen, in dieser Reihenfolge:
//   1. manuell festgelegtes Land (Einstellungen)
//   2. GPS-Standort + Ortsname von Apple (reverseGeocode)
//   3. Zeitzone des iPhones (iOS stellt sie bei der Einreise automatisch um,
//      z. B. Europe/Berlin -> Europe/Copenhagen) – klappt auch ohne GPS und offline
//   4. zuletzt bekanntes Land
//  Geprüft wird im Widget im eingestellten Abstand, sofort bei einem
//  Zeitzonenwechsel und in der App bei jedem Öffnen (höchstens alle 10 Minuten).
// ============================================================
const STANDORT = "alditalk-standort.json";
const LAENDERVERLAUF = "alditalk-laender.json";
const HEIMATLAND = "DE";
// EU + EWR (dort gilt EU-Roaming) inkl. Überseegebiete, die eigene Ländercodes haben.
const EU_LAENDER = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "GR", "HU", "IE", "IT", "LV", "LT",
  "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "AX", "GP", "MQ", "GF", "RE", "YT", "MF"];

// Ländernamen (für alle Länder in der Auswahl; sonst Intl.DisplayNames bzw. der Name von Apple).
const LAENDER = {
  DE: ["Deutschland", "Germany"], AT: ["Österreich", "Austria"], BE: ["Belgien", "Belgium"], BG: ["Bulgarien", "Bulgaria"],
  HR: ["Kroatien", "Croatia"], CY: ["Zypern", "Cyprus"], CZ: ["Tschechien", "Czechia"], DK: ["Dänemark", "Denmark"],
  EE: ["Estland", "Estonia"], FI: ["Finnland", "Finland"], FR: ["Frankreich", "France"], GR: ["Griechenland", "Greece"],
  HU: ["Ungarn", "Hungary"], IE: ["Irland", "Ireland"], IT: ["Italien", "Italy"], LV: ["Lettland", "Latvia"],
  LT: ["Litauen", "Lithuania"], LU: ["Luxemburg", "Luxembourg"], MT: ["Malta", "Malta"], NL: ["Niederlande", "Netherlands"],
  PL: ["Polen", "Poland"], PT: ["Portugal", "Portugal"], RO: ["Rumänien", "Romania"], SK: ["Slowakei", "Slovakia"],
  SI: ["Slowenien", "Slovenia"], ES: ["Spanien", "Spain"], SE: ["Schweden", "Sweden"], IS: ["Island", "Iceland"],
  LI: ["Liechtenstein", "Liechtenstein"], NO: ["Norwegen", "Norway"], AX: ["Åland", "Åland"],
  GP: ["Guadeloupe", "Guadeloupe"], MQ: ["Martinique", "Martinique"], GF: ["Französisch-Guayana", "French Guiana"],
  RE: ["Réunion", "Réunion"], YT: ["Mayotte", "Mayotte"], MF: ["Saint-Martin", "Saint Martin"],
  CH: ["Schweiz", "Switzerland"], GB: ["Vereinigtes Königreich", "United Kingdom"], TR: ["Türkei", "Türkiye"],
  US: ["USA", "United States"], MC: ["Monaco", "Monaco"], AD: ["Andorra", "Andorra"], SM: ["San Marino", "San Marino"],
  VA: ["Vatikanstadt", "Vatican City"], GI: ["Gibraltar", "Gibraltar"], RS: ["Serbien", "Serbia"],
  BA: ["Bosnien und Herzegowina", "Bosnia and Herzegovina"], ME: ["Montenegro", "Montenegro"], AL: ["Albanien", "Albania"],
  MK: ["Nordmazedonien", "North Macedonia"], MD: ["Moldau", "Moldova"], UA: ["Ukraine", "Ukraine"],
  FO: ["Färöer", "Faroe Islands"], GL: ["Grönland", "Greenland"], EG: ["Ägypten", "Egypt"], MA: ["Marokko", "Morocco"],
  TN: ["Tunesien", "Tunisia"], AE: ["Vereinigte Arabische Emirate", "United Arab Emirates"], TH: ["Thailand", "Thailand"],
  CA: ["Kanada", "Canada"],
};
// Länder für die manuelle Auswahl außerhalb der EU (häufige Reiseziele).
const ANDERE_LAENDER = ["CH", "GB", "TR", "MC", "AD", "SM", "RS", "BA", "ME", "AL", "MK", "FO", "GL", "EG", "MA", "TN", "AE", "TH", "US", "CA"];

// iOS-Zeitzone -> Land. Nur eindeutige Zonen; z. B. Europe/Berlin = DE, Europe/Copenhagen = DK.
const ZEITZONEN = {
  "Europe/Berlin": "DE", "Europe/Busingen": "DE", "Europe/Vienna": "AT", "Europe/Brussels": "BE", "Europe/Sofia": "BG",
  "Europe/Zagreb": "HR", "Asia/Nicosia": "CY", "Asia/Famagusta": "CY", "Europe/Nicosia": "CY", "Europe/Prague": "CZ",
  "Europe/Copenhagen": "DK", "Europe/Tallinn": "EE", "Europe/Helsinki": "FI", "Europe/Mariehamn": "AX", "Europe/Paris": "FR",
  "Europe/Athens": "GR", "Europe/Budapest": "HU", "Europe/Dublin": "IE", "Europe/Rome": "IT", "Europe/Riga": "LV",
  "Europe/Vilnius": "LT", "Europe/Luxembourg": "LU", "Europe/Malta": "MT", "Europe/Amsterdam": "NL", "Europe/Warsaw": "PL",
  "Europe/Lisbon": "PT", "Atlantic/Madeira": "PT", "Atlantic/Azores": "PT", "Europe/Bucharest": "RO",
  "Europe/Bratislava": "SK", "Europe/Ljubljana": "SI", "Europe/Madrid": "ES", "Atlantic/Canary": "ES", "Africa/Ceuta": "ES",
  "Europe/Stockholm": "SE", "Atlantic/Reykjavik": "IS", "Europe/Vaduz": "LI", "Europe/Oslo": "NO", "Arctic/Longyearbyen": "NO",
  "America/Guadeloupe": "GP", "America/Martinique": "MQ", "America/Cayenne": "GF", "Indian/Reunion": "RE",
  "Indian/Mayotte": "YT", "America/Marigot": "MF",
  "Europe/Zurich": "CH", "Europe/London": "GB", "Europe/Istanbul": "TR", "Europe/Monaco": "MC", "Europe/Andorra": "AD",
  "Europe/San_Marino": "SM", "Europe/Vatican": "VA", "Europe/Gibraltar": "GI", "Europe/Belgrade": "RS",
  "Europe/Sarajevo": "BA", "Europe/Podgorica": "ME", "Europe/Tirane": "AL", "Europe/Skopje": "MK", "Europe/Chisinau": "MD",
  "Europe/Kiev": "UA", "Europe/Kyiv": "UA", "Atlantic/Faroe": "FO", "America/Nuuk": "GL", "America/Godthab": "GL",
  "Africa/Cairo": "EG", "Africa/Casablanca": "MA", "Africa/Tunis": "TN", "Asia/Dubai": "AE", "Asia/Bangkok": "TH",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US",
  "America/Phoenix": "US", "America/Anchorage": "US", "Pacific/Honolulu": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA",
};

let standort = liesJSON(STANDORT, null);
let standortBereit = Promise.resolve(standort); // wird beim Start durch die laufende Prüfung ersetzt

function geraeteZeitzone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
}

function landName(code) {
  if (!code) return "";
  if (LAENDER[code]) return LAENDER[code][L === "de" ? 0 : 1];
  try {
    const n = new Intl.DisplayNames([L], { type: "region" }).of(code);
    if (n && n !== code) return n;
  } catch (e) { /* ältere iOS-Version */ }
  return (standort && standort.land === code && standort.name) || code;
}

function zone(code) {
  if (!code || code === HEIMATLAND) return "inland";
  return EU_LAENDER.includes(code) ? "eu" : "welt";
}

/** Muss der Standort neu geprüft werden? */
function standortFaellig() {
  if (!standort || !standort.ts) return true;
  const tz = geraeteZeitzone();
  if (tz && standort.tz && tz !== standort.tz) return true; // Zeitzone gewechselt -> wohl in ein anderes Land
  const alter = Date.now() - standort.ts;
  // Nach einem GPS-Fehlschlag frühestens nach 1 Stunde (bzw. dem Intervall, wenn kürzer) neu versuchen.
  if (standort.quelle !== "gps") return alter >= Math.min(3600 * 1000, einstellungen.landIntervall * 60000);
  if (einstellungen.landIntervall >= 1440) return standort.tag !== tagSchluessel(Date.now());
  return alter >= einstellungen.landIntervall * 60000;
}

/** Land bestimmen (GPS, sonst Zeitzone, sonst zuletzt bekannt) und merken. */
async function pruefeStandort({ erzwingen = false } = {}) {
  if (!erzwingen && !standortFaellig()) return standort;
  const tz = geraeteZeitzone();
  const tzLand = ZEITZONEN[tz] || null;
  let gpsLand = null, name = "", fehler = null, genau = null;
  try {
    Location.setAccuracyToKilometer(); // fürs Land reicht das – schneller und spart Akku
    const pos = await mitZeitlimit(Location.current(), IM_WIDGET ? 7000 : 10000);
    genau = pos.horizontalAccuracy || null;
    const orte = await mitZeitlimit(Location.reverseGeocode(pos.latitude, pos.longitude, L), 6000);
    const ort = (orte && orte[0]) || {};
    gpsLand = String(ort.isoCountryCode || "").toUpperCase() || null;
    name = ort.country || "";
    if (!gpsLand) throw new Error(t("f_land"));
  } catch (e) {
    fehler = String(e.message || e).slice(0, 100);
    console.error("Standort: " + fehler);
  }
  const land = gpsLand || tzLand;
  if (land) {
    standort = {
      land, name: gpsLand ? name : "", quelle: gpsLand ? "gps" : "zeitzone",
      ts: Date.now(), tag: tagSchluessel(Date.now()), tz, gpsLand, tzLand, genau,
      fehler: gpsLand ? null : fehler,
    };
    merkeLand(standort);
  } else {
    // Weder GPS noch Zeitzone: letztes bekanntes Land behalten.
    standort = Object.assign({}, standort || {}, { quelle: standort && standort.land ? "alt" : "keine", fehler, fehlTs: Date.now(), tz });
    if (!standort.ts) standort.ts = Date.now();
  }
  schreibJSON(STANDORT, standort);
  return standort;
}

/** Länderwechsel für den Verlauf merken (die letzten 30). */
function merkeLand(s) {
  const verlauf = liesJSON(LAENDERVERLAUF, []);
  const letzter = verlauf[verlauf.length - 1];
  if (letzter && letzter.land === s.land) return;
  verlauf.push({ land: s.land, ts: s.ts, quelle: s.quelle });
  schreibJSON(LAENDERVERLAUF, verlauf.slice(-30));
}

function mitZeitlimit(versprechen, ms) {
  return new Promise((ok, fehler) => {
    const tm = Timer.schedule(ms, false, () => fehler(new Error(t("f_zeit"))));
    versprechen.then((w) => { tm.invalidate(); ok(w); }, (e) => { tm.invalidate(); fehler(e); });
  });
}

/** Aktuelles Land: manuell festgelegt oder erkannt. */
function aktuellesLand() {
  if (einstellungen.landManuell) return { land: einstellungen.landManuell, quelle: "manuell" };
  if (standort && standort.land) return { land: standort.land, quelle: standort.quelle };
  return { land: null, quelle: "keine" };
}

/** Ob gerade Roaming gezeigt wird – aus Einstellung bzw. Widget-Parameter und Land. */
function roamingLage() {
  const { land, quelle } = aktuellesLand();
  const imAusland = !!(land && land !== HEIMATLAND);
  if (roamingWahl === "aus") return { aktiv: false, land, quelle };
  if (roamingWahl === "an") {
    return { aktiv: true, manuell: true, land: imAusland ? land : null, quelle,
      landName: imAusland ? landName(land) : "", eu: imAusland ? EU_LAENDER.includes(land) : true };
  }
  if (!imAusland) return { aktiv: false, land, quelle };
  return { aktiv: true, land, quelle, landName: landName(land), eu: EU_LAENDER.includes(land) };
}

/** Flaggen-Emoji aus dem Ländercode ("ES" -> 🇪🇸). */
function flagge(land) {
  if (!/^[A-Z]{2}$/.test(land || "")) return "🌍";
  return String.fromCodePoint(...[...land].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * Ist ein Datenpaket ein Roaming-Paket? (Rückfall, wenn ALDI TALK keine countryGroup liefert.)
 * Erst eindeutige Felder, dann jedes andere Textfeld mit "Roaming", dann Name/Beschreibung
 * von Paket und Angebot. "inkl. EU-Roaming" im Tarifnamen zählt NICHT als Roaming-Paket.
 * Wichtig: Das EU-Roaming-Volumen ist ein eigener Zähler (Fair-Use-Grenze) – es darf nie
 * zum Inlandsvolumen dazugezählt werden.
 */
function istRoamingPaket(p, offer) {
  if (p.roaming === true || p.isRoaming === true || p.roamingPack === true) return true;
  const zoneText = String(p.zone || p.region || p.area || p.usageArea || "").toLowerCase();
  if (zoneText && /roaming|eu|ausland|international|world|abroad/.test(zoneText)) return true;
  const textFelder = ["name", "packName", "description"];
  for (const [k, v] of Object.entries(p)) {
    if (!textFelder.includes(k) && typeof v === "string" && /roaming/i.test(v)) return true;
  }
  const passt = (text) => !/inkl|inklusive|incl/i.test(text)
    && (/roaming|ausland|international|world|weltweit/i.test(text) || /(^|[^a-zäöü])eu([^a-zäöü]|$)/i.test(text));
  if (passt(textFelder.map((k) => p[k]).filter(Boolean).join(" "))) return true;
  // Eigenes Angebot "Roaming EU", dessen Paket nur "Datenvolumen" heißt.
  return !!offer && passt([offer.offerName, offer.name, offer.description].filter(Boolean).join(" "));
}

/** Antwort des Portals ohne persönliche Daten (Nummern, IDs, Namen, Guthaben) – zum Weitergeben bei Fehlern. */
function anonymisiere(wert, schluessel = "") {
  if (/msisdn|phone|rufnummer|contract|customer|kunde|iban|mail|adress|address|firstname|lastname|balance|guthaben|^id$|token/i.test(schluessel)) return "…";
  if (Array.isArray(wert)) return wert.map((w) => anonymisiere(w));
  if (wert && typeof wert === "object") {
    const neu = {};
    for (const [k, v] of Object.entries(wert)) neu[k] = anonymisiere(v, k);
    return neu;
  }
  if (typeof wert === "string") return wert.replace(/\d{7,}/g, "…");
  return wert;
}

/** Gilt ein Eintrag aus unlimitedUsage.includedDataVolume fürs Ausland? ("euOnly", "Roaming EU") */
function istRoamingGruppe(g) {
  const text = [g.countryGroup, g.countryGroupLabel, g.allowanceParameter].filter(Boolean).join(" ");
  if (/germany|inland|domestic/i.test(String(g.countryGroup || "") + " " + String(g.countryGroupLabel || ""))) return false;
  return /eu|roaming|fup|world|international|ausland/i.test(text);
}

/** Datenpakete zu einem Wert zusammenfassen (Ablauf: das des größten Pakets). */
function summiere(pakete) {
  if (!pakete.length) return null;
  const unbegrenzt = pakete.some((p) => p.unbegrenzt);
  const haupt = pakete.slice().sort((a, b) => b.total - a.total)[0];
  return {
    left: unbegrenzt ? Infinity : pakete.reduce((s, p) => s + p.left, 0),
    total: unbegrenzt ? Infinity : pakete.reduce((s, p) => s + p.total, 0),
    unbegrenzt,
    expires: haupt.expires,
  };
}

// ============================================================
//  Daten holen (mit Cache je Vertrag)
// ============================================================
const cacheName = () => `alditalk-cache-${vertragIndex}.json`;
const verlaufName = (ansicht) => `alditalk-verlauf-${vertragIndex}${ansicht === "roaming" ? "-roaming" : ""}.json`;

function forceRefresh() { loesche(cacheName()); }

async function holeDaten({ erzwingen = false } = {}) {
  // Die Standortprüfung läuft parallel zum Login; erst fürs Auswerten wird auf sie gewartet.
  const fertig = async (d) => { await standortBereit; return ergaenze(d); };
  const cache = liesJSON(cacheName(), null);
  // Daten einer älteren Version neu holen – sie hat die Pakete evtl. anders ausgewertet.
  const frisch = cache && cache.ts && cache.version === VERSION && (Date.now() - cache.ts) < einstellungen.cacheMin * 60 * 1000;
  if (frisch && !erzwingen) return fertig({ ...cache, stale: false });

  // Zugangsdaten wurden abgelehnt: NICHT weiter probieren (Kontosperre!).
  if (loginSperreAktiv() && IM_WIDGET) {
    const hinweis = t("f_zugangsdaten_abgelehnt");
    return cache ? fertig({ ...cache, stale: true, hinweis }) : { error: hinweis, zugangsdaten: true };
  }

  const creds = await getCredentials();
  if (!creds) {
    const hinweis = t("f_kein_login");
    return cache ? fertig({ ...cache, stale: true, hinweis }) : { error: hinweis };
  }

  try {
    const live = await fetchLive(creds);
    live.ts = Date.now();
    live.version = VERSION;
    merkeZeitraum(cache, live);
    merkeAufladung(cache, live);
    schreibJSON(cacheName(), live);
    hebeLoginSperreAuf();
    merkeVerlauf(live, "inland");
    if (live.roaming) merkeVerlauf(live.roaming, "roaming");
    return fertig({ ...live, stale: false });
  } catch (e) {
    console.error(e);
    if (e.zugangsdaten) setzeLoginSperre(e.message);
    const kurz = String(e.message || e).slice(0, 120);
    const hinweis = e.zugangsdaten ? t("f_zugangsdaten_abgelehnt") : kurz;
    return cache ? fertig({ ...cache, stale: true, hinweis }) : { error: kurz, zugangsdaten: !!e.zugangsdaten };
  }
}

/** Abgeleitete Werte: Roaming-Ansicht, Status, Resttage, Tagesbudget, Verbrauch, Prognose. */
function ergaenze(d) {
  if (d.error) return d;
  const lage = roamingLage();
  d.ansicht = "inland";
  d.roamingLage = lage;
  d.inland = { left: d.left, total: d.total, unbegrenzt: d.unbegrenzt, expires: d.expires };
  // Die Schätzung gilt nur in der EU – außerhalb gibt es kein Inklusiv-Volumen.
  if (lage.aktiv && d.roaming && d.roaming.geschaetzt && !lage.eu) d.roaming = null;
  if (lage.aktiv) {
    if (d.roaming) {
      Object.assign(d, { left: d.roaming.left, total: d.roaming.total, unbegrenzt: d.roaming.unbegrenzt, expires: d.roaming.expires });
      d.ansicht = "roaming";
    }
    d.roamingHinweis = !lage.eu ? t("hinweis_nicht_eu")
      : !d.roaming ? t("hinweis_normal")
      : d.roaming.geschaetzt ? t("hinweis_geschaetzt") : "";
  }
  const werte = (x) => {
    const pct = x.unbegrenzt ? 1 : (x.total > 0 ? Math.max(0, Math.min(1, x.left / x.total)) : 0);
    const status = x.unbegrenzt ? "gut"
      : (x.left <= 0 ? "leer" : x.left <= einstellungen.warnGB ? "kritisch" : pct < 0.33 ? "warnung" : "gut");
    return { pct, status };
  };
  Object.assign(d, werte(d));
  const tage = resttage(d.expires);
  d.resttage = tage;
  d.tagesbudget = (!d.unbegrenzt && tage !== null && tage > 0) ? Math.max(0, d.left) / tage : null;
  const verlauf = liesJSON(verlaufName(d.ansicht), []);
  d.tageVerbrauch = tagesVerbrauch(verlauf, 14);
  d.prognose = d.unbegrenzt ? null : prognose(verlauf, d);
  // Beide Ansichten für den Umschalter in der Übersicht.
  d.ansichten = { inland: { ...d.inland, ...werte(d.inland) } };
  if (d.roaming) d.ansichten.roaming = { ...d.roaming, ...werte(d.roaming) };
  d.zeitraeume = liesJSON(zeitraeumeName(), []);
  d.tarifCheck = tarifCheck(d.zeitraeume);
  // Tagesbudget-Ampel: Budget für heute = (Rest + heute schon verbraucht) / Resttage
  d.heuteGB = d.tageVerbrauch.length ? d.tageVerbrauch[d.tageVerbrauch.length - 1].gb : 0;
  d.budgetHeute = !d.unbegrenzt && tage !== null ? (Math.max(0, d.left) + d.heuteGB) / Math.max(1, tage) : null;
  d.ampel = d.budgetHeute ? (d.heuteGB >= d.budgetHeute ? "rot" : d.heuteGB >= 0.8 * d.budgetHeute ? "gelb" : "gruen") : null;
  d.tageszeit = tageszeitVerbrauch(verlauf);
  d.aufladungen = liesJSON(aufladungenName(), []);
  return d;
}

// Ampelfarben (gelb wie STATUS.warnung)
const AMPEL = { gruen: "#34c759", gelb: "#fab219", rot: "#ff6b6b" };

/** Verbrauch nach Tageszeit (Nacht, Vormittag, Nachmittag, Abend) aus dem Verlauf – erst ab 3 Tagen. */
function tageszeitVerbrauch(verlauf) {
  if (verlauf.length < 2 || verlauf[verlauf.length - 1].t - verlauf[0].t < 3 * 86400000) return null;
  const gb = [0, 0, 0, 0];
  for (let i = 1; i < verlauf.length; i++) {
    const diff = verlauf[i - 1].left - verlauf[i].left, spanne = verlauf[i].t - verlauf[i - 1].t;
    if (diff <= 0 || spanne > 3 * 3600 * 1000) continue; // lange Lücken lassen sich keiner Tageszeit zuordnen
    gb[Math.floor(new Date(verlauf[i - 1].t + spanne / 2).getHours() / 6)] += diff;
  }
  const summe = gb.reduce((a, b) => a + b, 0);
  if (summe < 0.2) return null;
  const anteile = gb.map((x) => Math.round(x / summe * 100));
  return { gb, anteile, top: anteile.indexOf(Math.max(...anteile)) };
}

const aufladungenName = () => `alditalk-aufladungen-${vertragIndex}.json`;
/** Guthaben gestiegen? Dann als Aufladung merken. */
function merkeAufladung(alt, neu) {
  const a = alt && Number(alt.guthaben), n = Number(neu.guthaben);
  if (!alt || !isFinite(a) || !isFinite(n) || n - a < 1) return;
  const liste = liesJSON(aufladungenName(), []);
  liste.push({ ts: Date.now(), betrag: Math.round((n - a) * 100) / 100, guthaben: n });
  schreibJSON(aufladungenName(), liste.slice(-50));
}

/** Name einer Rufnummer: eigener Name aus den Einstellungen oder die letzten vier Ziffern. */
function vertragName(label) {
  const eigen = (einstellungen.vertragNamen || {})[label];
  if (eigen) return eigen;
  const ziffern = String(label || "").replace(/\D/g, "");
  return ziffern.length >= 6 ? "…" + ziffern.slice(-4) : String(label || "");
}

// ============================================================
//  Rückblick je Zeitraum und Tarif-Check
// ============================================================
const zeitraeumeName = () => `alditalk-zeitraeume-${vertragIndex}.json`;

/**
 * Hat sich der Tarif verlängert (Vertragsende um mindestens eine Woche nach hinten gerückt)?
 * Dann den abgelaufenen Zeitraum festhalten. Der Verbrauch kommt aus dem Verlauf (alle
 * Abnahmen des Restvolumens) – so zählt auch, was aus Gratis- oder Zusatzvolumen kam.
 */
function merkeZeitraum(alt, neu) {
  if (!alt || !alt.vertragsEnde || !neu.vertragsEnde || alt.vertragsEnde === neu.vertragsEnde || alt.unbegrenzt) return;
  const altEnde = parseDatum(alt.vertragsEnde), neuEnde = parseDatum(neu.vertragsEnde);
  if (!altEnde || !neuEnde || neuEnde.getTime() - altEnde.getTime() < 7 * 86400000) return;
  const liste = liesJSON(zeitraeumeName(), []);
  if (liste.some((z) => z.bis === alt.vertragsEnde)) return;
  const vorher = liste[liste.length - 1];
  const vorherEnde = vorher && parseDatum(vorher.bis);
  const start = vorherEnde ? vorherEnde.getTime() : altEnde.getTime() - 28 * 86400000;
  const verlauf = liesJSON(verlaufName("inland"), []).filter((e) => e.t >= start - 86400000);
  let verbraucht = 0;
  for (let i = 1; i < verlauf.length; i++) if (verlauf[i].t > start) verbraucht += Math.max(0, verlauf[i - 1].left - verlauf[i].left);
  liste.push({
    bis: alt.vertragsEnde, tarif: alt.tarif || "", tarifGB: alt.tarifTotal || null, verbraucht: Math.round(verbraucht * 100) / 100,
    vollstaendig: verlauf.length > 1 && verlauf[0].t <= start + 2 * 86400000,
    guthabenVorher: alt.guthaben, guthabenNachher: neu.guthaben, neuBis: neu.vertragsEnde, neuGB: neu.tarifTotal || neu.total, ts: Date.now(),
  });
  schreibJSON(zeitraeumeName(), liste.slice(-12));
}

/** Passt der Tarif? Braucht mindestens zwei vollständig erfasste Zeiträume (die letzten drei zählen). */
function tarifCheck(liste) {
  const voll = (liste || []).filter((z) => z.vollstaendig && z.tarifGB > 0).slice(-3);
  if (voll.length < 2) return null;
  const avg = voll.reduce((summe, z) => summe + z.verbraucht, 0) / voll.length;
  const tarifGB = voll[voll.length - 1].tarifGB;
  const art = avg < tarifGB * 0.45 ? "kleiner" : avg > tarifGB * 0.9 ? "groesser" : "passt";
  return { art, avg, tarifGB, text: t("tarif_" + art, fmtGB(avg, true), fmtGB(tarifGB, true)) };
}

/** Heute deutlich mehr verbraucht als sonst? { heute, schnitt } – oder null (braucht 4 Tage Verlauf). */
function ungewoehnlicherVerbrauch(verlauf) {
  const mitternacht = new Date();
  mitternacht.setHours(0, 0, 0, 0);
  const m = mitternacht.getTime();
  const davor = verlauf.filter((e) => e.t < m && e.t >= m - 14 * 86400000);
  if (davor.length < 2) return null;
  const spanne = (davor[davor.length - 1].t - davor[0].t) / 86400000;
  const basis = davor[davor.length - 1];
  // Der letzte Wert vor Mitternacht muss vom Vortag sein, sonst zählt alter Verbrauch zu heute.
  if (spanne < 4 || m - basis.t > 12 * 3600 * 1000) return null;
  let summe = 0;
  for (let i = 1; i < davor.length; i++) summe += Math.max(0, davor[i - 1].left - davor[i].left);
  const schnitt = summe / spanne;
  const heuteListe = [basis, ...verlauf.filter((e) => e.t >= m)];
  let heute = 0;
  for (let i = 1; i < heuteListe.length; i++) heute += Math.max(0, heuteListe[i - 1].left - heuteListe[i].left);
  return heute >= 0.5 && heute >= 3 * schnitt && heute - schnitt >= 0.5 ? { heute, schnitt } : null;
}

// ============================================================
//  Portal: Login + Abfrage
// ============================================================
async function fetchLive(creds) {
  // Meist ist die Sitzung vom letzten Mal noch gültig – dann ganz ohne neuen Login
  // (schneller, und weniger Anmeldungen = weniger Risiko einer Kontosperre).
  let nav = await versucheJSON(BFF207 + "/v1/navigation-list");
  if (!nav || !nav.userDetails) {
    await anmelden(creds);
    nav = await versucheJSON(BFF207 + "/v1/navigation-list");
    if (!nav || !nav.userDetails) throw new Error(t("f_portal"));
  }

  const details = nav.userDetails || {};
  const subs = details.subscriptions || [];
  if (!subs.length) throw new Error(t("f_kein_vertrag"));
  const vertraege = subs.map((s, i) => ({
    label: s.msisdn || s.phoneNumber || s.rufnummer || s.alias || t("vertrag_n", i + 1),
    contractId: s.contractId,
  }));
  const index = Math.min(vertragIndex, subs.length - 1);
  const contractId = subs[index].contractId;

  const offers = await versucheJSON(BFF209 + "/v1/offers?contractId=" + encodeURIComponent(contractId) + "&productType=");
  if (!offers) throw new Error(t("f_tarifdaten"));
  try { schreibJSON(`alditalk-rohdaten-${vertragIndex}.json`, anonymisiere(offers)); } catch (e) { /* nur für die Fehlersuche */ }

  const pakete = [];
  const sonstige = [];
  let tarif = "";
  const gesehen = new Set();
  const datenPaket = (p, offer, roaming, gruppe, zusatz) => {
    const allocated = parseFloat(p.allocated);
    const used = parseFloat(p.used);
    const div = UNIT_TO_GB[String(p.unit || "kilobytes").toLowerCase()] || UNIT_TO_GB.kilobytes;
    const total = allocated / div;
    pakete.push({
      name: p.name || p.packName || (roaming && gruppe && gruppe.countryGroupLabel) || (offer && offer.offerName) || (roaming ? "Roaming" : "Datenvolumen"),
      total,
      left: (allocated - used) / div,
      expires: p.nextExpirationDate || p.expirationDate || (offer && (offer.nextExpirationDate || offer.expirationDate)) || "",
      unbegrenzt: p.unlimited === true || allocated < 0 || total >= 10000,
      roaming,
      zusatz: !!zusatz,
    });
  };
  // Volumen-Einheit (Bytes … GB) statt Minuten/SMS?
  const istVolumen = (p) => /data|daten/.test(String(p.type || "").toLowerCase()) || !!UNIT_TO_GB[String(p.unit || "").toLowerCase()];
  // Pakete eines Angebots (Tarif oder Zusatzangebot wie "Gratis-Volumen 25 GB").
  // ALDI TALK nennt unter unlimitedUsage.includedDataVolume für jedes Datenpaket – in derselben
  // Reihenfolge –, wo es gilt: countryGroup "germanyOnly" (Inland) oder "euOnly" (Roaming EU =
  // EU-Fair-Use-Grenze, ein eigener Zähler). Danach richtet sich, was Roaming ist.
  const nimmAngebot = (offer, zusatz) => {
    const gruppen = ((offer.unlimitedUsage || {}).includedDataVolume) || [];
    const datenPakete = (offer.pack || []).filter((p) => /data|daten/.test(String(p.type || "").toLowerCase()));
    const gruppenPassen = gruppen.length === datenPakete.length;
    for (const p of offer.pack || []) {
      gesehen.add(p);
      const typ = String(p.type || "").toLowerCase();
      const allocated = parseFloat(p.allocated);
      const used = parseFloat(p.used);
      if (isNaN(allocated) || isNaN(used)) continue;
      const gruppe = gruppenPassen ? gruppen[datenPakete.indexOf(p)] : null;
      const roaming = gruppe ? istRoamingGruppe(gruppe) : istRoamingPaket(p, offer);
      if (/data|daten/.test(typ) || (roaming && istVolumen(p))) {
        datenPaket(p, offer, roaming, gruppe, zusatz);
      } else if (typ === "voice" || typ === "sms" || typ === "minutes") {
        sonstige.push({
          typ: typ === "sms" ? "sms" : "minuten",
          left: Math.max(0, allocated - used) / (String(p.unit || "").toLowerCase() === "seconds" ? 60 : 1),
          total: allocated / (String(p.unit || "").toLowerCase() === "seconds" ? 60 : 1),
          unbegrenzt: p.unlimited === true || allocated < 0 || allocated >= 100000,
        });
      }
    }
  };
  for (const offer of offers.subscribedOffers || []) {
    if (!tarif && offer.offerName) tarif = offer.offerName;
    nimmAngebot(offer);
    for (const zusatz of offer.addOnsDetails || []) {
      if (!/inactive|terminated|expired/i.test(String(zusatz.status || ""))) nimmAngebot(zusatz, true);
    }
  }
  // Das Roaming-Volumen steht evtl. nicht bei den Paketen, sondern woanders in der Antwort.
  const durchsuche = (wert, kontext, offer, tiefe) => {
    if (!wert || typeof wert !== "object" || tiefe > 8) return;
    if (Array.isArray(wert)) { wert.forEach((w) => durchsuche(w, kontext, offer, tiefe + 1)); return; }
    const hier = kontext + " " + [wert.offerName, wert.name, wert.title, wert.displayName].filter((x) => typeof x === "string").join(" ");
    if (!gesehen.has(wert) && !isNaN(parseFloat(wert.allocated)) && !isNaN(parseFloat(wert.used))
      && istVolumen(wert) && (istRoamingPaket(wert, offer) || /roaming/i.test(hier))) {
      gesehen.add(wert);
      datenPaket(wert, offer, true);
    }
    for (const [k, v] of Object.entries(wert)) durchsuche(v, hier + " " + k, wert.offerName ? wert : offer, tiefe + 1);
  };
  durchsuche(offers, "", null, 0);
  if (!pakete.length) throw new Error(t("f_kein_paket"));

  // Alle Datenpakete zusammen (Tarif + nachgebuchte Pakete), Roaming-Pakete getrennt.
  // Sieht ALLES nach Roaming aus, war die Erkennung wohl falsch – dann zählt alles als Inland.
  let inlandPakete = pakete.filter((p) => !p.roaming);
  let roamingPakete = pakete.filter((p) => p.roaming);
  if (!inlandPakete.length) {
    pakete.forEach((p) => { p.roaming = false; });
    inlandPakete = pakete;
    roamingPakete = [];
  }
  // Kein eigener EU-Zähler: grob schätzen. Im EU-Ausland gelten etwa 2/3 des Tarifvolumens
  // (EU-Fair-Use); Gratis- und Zusatzvolumen zählen dort nicht.
  let roaming = summiere(roamingPakete);
  const tarifPakete = inlandPakete.filter((p) => !p.zusatz && !p.unbegrenzt);
  if (!roaming && tarifPakete.length) {
    const s = summiere(tarifPakete);
    const total = s.total * 2 / 3;
    roaming = { left: Math.min(total, s.left), total, unbegrenzt: false, expires: s.expires, geschaetzt: true };
  }
  // Tarif ohne Zusatz-/Gratis-Volumen: daran hängen Verlängerung und Rückblick.
  const tarifSumme = summiere(tarifPakete);
  return {
    name: details.firstName || "",
    tarif,
    guthaben: parseFloat(offers.totalBalance),
    tarifLeft: tarifSumme ? tarifSumme.left : null,
    tarifTotal: tarifSumme ? tarifSumme.total : null,
    vertragsEnde: (tarifSumme && tarifSumme.expires) || (summiere(inlandPakete) || {}).expires || "",
    ...summiere(inlandPakete),
    roaming,
    pakete: pakete.map((p) => ({ ...p, left: p.unbegrenzt ? null : p.left, total: p.unbegrenzt ? null : p.total })),
    sonstige,
    vertraege,
    vertragIndex: index,
  };
}

/**
 * Anmeldung am ALDI-TALK-Login (ForgeRock). Bei einem Fehler schickt ALDI TALK KEINE
 * Fehlermeldung, sondern das Formular erneut – mit Hinweistext (falsche Zugangsdaten,
 * Sperre) oder ohne (Rechenaufgabe nicht angenommen, dann noch einmal).
 */
async function anmelden(creds) {
  await req(OVERVIEW).loadString(); // Sitzung anstoßen
  let ergebnis = null;
  for (let versuch = 1; versuch <= 2; versuch++) {
    const r1 = req(AUTH_API, authHeaders());
    r1.method = "POST";
    r1.body = "{}";
    const schritt1 = await ladeJSON(r1, "Login-Seite");
    if (schritt1.successUrl) { ergebnis = schritt1; break; } // Sitzung war noch gültig
    if (!schritt1.authId || !schritt1.callbacks) throw new Error(t("f_login_unerwartet"));

    const pow = extractPow(schritt1.callbacks);
    const nonce = pow.work ? solvePow(pow.work, pow.difficulty) : "0";
    const callbacks = fillCallbacks(schritt1.callbacks, nonce, creds);

    const r2 = req(AUTH_API, authHeaders());
    r2.method = "POST";
    r2.body = JSON.stringify({ authId: schritt1.authId, callbacks });
    ergebnis = await ladeJSON(r2, "Login");
    if (ergebnis.successUrl) break;

    const hinweis = serverHinweis(ergebnis.callbacks);
    if (hinweis) {
      const fehler = new Error(hinweis);
      fehler.zugangsdaten = true;
      throw fehler;
    }
    if (ergebnis.message) throw new Error(ergebnis.message);
  }
  if (!ergebnis || !ergebnis.successUrl) throw new Error(t("f_login_ohne"));
  const ziel = ergebnis.successUrl.startsWith("http") ? ergebnis.successUrl : AUTH + ergebnis.successUrl;
  await req(ziel).loadString();     // OIDC-Weiterleitungen abschließen
  await req(OVERVIEW).loadString();
}

/** Hinweistext im zurückgeschickten Login-Formular, verständlich formuliert. Leer, wenn es keinen gibt. */
function serverHinweis(callbacks) {
  for (const cb of callbacks || []) {
    if (cb.type !== "TextOutputCallback") continue;
    const out = (cb.output || []).find((o) => o.name === "message");
    const msg = out ? String(out.value || "") : "";
    if (!msg || msg.indexOf("function ") === 0 || msg.indexOf("var ") >= 0) continue; // Rechenaufgabe
    if (/accountLock|locked|gesperrt/i.test(msg)) return t("f_gesperrt");
    if (/password|passwort|credential|invalid/i.test(msg)) return t("f_passwort");
    return t("f_login_abgelehnt", msg.replace(/^custom\.alditalk\.[^$]*\$/, "").replace(/custom\.alditalk\./g, ""));
  }
  return "";
}

function req(url, extra) {
  const r = new Request(url);
  r.timeoutInterval = ZEIT_LIMIT_S;
  r.headers = Object.assign({
    "User-Agent": UA,
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  }, extra || {});
  return r;
}

/** JSON laden; bei HTML (Wartungsseite, Login-Umleitung) eine verständliche Meldung. */
async function ladeJSON(r, was) {
  const text = await r.loadString();
  try {
    return JSON.parse(text);
  } catch (e) {
    if (/wartung/i.test(text)) throw new Error(t("f_wartung"));
    throw new Error(t("f_unerwartet", was));
  }
}

/** JSON einer Portal-Schnittstelle – null, wenn (noch) nicht angemeldet oder keine JSON-Antwort. */
async function versucheJSON(url) {
  try {
    const r = req(url, { "Accept": "application/json, text/plain, */*", "Referer": OVERVIEW });
    const text = await r.loadString();
    const status = r.response && r.response.statusCode;
    if (status && status >= 400) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function authHeaders() {
  return {
    "Accept-API-Version": "protocol=1.0,resource=2.1",
    "Content-Type": "application/json",
    "X-Username": "anonymous",
    "X-Password": "anonymous",
    "X-NoSession": "true",
    "Origin": AUTH,
    "Referer": AUTH + "/signin/XUI/",
  };
}

// --- Proof of Work (SHA-1) -----------------------------------
function extractPow(callbacks) {
  for (const cb of callbacks) {
    if (cb.type !== "TextOutputCallback") continue;
    const out = (cb.output || []).find((o) => o.name === "message");
    const msg = out ? out.value || "" : "";
    const w = msg.match(/var work\s*=\s*"([^"]+)"/);
    if (w) {
      const d = msg.match(/var difficulty\s*=\s*(\d+)/);
      return { work: w[1], difficulty: d ? parseInt(d[1], 10) : 3 };
    }
  }
  return { work: null, difficulty: 3 };
}

function solvePow(work, difficulty) {
  const prefix = "0".repeat(difficulty);
  for (let n = 0; n < 5000000; n++) {
    if (sha1(work + n).startsWith(prefix)) return String(n);
  }
  throw new Error(t("f_pow"));
}

function fillCallbacks(callbacks, nonce, creds) {
  for (const cb of callbacks) {
    const inputs = cb.input || [];
    const outputs = cb.output || [];
    if (cb.type === "HiddenValueCallback") {
      const isPow = outputs.some((o) => o.name === "id" && o.value === "proofOfWorkNonce");
      if (isPow) { inputs.forEach((i) => (i.value = nonce)); continue; }
      const fb = outputs.find((o) => o.name === "value");
      if (fb) inputs.forEach((i) => (i.value = fb.value));
    } else if (cb.type === "NameCallback") {
      inputs.forEach((i) => (i.value = creds.user));
    } else if (cb.type === "PasswordCallback") {
      inputs.forEach((i) => (i.value = creds.pass));
    } else if (cb.type === "ConfirmationCallback") {
      // Knopf "Anmelden" über seinen Namen suchen statt fest Nummer 2.
      const opt = outputs.find((o) => o.name === "options");
      const liste = opt && Array.isArray(opt.value) ? opt.value : [];
      const idx = liste.findIndex((v) => /loginbtn$/.test(v));
      inputs.forEach((i) => (i.value = idx >= 0 ? idx : 2));
    }
  }
  return callbacks;
}

function sha1(str) {
  const b = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) b.push(c);
    else if (c < 0x800) b.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  const ml = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  for (let i = 7; i >= 0; i--) b.push(Math.floor(ml / Math.pow(2, i * 8)) & 0xff);
  const rotl = (n, s) => (n << s) | (n >>> (32 - s));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array(80);
  for (let i = 0; i < b.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = (b[i + 4 * j] << 24) | (b[i + 4 * j + 1] << 16) | (b[i + 4 * j + 2] << 8) | b[i + 4 * j + 3];
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) { f = (bb & c) | (~bb & d); k = 0x5a827999; }
      else if (j < 40) { f = bb ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = bb ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (rotl(a, 5) + f + e + k + w[j]) | 0;
      e = d; d = c; c = rotl(bb, 30); bb = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

// ============================================================
//  Verlauf, Tagesverbrauch, Prognose
// ============================================================
function merkeVerlauf(d, ansicht) {
  if (d.unbegrenzt) return;
  const verlauf = liesJSON(verlaufName(ansicht), []);
  const letzter = verlauf[verlauf.length - 1];
  const jetzt = Date.now();
  // Nur speichern, wenn sich etwas geändert hat oder eine Stunde vergangen ist.
  if (letzter && Math.abs(letzter.left - d.left) < 0.0005 && jetzt - letzter.t < 3600 * 1000) return;
  verlauf.push({ t: jetzt, left: d.left, total: d.total });
  const grenze = jetzt - VERLAUF_TAGE * 86400000;
  schreibJSON(verlaufName(ansicht), verlauf.filter((e) => e.t >= grenze));
}

function tagSchluessel(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/**
 * Verbrauch je Kalendertag (GB) der letzten `tage` Tage, geschätzt aus den Abfragen:
 * jede Abnahme des Restvolumens zählt zum Tag der Abfrage. Zunahmen (Nachbuchen,
 * neuer Monat) werden ignoriert. Tage ohne Abfrage bekommen 0 – der Verbrauch landet
 * dann beim nächsten Tag mit Abfrage.
 */
function tagesVerbrauch(verlauf, tage) {
  const proTag = {};
  for (let i = 1; i < verlauf.length; i++) {
    const diff = verlauf[i - 1].left - verlauf[i].left;
    if (diff > 0) {
      const k = tagSchluessel(verlauf[i].t);
      proTag[k] = (proTag[k] || 0) + diff;
    }
  }
  const ergebnis = [];
  const heute = new Date();
  heute.setHours(12, 0, 0, 0);
  for (let i = tage - 1; i >= 0; i--) {
    const ts = heute.getTime() - i * 86400000;
    const k = tagSchluessel(ts);
    ergebnis.push({ tag: k, t: ts, gb: proTag[k] || 0, heute: i === 0 });
  }
  return ergebnis;
}

/** Durchschnittsverbrauch der letzten 7 Tage und wann das Volumen leer wäre. */
function prognose(verlauf, d) {
  const grenze = Date.now() - 7 * 86400000;
  const teil = verlauf.filter((e) => e.t >= grenze);
  if (teil.length < 2) return null;
  const spanneTage = (teil[teil.length - 1].t - teil[0].t) / 86400000;
  if (spanneTage < 0.5) return null; // zu wenig Daten für eine Aussage
  let summe = 0;
  for (let i = 1; i < teil.length; i++) summe += Math.max(0, teil[i - 1].left - teil[i].left);
  const proTag = summe / Math.max(1, spanneTage);
  if (proTag <= 0.0005) return { proTag: 0, reicht: true, leerAm: null };
  const tageBisLeer = Math.max(0, d.left) / proTag;
  const leerAm = Date.now() + tageBisLeer * 86400000;
  const ende = parseDatum(d.expires);
  return { proTag, leerAm, reicht: !ende || leerAm >= ende.getTime() };
}

// ============================================================
//  Mitteilungen
// ============================================================
async function pruefeWarnungen(d) {
  if (!einstellungen.mitteilungen || d.error || d.stale) return;
  // Je Rufnummer ein eigener Merkzettel; das Land steht nur im ersten (gilt fürs iPhone, nicht je Vertrag).
  const hauptDatei = "alditalk-mitteilungen.json";
  const eigeneDatei = vertragIndex ? `alditalk-mitteilungen-${vertragIndex}.json` : hauptDatei;
  const haupt = liesJSON(hauptDatei, {});
  const zustand = vertragIndex ? liesJSON(eigeneDatei, {}) : haupt;
  const zeitraum = (d.ansicht === "roaming" ? "roaming-" : "") + (d.expires || "ohne");
  const wer = d.vertraege && d.vertraege.length > 1 && d.vertraege[d.vertragIndex] ? ` (${vertragName(d.vertraege[d.vertragIndex].label)})` : "";
  const schicke = async (id, titel, text) => {
    try {
      const n = new Notification();
      n.identifier = "alditalk-" + id + (vertragIndex ? "-" + vertragIndex : "");
      n.threadIdentifier = "alditalk";
      n.title = titel + (id === "land" ? "" : wer);
      n.body = text;
      n.openURL = skriptURL("dashboard");
      await n.schedule();
    } catch (e) { console.error(e); }
  };
  // Neues Land: einmal sagen, was dort gilt.
  const lage = d.roamingLage || {};
  const land = lage.land || (lage.aktiv ? null : HEIMATLAND);
  if (land && haupt.land && haupt.land !== land && land !== HEIMATLAND) {
    const art = d.ansicht === "roaming" ? t("roaming_volumen") : t("datenvolumen");
    const volumen = d.unbegrenzt ? t("n_unbegrenzt") : t("n_volumen_frei", fmtGB(d.left), art);
    await schicke("land", `ALDI TALK: ${flagge(land)} ${landName(land)}`,
      lage.eu ? t("n_land_eu", volumen) : t("n_land_welt", volumen) + " " + t("n_tipp_roaming"));
  }
  if (land) haupt.land = land;
  const art = d.ansicht === "roaming" ? t("roaming_volumen") : t("datenvolumen");
  if (!d.unbegrenzt && d.left <= einstellungen.warnGB && zustand.volumen !== zeitraum) {
    zustand.volumen = zeitraum;
    await schicke("volumen", t("n_fast_leer", art),
      t("n_nur_noch", fmtGB(d.left)) + (d.resttage !== null ? t("n_noch_laufzeit", d.resttage) : "."));
  }
  // Verlängerung richtet sich nach dem Tarif – nicht nach einem Roaming- oder Gratis-Paket.
  const vertragsEnde = d.vertragsEnde || (d.inland ? d.inland.expires : d.expires);
  const vertragTage = resttage(vertragsEnde);
  const vertragZeitraum = vertragsEnde || "ohne";
  if (vertragTage !== null && vertragTage <= 3 && !isNaN(d.guthaben) && d.guthaben < einstellungen.warnGuthaben && zustand.guthaben !== vertragZeitraum) {
    zustand.guthaben = vertragZeitraum;
    await schicke("guthaben", t("n_aufladen"), t("n_verlaengerung", vertragTage, fmtEuro(d.guthaben)));
  }
  if (d.prognose && !d.prognose.reicht && zustand.prognose !== zeitraum && d.status === "gut") {
    zustand.prognose = zeitraum;
    await schicke("prognose", t("n_knapp"), t("n_knapp_text", fmtGB(d.prognose.proTag), fmtDatum(d.prognose.leerAm)));
  }
  if (einstellungen.tipps) await pruefeTipps(d, zustand, schicke, vertragTage, vertragZeitraum);
  schreibJSON(eigeneDatei, zustand);
  if (vertragIndex) schreibJSON(hauptDatei, haupt);
}

/** Tipps: Tarif verlängert, Volumen bleibt übrig, heute ungewöhnlich viel verbraucht. */
async function pruefeTipps(d, zustand, schicke, vertragTage, vertragZeitraum) {
  const zahl = (x) => typeof x === "number" && isFinite(x);
  const zr = (d.zeitraeume || [])[(d.zeitraeume || []).length - 1];
  if (zr && zustand.verlaengert !== zr.bis && Date.now() - zr.ts < 3 * 86400000) {
    zustand.verlaengert = zr.bis;
    const weniger = zahl(zr.guthabenVorher) && zahl(zr.guthabenNachher) && zr.guthabenVorher - zr.guthabenNachher > 0.5
      ? fmtEuro(zr.guthabenVorher - zr.guthabenNachher) : "";
    await schicke("verlaengert", t("n_verlaengert"), t("n_verlaengert_text", fmtGB(zr.neuGB, true), fmtAblauf(zr.neuBis, false),
      zr.vollstaendig ? fmtGB(zr.verbraucht, true) : "", fmtEuro(zahl(zr.guthabenNachher) ? zr.guthabenNachher : d.guthaben), weniger));
  }
  // Kurz vor der Verlängerung noch viel Tarif-Volumen übrig (mehr, als der übliche Verbrauch braucht)
  if (d.ansicht === "inland" && !d.unbegrenzt && zahl(d.tarifLeft) && vertragTage !== null && vertragTage >= 1 && vertragTage <= 3
    && zustand.uebrig !== vertragZeitraum) {
    const erwartet = (d.prognose && d.prognose.proTag ? d.prognose.proTag : 0) * vertragTage;
    if (d.tarifLeft - erwartet >= 1 && d.tarifLeft >= 0.2 * (d.tarifTotal || 0)) {
      zustand.uebrig = vertragZeitraum;
      await schicke("uebrig", t("n_uebrig"), t("n_uebrig_text", fmtGB(d.tarifLeft, true), vertragTage, fmtGB(d.tarifLeft / vertragTage, true)));
    }
  }
  const heute = tagSchluessel(Date.now());
  if (einstellungen.budgetWarnung && d.ampel === "rot" && d.heuteGB >= 0.1 && zustand.budget !== heute) {
    zustand.budget = heute;
    await schicke("budget", t("n_budget"), t("n_budget_text", fmtGB(d.heuteGB), fmtGB(d.budgetHeute)));
  }
  if (!d.unbegrenzt && zustand.ungewoehnlich !== heute) {
    const u = ungewoehnlicherVerbrauch(liesJSON(verlaufName(d.ansicht), []));
    if (u) {
      zustand.ungewoehnlich = heute;
      await schicke("verbrauch", t("n_ungewoehnlich"), t("n_ungewoehnlich_text", fmtGB(u.heute, true), fmtGB(u.schnitt, true)));
    }
  }
}

// ============================================================
//  Erinnerung an die Verlängerung (Erinnerungen-App)
// ============================================================
const ERINNERUNG = "alditalk-erinnerung.json";

/** Trägt die nächste Verlängerung als Erinnerung ein – einmal je Zeitraum, die alte wird ersetzt. */
async function pflegeErinnerung(d, { melden = false } = {}) {
  if (!einstellungen.erinnerung || !d || d.error || typeof Reminder === "undefined") return;
  const ende = parseDatum(d.vertragsEnde);
  if (!ende) return;
  const gemerkt = liesJSON(ERINNERUNG, {});
  const alt = gemerkt[vertragIndex];
  if (alt && alt.ende === d.vertragsEnde && alt.tage === einstellungen.erinnerung && !melden) return;
  const faellig = new Date(ende.getTime() - einstellungen.erinnerung * 86400000);
  faellig.setHours(18, 0, 0, 0);
  try {
    if (alt && alt.id) await entferneErinnerung(alt.id);
    let id = "";
    if (faellig.getTime() > Date.now()) {
      const r = new Reminder();
      const wer = d.vertraege && d.vertraege.length > 1 && d.vertraege[d.vertragIndex] ? ` (${vertragName(d.vertraege[d.vertragIndex].label)})` : "";
      r.title = t("erinnerung_titel", fmtDatum(ende.getTime())) + wer;
      r.notes = t("erinnerung_notiz", fmtEuro(d.guthaben));
      r.dueDate = faellig;
      r.dueDateIncludesTime = true;
      r.save();
      id = r.identifier || "";
    }
    gemerkt[vertragIndex] = { ende: d.vertragsEnde, tage: einstellungen.erinnerung, id };
    schreibJSON(ERINNERUNG, gemerkt);
    if (melden && id) await hinweis(t("erinnerung"), t("erinnerung_ok", fmtDatum(faellig.getTime())));
  } catch (e) {
    console.error(e);
    if (melden) await hinweis(t("erinnerung"), t("erinnerung_fehler"));
  }
}

async function entferneErinnerung(id) {
  try {
    const r = (await Reminder.allIncomplete()).find((x) => x.identifier === id);
    if (r) r.remove();
  } catch (e) { /* schon erledigt oder kein Zugriff */ }
}

// ============================================================
//  Siri & Kurzbefehle
// ============================================================
/** Ein Satz zum Vorlesen: Volumen, Verlängerung, Prognose, Guthaben. */
function siriSatz(d) {
  if (d.error) return t("siri_fehler", d.error);
  const zahl = (x) => dezimal(Math.max(0, x), x >= 100 ? 0 : 1);
  const lage = d.roamingLage || {};
  let satz = d.unbegrenzt ? t("siri_unbegrenzt")
    : d.ansicht === "roaming" ? t("siri_roaming", lage.landName || landName(lage.land), zahl(d.left), zahl(d.total))
    : t("siri_volumen", zahl(d.left), zahl(d.total));
  if (lage.aktiv && !lage.eu) satz += " " + t("hinweis_nicht_eu") + ".";
  const tage = resttage(d.vertragsEnde || d.expires);
  if (tage !== null) satz += t("siri_verlaengerung", tage);
  if (!d.unbegrenzt && d.prognose && d.prognose.proTag > 0) satz += d.prognose.reicht ? t("siri_reicht") : t("siri_leer", fmtDatum(d.prognose.leerAm));
  if (!isNaN(d.guthaben)) satz += t("siri_guthaben", fmtEuro(d.guthaben));
  if (d.stale) satz += t("siri_stand", fmtRelativ(d.ts));
  return satz;
}

async function siriMenue(d) {
  const a = new Alert();
  a.title = t("m_siri");
  a.message = t("siri_anleitung");
  a.addAction(t("siri_probe"));
  a.addCancelAction(t("zurueck"));
  if ((await a.presentAlert()) !== 0) return;
  const satz = siriSatz(d);
  try { Speech.speak(satz); } catch (e) { /* ohne Ton */ }
  await hinweis(t("m_siri"), satz);
}

// ============================================================
//  Widgets
// ============================================================
function baueWidget(d, familie) {
  if (familie === "accessoryCircular") return sperrRund(d);
  if (familie === "accessoryRectangular") return sperrRechteck(d);
  if (familie === "accessoryInline") return sperrZeile(d);

  const D = design();
  const w = new ListWidget();
  const groesse = { small: [158, 158], medium: [338, 158], large: [338, 354], extraLarge: [715, 354] }[familie] || [158, 158];
  w.backgroundImage = hintergrundBild(D, groesse[0], groesse[1]);
  w.refreshAfterDate = new Date(Date.now() + einstellungen.cacheMin * 60 * 1000);

  if (d.error) {
    fehlerAnsicht(w, d, D);
    w.url = skriptURL("menu");
    return w;
  }
  if (familie === "small" && standbyWahl) standby(w, d, D);
  else if (familie === "small") klein(w, d, D);
  else if (familie === "medium") mittel(w, d, D);
  else gross(w, d, D);
  return w;
}

/** Daten aller Rufnummern des Kontos (bis zu 4) – nacheinander, die Anmeldung wird geteilt. */
async function holeAlle(jeVertrag) {
  const gewaehlt = vertragIndex;
  vertragIndex = 0;
  const erste = await holeDaten();
  const vertraege = erste.vertraege || [];
  const liste = [{ d: erste, label: vertraege[0] ? vertraege[0].label : "" }];
  if (jeVertrag) await jeVertrag(erste);
  for (let i = 1; i < Math.min(4, vertraege.length); i++) {
    vertragIndex = i;
    const d = await holeDaten();
    if (jeVertrag) await jeVertrag(d);
    liste.push({ d, label: vertraege[i].label });
  }
  vertragIndex = gewaehlt;
  return liste;
}

function alleWidget(liste, familie) {
  const D = design();
  const w = new ListWidget();
  const groesse = { small: [158, 158], medium: [338, 158], large: [338, 354], extraLarge: [715, 354] }[familie] || [158, 158];
  w.backgroundImage = hintergrundBild(D, groesse[0], groesse[1]);
  w.refreshAfterDate = new Date(Date.now() + einstellungen.cacheMin * 60 * 1000);
  w.url = skriptURL("menu");
  const erste = liste[0].d;
  if (erste.error) { fehlerAnsicht(w, erste, D); return w; }
  const klein = familie === "small";
  w.setPadding(14, 14, 12, 14);
  kopf(w, D, auslandTitel(erste) || "ALDI TALK", !klein && erste.name ? t("hallo", erste.name) : "");
  const gross = familie === "large" || familie === "extraLarge";
  // Groß mit höchstens zwei Nummern: Platz für den Tagesverbrauch je Nummer
  const mitDiagramm = gross && liste.length <= 2;
  for (const { d, label } of liste.slice(0, gross ? 4 : 2)) {
    w.addSpacer(klein ? 6 : mitDiagramm ? 12 : 8);
    vertragZeile(w, d, label, D, klein, groesse[0] - 28);
    if (mitDiagramm && !d.error && !d.unbegrenzt) {
      w.addSpacer(6);
      const max = Math.max(...d.tageVerbrauch.map((x) => x.gb));
      const zt = w.addText(t("verbrauch_pro_tag") + " · " + (max > 0 ? t("heute_gb", fmtGB(d.tageVerbrauch[d.tageVerbrauch.length - 1].gb)) : t("verlauf_sammelt")));
      zt.font = Font.systemFont(9);
      zt.textColor = farbe(D.text3);
      w.addSpacer(3);
      const bild = w.addImage(balkenBild(d.tageVerbrauch, d.tagesbudget, D, groesse[0] - 28, 64));
      bild.imageSize = new Size(groesse[0] - 28, 64);
    }
  }
  w.addSpacer();
  if (!klein) fussZeile(w, erste, D);
  return w;
}

function vertragZeile(w, d, label, D, klein, breite) {
  const z = w.addStack();
  z.centerAlignContent();
  const n = z.addText(vertragName(label) || "ALDI TALK");
  n.font = Font.semiboldRoundedSystemFont(klein ? 11 : 13);
  n.textColor = farbe(D.text);
  n.lineLimit = 1;
  z.addSpacer(4);
  if (!d.error && d.ansicht === "roaming") {
    const r = z.addText(flagge(d.roamingLage.land));
    r.font = Font.systemFont(klein ? 10 : 12);
  }
  z.addSpacer();
  const v = z.addText(d.error ? "⚠︎" : d.unbegrenzt ? "∞" : klein ? `${fmtGB(d.left)} GB` : `${fmtGB(d.left)} / ${fmtGB(d.total)} GB`);
  v.font = Font.semiboldRoundedSystemFont(klein ? 11 : 13);
  v.textColor = d.error ? farbe(STATUS.warnung) : farbe(D.text);
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.7;
  w.addSpacer(3);
  const b = w.addImage(fuellBalken(d.error ? 0 : d.pct, d.error ? farbe(D.grau) : statusFarbe(d, D), farbe(D.spur), breite));
  b.imageSize = new Size(breite, 6);
  w.addSpacer(2);
  // Klein nur Status bzw. Laufzeit, sonst auch das Guthaben
  const teile = d.error ? [d.error]
    : [d.status !== "gut" ? statusText(d) : (d.resttage !== null ? t(klein ? "noch_tage" : "noch_tage_lang", d.resttage) : null), klein || isNaN(d.guthaben) ? null : fmtEuro(d.guthaben)];
  const u = w.addText(teile.filter(Boolean).join(" · "));
  u.font = Font.systemFont(klein ? 9 : 10);
  u.textColor = d.error || d.status !== "gut" ? statusFarbe(d.error ? { status: "warnung" } : d, D) : farbe(D.text2);
  u.lineLimit = 1;
}

/** Waagrechter Füllbalken (doppelt aufgelöst). */
function fuellBalken(pct, fuell, spur, breite) {
  const s = 2, h = 6;
  const ctx = new DrawContext();
  ctx.size = new Size(breite * s, h * s);
  ctx.opaque = false;
  ctx.respectScreenScale = false;
  const hinten = new Path();
  hinten.addRoundedRect(new Rect(0, 0, breite * s, h * s), h * s / 2, h * s / 2);
  ctx.addPath(hinten);
  ctx.setFillColor(spur);
  ctx.fillPath();
  if (pct > 0) {
    const vorn = new Path();
    vorn.addRoundedRect(new Rect(0, 0, Math.max(h * s, breite * s * Math.min(1, pct)), h * s), h * s / 2, h * s / 2);
    ctx.addPath(vorn);
    ctx.setFillColor(fuell);
    ctx.fillPath();
  }
  return ctx.getImage();
}

/** SF-Symbol als Bild – mit Rückfall, falls es das Symbol auf dieser iOS-Version nicht gibt. */
function sfBild(name) {
  const s = SFSymbol.named(name) || SFSymbol.named("circle.fill");
  return s.image;
}

function skriptURL(p) {
  return "scriptable:///run?scriptName=" + encodeURIComponent(AUFRUF_NAME) + (p ? "&param=" + p : "");
}

function statusFarbe(d, D) {
  if (d.status === "leer" || d.status === "kritisch") return farbe(D.dunkel ? STATUS.kritischDunkel : STATUS.kritisch);
  if (d.status === "warnung") return farbe(STATUS.warnung);
  return farbe(D.akzent);
}

/** Titel im Ausland ("🇩🇰 Roaming"), sonst null. */
function auslandTitel(d) {
  const lage = d.roamingLage;
  if (!lage || !lage.aktiv) return null;
  return `${flagge(lage.land)} ${d.ansicht === "roaming" ? t("roaming") : lage.eu ? t("eu_ausland") : t("ausland")}`;
}

function statusText(d) {
  return { leer: t("status_leer"), kritisch: t("status_kritisch"), warnung: t("status_warnung") }[d.status] || "";
}

function fehlerAnsicht(w, d, D) {
  w.setPadding(14, 14, 14, 14);
  kopf(w, D, "ALDI TALK");
  w.addSpacer();
  const sym = w.addImage(sfBild(d.zugangsdaten ? "person.crop.circle.badge.exclamationmark" : "exclamationmark.triangle.fill"));
  sym.imageSize = new Size(26, 26);
  sym.tintColor = farbe(STATUS.warnung);
  w.addSpacer(6);
  const tx = w.addText(d.error);
  tx.font = Font.mediumSystemFont(12);
  tx.textColor = farbe(D.text);
  tx.minimumScaleFactor = 0.7;
  w.addSpacer();
  const h = w.addText(t("tippen_oeffnen"));
  h.font = Font.systemFont(10);
  h.textColor = farbe(D.text3);
}

/**
 * Kopfzeile. Links ein Funk-Symbol als Markenzeichen (früher "AT" – das sah aus wie
 * das Länderkürzel von Österreich). Im Ausland steht die Flagge im Titel.
 */
function kopf(stack, D, titel, rechts) {
  const z = stack.addStack();
  z.centerAlignContent();
  const logo = z.addStack();
  logo.backgroundColor = farbe(D.akzent);
  logo.cornerRadius = 5;
  logo.setPadding(3, 3, 3, 3);
  const sym = logo.addImage(sfBild("antenna.radiowaves.left.and.right"));
  sym.imageSize = new Size(9, 9);
  sym.tintColor = Color.white();
  z.addSpacer(5);
  const tx = z.addText(titel);
  tx.font = Font.semiboldRoundedSystemFont(12);
  tx.textColor = farbe(D.text);
  tx.lineLimit = 1;
  tx.minimumScaleFactor = 0.8;
  z.addSpacer();
  if (rechts) {
    const r = z.addText(rechts);
    r.font = Font.mediumRoundedSystemFont(11);
    r.textColor = farbe(D.text2);
    r.lineLimit = 1;
  }
  return z;
}

function fussZeile(stack, d, D) {
  const f = stack.addStack();
  f.centerAlignContent();
  const roaming = !d.hinweis && d.roamingHinweis;
  const sym = f.addImage(sfBild(roaming ? "globe" : d.stale ? "exclamationmark.arrow.circlepath" : "checkmark.circle.fill"));
  sym.imageSize = new Size(9, 9);
  sym.tintColor = d.stale || roaming ? farbe(STATUS.warnung) : farbe(D.text3);
  f.addSpacer(3);
  const tx = f.addText(d.hinweis || d.roamingHinweis || (d.stale ? t("stand", fmtRelativ(d.ts)) : t("aktualisiert", fmtRelativ(d.ts))));
  tx.font = Font.systemFont(9);
  tx.textColor = d.hinweis || roaming ? farbe(STATUS.warnung) : farbe(D.text3);
  tx.lineLimit = 1;
  tx.minimumScaleFactor = 0.7;
  return f;
}

// --- klein ----------------------------------------------------
function klein(w, d, D) {
  w.setPadding(12, 12, 10, 12);
  w.url = skriptURL("menu");
  kopf(w, D, auslandTitel(d) || "ALDI TALK", isNaN(d.guthaben) ? "" : fmtEuro(d.guthaben));
  w.addSpacer();
  const reihe = w.addStack();
  reihe.addSpacer();
  const ring = reihe.addImage(ringBild(d, D, 260, false));
  ring.imageSize = new Size(88, 88);
  reihe.addSpacer();
  w.addSpacer();
  const f = w.addStack();
  f.centerAlignContent();
  const links = f.addText(d.status !== "gut" ? statusText(d) : (d.resttage !== null ? t("noch_tage", d.resttage) : ""));
  links.font = Font.semiboldRoundedSystemFont(11);
  links.textColor = d.status !== "gut" ? statusFarbe(d, D) : farbe(D.text2);
  links.lineLimit = 1;
  f.addSpacer();
  if (d.tagesbudget !== null) {
    const r = f.addText(`${fmtGB(d.tagesbudget)} ${t("gb_tag")}`);
    r.minimumScaleFactor = 0.7;
    r.lineLimit = 1;
    r.font = Font.mediumRoundedSystemFont(11);
    r.textColor = farbe(D.text2);
  }
}

// --- StandBy: eine riesige Zahl, wenig drumherum ---------------
function standby(w, d, D) {
  w.setPadding(10, 12, 10, 12);
  w.url = skriptURL("dashboard");
  const k = w.addText((auslandTitel(d) || "ALDI TALK") + (d.stale ? " ⚠︎" : ""));
  k.font = Font.semiboldRoundedSystemFont(11);
  k.textColor = farbe(D.text2);
  k.lineLimit = 1;
  w.addSpacer();
  const z = w.addText(d.unbegrenzt ? "∞" : fmtGB(d.left, true));
  z.font = Font.heavyRoundedSystemFont(64);
  z.textColor = d.status === "gut" ? farbe(D.text) : statusFarbe(d, D);
  z.minimumScaleFactor = 0.5;
  z.lineLimit = 1;
  const u = w.addText(t(d.ansicht === "roaming" ? "gb_roaming_frei" : "standby_frei"));
  u.font = Font.mediumRoundedSystemFont(13);
  u.textColor = farbe(D.text2);
  w.addSpacer();
  const f = w.addText([d.resttage !== null ? t("noch_tage", d.resttage) : null, d.budgetHeute ? t("heute_von", fmtGB(d.heuteGB), fmtGB(d.budgetHeute)) : null].filter(Boolean).join(" · "));
  f.font = Font.mediumRoundedSystemFont(11);
  f.textColor = d.ampel ? farbe(AMPEL[d.ampel]) : farbe(D.text3);
  f.lineLimit = 1;
  f.minimumScaleFactor = 0.7;
}

// --- mittel ---------------------------------------------------
function mittel(w, d, D) {
  w.setPadding(14, 14, 12, 14);
  w.url = skriptURL("dashboard");
  const reihe = w.addStack();
  reihe.centerAlignContent();
  const ring = reihe.addImage(ringBild(d, D, 300, true));
  ring.imageSize = new Size(108, 108);
  reihe.addSpacer(14);

  const rechts = reihe.addStack();
  rechts.layoutVertically();
  kopf(rechts, D, auslandTitel(d) || d.tarif || "ALDI TALK");
  rechts.addSpacer(6);
  zeile(rechts, D, "creditcard.fill", t("guthaben"), isNaN(d.guthaben) ? "–" : fmtEuro(d.guthaben));
  zeile(rechts, D, "calendar", t("gueltig_bis"), fmtAblauf(d.expires));
  if (d.budgetHeute) zeile(rechts, D, "speedometer", t("heute_label"), t("heute_von", fmtGB(d.heuteGB), fmtGB(d.budgetHeute)), farbe(AMPEL[d.ampel]));
  else if (d.tagesbudget !== null) zeile(rechts, D, "speedometer", t("pro_tag"), fmtGB(d.tagesbudget) + " GB");
  else if (d.status !== "gut") zeile(rechts, D, "exclamationmark.triangle.fill", t("status"), statusText(d).replace("⚠︎ ", ""), statusFarbe(d, D));
  rechts.addSpacer(6);

  const knoepfe = rechts.addStack();
  knoepfe.centerAlignContent();
  pille(knoepfe, D, "plus", t("nachbuchen"), skriptURL("book"), true);
  knoepfe.addSpacer(6);
  pille(knoepfe, D, "arrow.clockwise", null, skriptURL("refresh"), false);

  w.addSpacer();
  fussZeile(w, d, D);
}

function zeile(stack, D, symbol, label, wert, wertFarbe) {
  const z = stack.addStack();
  z.centerAlignContent();
  const s = z.addImage(sfBild(symbol));
  s.imageSize = new Size(10, 10);
  s.tintColor = farbe(D.text3);
  z.addSpacer(5);
  const l = z.addText(label);
  l.font = Font.systemFont(11);
  l.textColor = farbe(D.text2);
  l.lineLimit = 1;
  z.addSpacer(6);
  const v = z.addText(wert);
  v.font = Font.semiboldRoundedSystemFont(12);
  v.textColor = wertFarbe || farbe(D.text);
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.7;
  stack.addSpacer(2);
}

function pille(stack, D, symbol, text, url, haupt) {
  const p = stack.addStack();
  p.centerAlignContent();
  p.cornerRadius = 12;
  p.setPadding(5, text ? 10 : 7, 5, text ? 10 : 7);
  p.backgroundColor = haupt ? farbe(D.knopf) : farbe(D.karte);
  p.url = url;
  const s = p.addImage(sfBild(symbol));
  s.imageSize = new Size(10, 10);
  s.tintColor = haupt ? farbe(D.knopfText) : farbe(D.text);
  if (text) {
    p.addSpacer(4);
    const tx = p.addText(text);
    tx.font = Font.boldRoundedSystemFont(11);
    tx.textColor = haupt ? farbe(D.knopfText) : farbe(D.text);
    tx.lineLimit = 1;
  }
}

// --- groß -----------------------------------------------------
function gross(w, d, D) {
  w.setPadding(16, 16, 12, 16);
  w.url = skriptURL("dashboard");
  kopf(w, D, auslandTitel(d) || d.tarif || "ALDI TALK", d.name ? t("hallo", d.name) : "");
  w.addSpacer(10);

  const oben = w.addStack();
  oben.centerAlignContent();
  const ring = oben.addImage(ringBild(d, D, 330, true));
  ring.imageSize = new Size(124, 124);
  oben.addSpacer(14);
  const kacheln = oben.addStack();
  kacheln.layoutVertically();
  const r1 = kacheln.addStack();
  kachel(r1, D, t("guthaben"), isNaN(d.guthaben) ? "–" : fmtEuro(d.guthaben));
  r1.addSpacer(8);
  kachel(r1, D, t("laufzeit"), d.resttage === null ? "–" : t("tage", d.resttage), fmtAblauf(d.expires, false));
  kacheln.addSpacer(8);
  const r2 = kacheln.addStack();
  kachel(r2, D, t("tagesbudget"), d.budgetHeute ? t("heute_von", fmtGB(d.heuteGB), fmtGB(d.budgetHeute)) : d.tagesbudget === null ? "–" : fmtGB(d.tagesbudget) + " GB",
    d.budgetHeute ? t("heute_label").toLowerCase() : null, d.ampel ? farbe(AMPEL[d.ampel]) : null);
  r2.addSpacer(8);
  if (d.prognose && d.prognose.proTag > 0) {
    kachel(r2, D, t("prognose"), d.prognose.reicht ? t("reicht") : "⚠︎ " + fmtDatum(d.prognose.leerAm),
      `${fmtGB(d.prognose.proTag)} ${t("gb_tag")}`, d.prognose.reicht ? null : farbe(STATUS.warnung));
  } else {
    kachel(r2, D, t("status"), d.status === "gut" ? t("status_gut") : statusText(d), null, d.status === "gut" ? null : statusFarbe(d, D));
  }

  w.addSpacer(12);
  const titel = w.addStack();
  const tt = titel.addText(t("verbrauch_pro_tag"));
  tt.font = Font.semiboldSystemFont(11);
  tt.textColor = farbe(D.text2);
  titel.addSpacer();
  const max = Math.max(...d.tageVerbrauch.map((x) => x.gb));
  const ht = titel.addText(max > 0 ? t("heute_gb", fmtGB(d.tageVerbrauch[d.tageVerbrauch.length - 1].gb)) : t("verlauf_sammelt"));
  ht.font = Font.systemFont(10);
  ht.textColor = farbe(D.text3);
  w.addSpacer(4);
  const diagramm = w.addImage(balkenBild(d.tageVerbrauch, d.tagesbudget, D, 306, 74));
  diagramm.imageSize = new Size(306, 74);

  // Im Ausland nur die Roaming-Pakete – Tarif- und Gratis-Volumen gelten dort nicht.
  const liste = (d.pakete || []).filter((p) => (d.ansicht === "roaming") === !!p.roaming);
  if (liste.length > 1) {
    w.addSpacer(8);
    for (const p of liste.slice(0, 2)) paketZeile(w, p, D);
  }
  // Minuten und SMS in einer Zeile (Flat oder Restmenge)
  const extras = (d.sonstige || []).map((x) => (x.typ === "sms" ? "✉️ " : "📞 ") + (x.unbegrenzt ? t("flat") : Math.round(x.left) + " " + t(x.typ)));
  if (extras.length) {
    w.addSpacer(liste.length > 1 ? 2 : 8);
    const z = w.addStack();
    const et = z.addText(extras.join("   "));
    et.font = Font.mediumRoundedSystemFont(10);
    et.textColor = farbe(D.text2);
    et.lineLimit = 1;
  }

  w.addSpacer();
  const unten = w.addStack();
  unten.centerAlignContent();
  fussZeile(unten, d, D);
  unten.addSpacer();
  pille(unten, D, "plus", t("nachbuchen"), skriptURL("book"), true);
  unten.addSpacer(6);
  pille(unten, D, "arrow.clockwise", null, skriptURL("refresh"), false);
}

function kachel(stack, D, label, wert, unter, wertFarbe) {
  const k = stack.addStack();
  k.layoutVertically();
  k.size = new Size(84, 46);
  k.cornerRadius = 10;
  k.backgroundColor = farbe(D.karte);
  k.setPadding(6, 8, 6, 8);
  const l = k.addText(label);
  l.font = Font.systemFont(9);
  l.textColor = farbe(D.text2);
  l.lineLimit = 1;
  const v = k.addText(wert);
  v.font = Font.semiboldRoundedSystemFont(13);
  v.textColor = wertFarbe || farbe(D.text);
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.6;
  if (unter) {
    const u = k.addText(unter);
    u.font = Font.systemFont(8);
    u.textColor = farbe(D.text3);
    u.lineLimit = 1;
  }
}

function paketZeile(stack, p, D) {
  const z = stack.addStack();
  z.centerAlignContent();
  const n = z.addText((p.roaming ? "🌍 " : "") + p.name);
  n.font = Font.systemFont(10);
  n.textColor = farbe(D.text2);
  n.lineLimit = 1;
  z.addSpacer();
  const v = z.addText(p.unbegrenzt ? t("unbegrenzt") : `${fmtGB(p.left)} / ${fmtGB(p.total)} GB`);
  v.font = Font.mediumRoundedSystemFont(10);
  v.textColor = farbe(D.text);
  stack.addSpacer(2);
}

// --- Sperrbildschirm ------------------------------------------
function sperrRund(d) {
  const w = new ListWidget();
  w.addAccessoryWidgetBackground = true;
  w.url = skriptURL("dashboard");
  if (d.error) {
    const tx = w.addText("!");
    tx.font = Font.boldRoundedSystemFont(20);
    tx.centerAlignText();
    return w;
  }
  const img = w.addImage(sperrRingBild(d));
  img.imageSize = new Size(58, 58);
  img.centerAlignImage();
  return w;
}

function sperrRechteck(d) {
  const w = new ListWidget();
  w.url = skriptURL("dashboard");
  if (d.error) {
    const tx = w.addText("ALDI TALK: " + d.error);
    tx.font = Font.systemFont(11);
    tx.minimumScaleFactor = 0.7;
    return w;
  }
  const k = w.addText((auslandTitel(d) || "ALDI TALK") + (d.stale ? " ⚠︎" : ""));
  k.font = Font.semiboldRoundedSystemFont(11);
  const v = w.addText(d.unbegrenzt ? "∞ " + t("unbegrenzt") : `${fmtGB(d.left)} ${t("gb_frei")}`);
  v.font = Font.boldRoundedSystemFont(17);
  v.minimumScaleFactor = 0.8;
  const img = w.addImage(sperrBalkenBild(d.pct));
  img.imageSize = new Size(140, 6);
  const u = w.addText([d.resttage !== null ? t("tage_kurz", d.resttage) : null, isNaN(d.guthaben) ? null : fmtEuro(d.guthaben)].filter(Boolean).join(" · "));
  u.font = Font.systemFont(10);
  return w;
}

function sperrZeile(d) {
  const w = new ListWidget();
  w.url = skriptURL("dashboard");
  const tx = w.addText(d.error ? "ALDI TALK ⚠︎" : `${d.ansicht === "roaming" ? flagge(d.roamingLage.land) : "📶"} ${d.unbegrenzt ? "∞" : fmtGB(d.left) + " GB"}${d.resttage !== null ? " · " + t("tage_kurz", d.resttage) : ""}`);
  tx.font = Font.mediumSystemFont(12);
  return w;
}

// ============================================================
//  Zeichnungen
// ============================================================
/** Hintergrund: Verlauf mit weichen Lichtflecken. */
function hintergrundBild(D, breite, hoehe) {
  const s = 2;
  const ctx = new DrawContext();
  ctx.size = new Size(breite * s, hoehe * s);
  ctx.opaque = true;
  ctx.respectScreenScale = false;
  // Verlauf von oben nach unten in feinen Streifen.
  const oben = hexRGB(D.oben), unten = hexRGB(D.unten);
  const streifen = 48;
  for (let i = 0; i < streifen; i++) {
    const anteil = i / (streifen - 1);
    ctx.setFillColor(new Color(rgbHex(mischeRGB(oben, unten, anteil))));
    ctx.fillRect(new Rect(0, Math.floor(i * hoehe * s / streifen), breite * s, Math.ceil(hoehe * s / streifen) + 1));
  }
  // Zwei weiche Lichtflecken: viele sehr zarte Kreise übereinander ergeben einen Verlauf ohne Stufen.
  const flecken = [
    { x: breite * s * 0.92, y: -hoehe * s * 0.05, r: Math.max(breite, hoehe) * s * 0.75, gesamt: D.dunkel ? 0.22 : 0.10 },
    { x: -breite * s * 0.1, y: hoehe * s * 1.05, r: Math.max(breite, hoehe) * s * 0.55, gesamt: D.dunkel ? 0.14 : 0.07 },
  ];
  const stufen = 40;
  for (const f of flecken) {
    for (let k = stufen; k >= 1; k--) {
      const r = f.r * Math.pow(k / stufen, 0.8);
      ctx.setFillColor(new Color(D.glanz.slice(0, 7), f.gesamt / stufen));
      ctx.fillEllipse(new Rect(f.x - r, f.y - r, r * 2, r * 2));
    }
  }
  return ctx.getImage();
}

/**
 * Ring (Messinstrument): Füllung in der Statusfarbe mit leichtem Verlauf, Spur in einem
 * helleren Schritt, Markierungen bei 25/50/75 %, in der Mitte die freien GB.
 */
function ringBild(d, D, groesse, mitUntertitel) {
  const ctx = new DrawContext();
  ctx.size = new Size(groesse, groesse);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const lw = groesse * 0.085;
  const r = (groesse - lw) / 2 - groesse * 0.02;
  const c = groesse / 2;

  ctx.setStrokeColor(farbe(D.spur));
  ctx.setLineWidth(lw);
  ctx.strokeEllipse(new Rect(c - r, c - r, r * 2, r * 2));

  const fuell = statusFarbe(d, D);
  const basis = hexRGB(fuell.hex);
  const hell = mischeRGB(basis, [255, 255, 255], 0.35);
  const ende = 360 * d.pct;
  // Leuchten hinter der Füllung
  for (let a = 0; a <= ende; a += 3) {
    const rad = (a - 90) * Math.PI / 180;
    const g = lw * 1.7;
    ctx.setFillColor(new Color(fuell.hex, 0.06));
    ctx.fillEllipse(new Rect(c + r * Math.cos(rad) - g / 2, c + r * Math.sin(rad) - g / 2, g, g));
  }
  for (let a = 0; a <= ende; a += 0.8) {
    const rad = (a - 90) * Math.PI / 180;
    const anteil = ende > 0 ? a / ende : 0;
    ctx.setFillColor(new Color(rgbHex(mischeRGB(hell, basis, anteil))));
    ctx.fillEllipse(new Rect(c + r * Math.cos(rad) - lw / 2, c + r * Math.sin(rad) - lw / 2, lw, lw));
  }
  // Markierungen 25/50/75 %
  ctx.setFillColor(farbe(D.dunkel ? "#ffffff59" : "#0c1c3a40"));
  for (const p of [0.25, 0.5, 0.75]) {
    const rad = (p * 360 - 90) * Math.PI / 180;
    const m = lw * 0.22;
    ctx.fillEllipse(new Rect(c + (r - lw * 0.95) * Math.cos(rad) - m, c + (r - lw * 0.95) * Math.sin(rad) - m, m * 2, m * 2));
  }

  ctx.setTextAlignedCenter();
  const zahl = d.unbegrenzt ? "∞" : fmtGB(d.left);
  const gr = zahl.length > 4 ? groesse * 0.2 : groesse * 0.25;
  ctx.setFont(Font.boldRoundedSystemFont(gr));
  ctx.setTextColor(farbe(D.text));
  ctx.drawTextInRect(zahl, new Rect(0, c - gr * 0.78, groesse, gr * 1.25));
  ctx.setFont(Font.mediumRoundedSystemFont(groesse * 0.085));
  ctx.setTextColor(farbe(D.text2));
  const unter = d.unbegrenzt ? t("unbegrenzt") : (mitUntertitel ? t("gb_von", fmtGB(d.total)) : t("gb_frei"));
  ctx.drawTextInRect(unter, new Rect(0, c + gr * 0.42, groesse, groesse * 0.12));
  return ctx.getImage();
}

/**
 * Säulen "Verbrauch pro Tag" (eine Reihe → keine Legende): heute in der Akzentfarbe,
 * die Tage davor zurückgenommen (Hervorhebung). Säulen höchstens 24 px breit, oben
 * 4 px abgerundet, unten gerade; eine feine Linie markiert das Tagesbudget.
 */
function balkenBild(tage, budget, D, breite, hoehe) {
  const s = 3;
  const ctx = new DrawContext();
  ctx.size = new Size(breite * s, hoehe * s);
  ctx.opaque = false;
  ctx.respectScreenScale = false;
  const basisY = (hoehe - 12) * s;
  const max = Math.max(budget || 0, ...tage.map((x) => x.gb), 0.001);
  const fach = breite * s / tage.length;
  const saeule = Math.min(24 * s / 2, fach * 0.62);
  // Grundlinie (Haarlinie)
  ctx.setFillColor(farbe(D.spur));
  ctx.fillRect(new Rect(0, basisY, breite * s, 1 * s / 2));
  tage.forEach((tg, i) => {
    const h = tg.gb > 0 ? Math.max(2 * s, (tg.gb / max) * (basisY - 4 * s)) : 0;
    const x = i * fach + (fach - saeule) / 2;
    if (h > 0) {
      // Oben abgerundet, unten gerade – als ein Pfad, damit sich halbdurchsichtige Flächen nicht überlagern.
      const r = Math.min(4 * s / 2, saeule / 2, h);
      const ob = basisY - h;
      const p = new Path();
      p.move(new Point(x, basisY));
      p.addLine(new Point(x, ob + r));
      p.addQuadCurve(new Point(x + r, ob), new Point(x, ob));
      p.addLine(new Point(x + saeule - r, ob));
      p.addQuadCurve(new Point(x + saeule, ob + r), new Point(x + saeule, ob));
      p.addLine(new Point(x + saeule, basisY));
      p.closeSubpath();
      ctx.addPath(p);
      ctx.setFillColor(tg.heute ? farbe(D.akzent) : farbe(D.grau));
      ctx.fillPath();
    }
    // Wochentag unter jeder zweiten Säule und unter heute
    if (i % 2 === (tage.length - 1) % 2) {
      ctx.setFont(Font.mediumSystemFont(8 * s));
      ctx.setTextColor(tg.heute ? farbe(D.text) : farbe(D.text3));
      ctx.setTextAlignedCenter();
      const tag = t("wochentage")[new Date(tg.t).getDay()];
      ctx.drawTextInRect(tg.heute ? t("heute") : tag, new Rect(i * fach - fach, basisY + 2 * s, fach * 3, 10 * s));
    }
  });
  // Tagesbudget als Bezugslinie (durchgezogen, Haarlinie) mit Beschriftung
  if (budget && budget > 0) {
    const y = basisY - (budget / max) * (basisY - 4 * s);
    ctx.setFillColor(farbe(D.text2));
    ctx.fillRect(new Rect(0, y, breite * s, s / 2));
    ctx.setFont(Font.mediumSystemFont(8 * s));
    ctx.setTextColor(farbe(D.text2));
    ctx.setTextAlignedRight();
    ctx.drawTextInRect(t("budget"), new Rect(0, y - 11 * s, breite * s, 10 * s));
  }
  return ctx.getImage();
}

function sperrRingBild(d) {
  const g = 120;
  const ctx = new DrawContext();
  ctx.size = new Size(g, g);
  ctx.opaque = false;
  const lw = 11;
  const r = (g - lw) / 2;
  ctx.setStrokeColor(new Color("#ffffff", 0.3));
  ctx.setLineWidth(lw);
  ctx.strokeEllipse(new Rect(g / 2 - r, g / 2 - r, r * 2, r * 2));
  ctx.setFillColor(Color.white());
  for (let a = 0; a <= 360 * d.pct; a += 1.5) {
    const rad = (a - 90) * Math.PI / 180;
    ctx.fillEllipse(new Rect(g / 2 + r * Math.cos(rad) - lw / 2, g / 2 + r * Math.sin(rad) - lw / 2, lw, lw));
  }
  ctx.setTextAlignedCenter();
  ctx.setTextColor(Color.white());
  ctx.setFont(Font.boldRoundedSystemFont(30));
  ctx.drawTextInRect(d.unbegrenzt ? "∞" : fmtGB(d.left, true), new Rect(0, 30, g, 38));
  ctx.setFont(Font.mediumRoundedSystemFont(15));
  ctx.drawTextInRect(d.ansicht === "roaming" ? flagge(d.roamingLage.land) : "GB", new Rect(0, 68, g, 20));
  return ctx.getImage();
}

function sperrBalkenBild(pct) {
  const ctx = new DrawContext();
  ctx.size = new Size(280, 12);
  ctx.opaque = false;
  const spur = new Path();
  spur.addRoundedRect(new Rect(0, 0, 280, 12), 6, 6);
  ctx.addPath(spur);
  ctx.setFillColor(new Color("#ffffff", 0.3));
  ctx.fillPath();
  if (pct > 0) {
    const f = new Path();
    f.addRoundedRect(new Rect(0, 0, Math.max(12, 280 * pct), 12), 6, 6);
    ctx.addPath(f);
    ctx.setFillColor(Color.white());
    ctx.fillPath();
  }
  return ctx.getImage();
}

function hexRGB(hex) {
  const h = String(hex).replace("#", "").slice(0, 6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbHex(rgb) { return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""); }
function mischeRGB(a, b, anteil) { return a.map((v, i) => v + (b[i] - v) * anteil); }

// ============================================================
//  Übersicht (in der App) – ausführliche Ansicht
// ============================================================
async function zeigeDashboard(d) {
  const wv = new WebView();
  wv.shouldAllowRequest = (anfrage) => {
    const url = String(anfrage.url || "");
    if (url.startsWith("aldi://")) {
      const was = url.slice(7);
      if (was === "book") Safari.openInApp(BOOKING, false);
      if (was === "portal") Safari.openInApp(OVERVIEW, false);
      if (was === "refresh") holeDaten({ erzwingen: true }).then((neu) => wv.loadHTML(dashboardHTML(neu)));
      if (was === "standort") {
        standortBereit = pruefeStandort({ erzwingen: true });
        holeDaten().then((neu) => wv.loadHTML(dashboardHTML(neu)));
      }
      return false;
    }
    return true;
  };
  await wv.loadHTML(dashboardHTML(d));
  await wv.present(false);
}

/** Texte zum Standort für Übersicht und Einstellungen. */
function standortInfo() {
  const { land, quelle } = aktuellesLand();
  if (!land) {
    return { flagge: "📍", titel: t("standort_unbekannt"), zone: "", details: (standort && standort.fehler) ? t("ortung_erlauben") : "" };
  }
  const zoneText = { inland: t("zone_inland"), eu: t("zone_eu"), welt: t("zone_welt") }[zone(land)];
  const teile = [t("quelle_" + quelle)];
  if (quelle !== "manuell" && standort && standort.ts) teile.push(t("geprueft", fmtRelativ(standort.ts)));
  if (quelle !== "manuell" && standort && standort.gpsLand && standort.tzLand && standort.gpsLand !== standort.tzLand) {
    teile.push(t("gps_zeitzone_uneinig", landName(standort.gpsLand), landName(standort.tzLand)));
  } else if (quelle === "zeitzone" || quelle === "alt") {
    teile.push(t("pruefung_fehlgeschlagen"));
  }
  return { flagge: flagge(land), titel: landName(land), zone: zoneText, zoneArt: zone(land), details: teile.join(" · ") };
}

function dashboardHTML(d) {
  const S = {
    gb_frei: t("gb_frei"), gb_roaming_frei: t("gb_roaming_frei"), von: t("von"), unbegrenzt: t("unbegrenzt"),
    alles_gruen: t("alles_gruen"), nicht_aktuell: t("nicht_aktuell"), guthaben: t("guthaben"), laufzeit: t("laufzeit"),
    tagesbudget: t("tagesbudget"), prognose: t("prognose"), reicht: t("reicht"), kein_verbrauch: t("kein_verbrauch"),
    sammelt: t("sammelt"), bis_laufzeitende: t("bis_laufzeitende"), heute: t("heute"), wochentage: t("wochentage"),
    tagesbudget_linie: t("tagesbudget"), nur_deutschland: t("nur_deutschland"), flat: t("flat"),
    minuten: t("minuten"), sms: t("sms"), roaming: t("roaming"), inland: t("inland"), eu_roaming: t("eu_roaming"),
    status_leer: t("status_leer"), status_kritisch: t("status_kritisch"), status_warnung: t("status_warnung"),
  };
  const daten = JSON.stringify({
    ...d,
    left: d.unbegrenzt ? null : d.left,
    total: d.unbegrenzt ? null : d.total,
    resttageText: d.resttage === null ? "–" : t("tage", d.resttage),
    ablauf: fmtAblauf(d.expires, false),
    aktualisiert: d.ts ? fmtRelativ(d.ts) : "",
    version: VERSION,
    auslandTitel: auslandTitel(d),
    standortInfo: standortInfo(),
    leerAm: d.prognose && d.prognose.leerAm ? t("leer_am", fmtDatum(d.prognose.leerAm)) : "",
    durchschnitt: d.prognose ? t("durchschnitt", fmtGB(d.prognose.proTag)) : "",
    guthabenText: isNaN(d.guthaben) ? "–" : fmtEuro(d.guthaben),
    fussText: t("aktualisiert", d.ts ? fmtRelativ(d.ts) : "–") + " · ALDI TALK Widget " + VERSION,
    tageszeit: d.tageszeit ? { anteile: d.tageszeit.anteile, gb: d.tageszeit.gb.map((x) => fmtGB(x, true)), namen: t("tageszeit_namen"), spannen: t("tageszeit_spannen"),
      satz: t("tageszeit_satz", t("tageszeit_namen")[d.tageszeit.top], t("tageszeit_spannen")[d.tageszeit.top], d.tageszeit.anteile[d.tageszeit.top]) } : null,
    tageszeitTexte: { titel: t("tageszeit"), leer: t("tageszeit_sammelt") },
    aufladungen: {
      titel: t("aufladungen"), hinweis: t("aufladungen_hinweis"),
      liste: (d.aufladungen || []).slice(-8).reverse().map((a) => ({ datum: fmtDatum(a.ts) + (L === "de" ? "" : " ") + new Date(a.ts).getFullYear(), betrag: "+" + fmtEuro(a.betrag) })),
      summe: (() => { const j = new Date().getFullYear(); const s = (d.aufladungen || []).filter((a) => new Date(a.ts).getFullYear() === j).reduce((x, a) => x + a.betrag, 0); return s ? t("aufladungen_summe", j, fmtEuro(s)) : ""; })(),
    },
    rueckblick: {
      titel: t("rueckblick"),
      text: d.tarifCheck ? d.tarifCheck.text : (d.zeitraeume || []).length ? "" : t("rueckblick_leer"),
      liste: (d.zeitraeume || []).slice(-6).reverse().map((z) => ({
        name: t("rueckblick_bis", fmtDatum(parseDatum(z.bis) ? parseDatum(z.bis).getTime() : z.ts)) + (z.vollstaendig ? "" : " · " + t("unvollstaendig")),
        wert: fmtGB(z.verbraucht, true) + (z.tarifGB ? " / " + fmtGB(z.tarifGB, true) : "") + " GB",
        anteil: z.tarifGB ? z.verbraucht / z.tarifGB : null,
        aus: !z.vollstaendig,
      })),
    },
    lang: L,
    S,
  }, (k, v) => (v === Infinity ? null : v)).replace(/</g, "\\u003c");
  return `<!DOCTYPE html><html lang="${L}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
.app { color-scheme: light;
  --page: #f3f4f6; --surface: #ffffff; --surface-2: #f6f7f9; --text: #0b1b33; --text-2: #52514e; --muted: #77756f;
  --grid: #e5e5e0; --baseline: #c3c2b7; --border: rgba(11,27,51,0.08);
  --series: #2a78d6; --track: #dbe8f8; --brand: #0b2a5b; --brand-2: #2a78d6;
  --warning: #c98a00; --warning-bg: #fff4d6; --critical: #d03b3b; --good: #0a8a0a; --knopf: #f59c00; }
@media (prefers-color-scheme: dark) { .app { color-scheme: dark;
  --page: #0b0d12; --surface: #161a22; --surface-2: #1d222c; --text: #f4f6fa; --text-2: #c3c2b7; --muted: #8f8d87;
  --grid: #272b33; --baseline: #3a3e46; --border: rgba(255,255,255,0.08);
  --series: #3987e5; --track: #1c3354; --brand: #0b1a36; --brand-2: #2a9ee0;
  --warning: #fab219; --warning-bg: #3a2e0c; --critical: #ff6b6b; --good: #3fc23f; } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; font-family: -apple-system, system-ui, sans-serif; -webkit-text-size-adjust: 100%; }
/* oben Platz für die "Close"-Leiste, die Scriptable über die Seite legt */
.app { background: var(--page); color: var(--text); min-height: 100vh; padding: 64px 16px 36px; }
.kopf { background: linear-gradient(160deg, #0b1a36, #15396b 70%, #1d4f8f); color: #fff; border-radius: 22px; padding: 16px 16px 18px; margin-bottom: 12px; position: relative; overflow: hidden; }
.kopf::after { content: ""; position: absolute; right: -60px; top: -60px; width: 200px; height: 200px; border-radius: 50%; background: radial-gradient(circle, rgba(42,158,224,.45), rgba(42,158,224,0) 70%); }
.kopfzeile { display: flex; align-items: center; gap: 10px; position: relative; z-index: 1; }
.marke { width: 34px; height: 34px; border-radius: 10px; background: #2a9ee0; display: grid; place-items: center; flex: none; }
.titel { flex: 1; min-width: 0; } .titel h1 { font-size: 17px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.titel .sub { font-size: 12px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip { flex: none; font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 999px; background: rgba(255,255,255,.14); white-space: nowrap; }
.held { display: flex; align-items: center; gap: 16px; margin-top: 16px; position: relative; z-index: 1; }
.ring { flex: none; }
.zahl { font-size: 46px; font-weight: 700; line-height: 1; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.einheit { font-size: 14px; opacity: .8; margin-top: 4px; }
.pille { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 999px; background: rgba(255,255,255,.14); }
.pille i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.umschalter { display: flex; gap: 4px; background: rgba(255,255,255,.12); padding: 3px; border-radius: 11px; margin-top: 14px; position: relative; z-index: 1; }
.umschalter button { flex: 1; border: 0; background: transparent; color: #fff; font: 600 13px -apple-system, system-ui, sans-serif; padding: 7px; border-radius: 9px; opacity: .75; }
.umschalter button.an { background: #fff; color: #0b1a36; opacity: 1; }
.hinweis-box { display: flex; gap: 10px; align-items: flex-start; background: var(--warning-bg); color: var(--text); border-radius: 14px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; line-height: 1.35; }
.karte { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 16px; margin-bottom: 12px; }
.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 12px; }
.kpi .l { font-size: 12px; color: var(--text-2); } .kpi .w { font-size: 20px; font-weight: 650; margin-top: 3px; font-variant-numeric: tabular-nums; } .kpi .u { font-size: 11px; color: var(--muted); margin-top: 1px; }
h2 { font-size: 15px; margin: 0 0 2px; } .klein { font-size: 12px; color: var(--muted); }
.standort { display: flex; align-items: center; gap: 12px; }
.standort .fl { font-size: 34px; line-height: 1; }
.standort .wo { flex: 1; min-width: 0; } .standort .wo b { font-size: 16px; display: block; }
.zone { display: inline-block; font-size: 11px; font-weight: 650; padding: 2px 7px; border-radius: 6px; margin-top: 3px; }
.zone.inland { background: var(--track); color: var(--series); } .zone.eu { background: var(--track); color: var(--series); } .zone.welt { background: var(--warning-bg); color: var(--warning); }
.knopf-klein { border: 1px solid var(--border); background: var(--surface-2); color: var(--text); text-decoration: none; font-size: 13px; font-weight: 600; padding: 8px 11px; border-radius: 10px; white-space: nowrap; }
svg text { font-family: -apple-system, system-ui, sans-serif; }
.tooltip { position: fixed; pointer-events: none; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; font-size: 12px; box-shadow: 0 4px 14px rgba(0,0,0,.18); display: none; }
.tooltip b { display: block; font-size: 14px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
td, th { padding: 5px 4px; border-bottom: 1px solid var(--grid); text-align: left; } td:last-child, th:last-child { text-align: right; }
summary { cursor: pointer; font-size: 13px; color: var(--text-2); margin-top: 8px; }
.paket { padding: 9px 0; border-bottom: 1px solid var(--grid); } .paket:last-child { border-bottom: 0; }
.paket .z { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; } .paket .z span:last-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
.paket .m { height: 5px; border-radius: 3px; background: var(--track); margin-top: 6px; overflow: hidden; } .paket .m div { height: 100%; background: var(--series); border-radius: 3px; }
.paket.aus { color: var(--muted); } .paket.aus .m div { background: var(--baseline); }
.tz { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; align-items: end; height: 120px; }
.tz div { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; font-size: 11px; color: var(--muted); gap: 4px; font-variant-numeric: tabular-nums; }
.tz i { display: block; width: 70%; border-radius: 6px 6px 2px 2px; background: var(--series); min-height: 3px; }
.tz b { color: var(--text); font-size: 12px; }
.gruppe { font-size: 12px; font-weight: 650; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; margin: 14px 0 2px; }
.knoepfe { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
.knoepfe a.haupt { grid-column: 1 / -1; }
.knoepfe a { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; white-space: nowrap; text-decoration: none; font-weight: 650; font-size: 15px; padding: 13px 6px; border-radius: 14px; background: var(--surface); color: var(--text); border: 1px solid var(--border); }
.knoepfe a.haupt { background: var(--knopf); color: #1a1a1a; border-color: transparent; }
.fuss { text-align: center; font-size: 11px; color: var(--muted); margin-top: 14px; }
</style></head><body><div class="app">
<section class="kopf">
  <div class="kopfzeile">
    <div class="marke" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M5 9.5a10 10 0 0 0 0 5M8.2 7.8a6 6 0 0 0 0 8.4M19 9.5a10 10 0 0 1 0 5M15.8 7.8a6 6 0 0 1 0 8.4"/><circle cx="12" cy="12" r="1.8" fill="#fff" stroke="none"/></svg></div>
    <div class="titel"><h1 id="tarif"></h1><div class="sub" id="nummer"></div></div>
    <span class="chip" id="landChip"></span>
  </div>
  <div class="umschalter" id="umschalter" hidden><button id="btnRoaming"></button><button id="btnInland"></button></div>
  <div class="held">
    <svg class="ring" id="ring" width="104" height="104" viewBox="0 0 104 104" aria-hidden="true"></svg>
    <div><div class="zahl" id="zahl"></div><div class="einheit" id="einheit"></div><div class="pille"><i id="punkt"></i><span id="statustext"></span></div></div>
  </div>
</section>
<div class="hinweis-box" id="hinweis" hidden><span>🌍</span><span id="hinweistext"></span></div>
<div class="kpis" id="kpis"></div>
<section class="karte"><div class="standort"><div class="fl" id="sFlagge"></div><div class="wo"><b id="sLand"></b><span class="zone" id="sZone"></span><div class="klein" id="sDetails"></div></div><a class="knopf-klein" href="aldi://standort" id="sKnopf"></a></div></section>
<section class="karte"><h2 id="vTitel"></h2><div class="klein" id="vHinweis" style="margin-bottom:10px"></div>
<svg id="diagramm" width="100%" height="170" role="img"></svg>
<details><summary id="vTabelle"></summary><table id="tabelle"><thead><tr><th id="thTag"></th><th id="thVerbrauch"></th></tr></thead><tbody></tbody></table></details></section>
<section class="karte" id="pakete"><h2 id="pTitel"></h2></section>
<section class="karte" id="rueckblick"><h2 id="rTitel"></h2><div class="klein" id="rText"></div></section>
<section class="karte" id="tageszeit"><h2 id="tzTitel"></h2><div class="klein" id="tzText" style="margin-bottom:10px"></div><div class="tz" id="tzBalken"></div></section>
<section class="karte" id="aufladungen" hidden><h2 id="aTitel"></h2><div class="klein" id="aText"></div></section>
<div class="knoepfe">
  <a class="haupt" href="aldi://book"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span id="kNach"></span></a>
  <a href="aldi://refresh"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg><span id="kAkt"></span></a>
  <a href="aldi://portal"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg><span id="kPortal"></span></a>
</div>
<div class="fuss" id="fuss"></div>
<div class="tooltip" id="tooltip"></div>
</div>
<script>
const d = ${daten};
const S = d.S;
const loc = d.lang === "de" ? "de-DE" : "en-GB";
const zahl = (x, n) => x === null || x === undefined || isNaN(x) ? "–" : Number(x).toLocaleString(loc, { minimumFractionDigits: n, maximumFractionDigits: n });
const gb = (x) => zahl(x, x >= 10 ? 1 : 2);
const setze = (id, text) => { document.getElementById(id).textContent = text; };
const TXT = ${JSON.stringify({
    vTitel: t("verbrauch_pro_tag"), vHinweis: t("verbrauch_hinweis"), vTabelle: t("als_tabelle"), thTag: t("tag"),
    thVerbrauch: t("verbrauch"), pTitel: t("pakete"), kNach: t("nachbuchen"), kAkt: t("aktualisieren"),
    kPortal: t("portal"), sKnopf: t("neu_pruefen"),
  }).replace(/</g, "\\u003c")};
for (const id in TXT) setze(id, TXT[id]);
setze("tarif", d.tarif || "ALDI TALK");
setze("nummer", [d.vertraege && d.vertraege[d.vertragIndex] ? d.vertraege[d.vertragIndex].label : "", d.name].filter(Boolean).join(" · "));
const si = d.standortInfo || {};
setze("landChip", (si.flagge || "📍") + " " + (si.zoneArt === "inland" ? S.inland : si.zoneArt === "eu" ? S.eu_roaming : si.titel || ""));
setze("sFlagge", si.flagge || "📍"); setze("sLand", si.titel || ""); setze("sDetails", si.details || "");
const zoneEl = document.getElementById("sZone"); zoneEl.textContent = si.zone || ""; zoneEl.className = "zone " + (si.zoneArt || ""); zoneEl.hidden = !si.zone;
if (d.roamingHinweis || d.ansicht === "roaming") {
  document.getElementById("hinweis").hidden = false;
  setze("hinweistext", d.roamingHinweis || ${JSON.stringify(t("hinweis_nur_roaming"))});
}

// Ring + Zahl der gewählten Ansicht (Roaming/Inland umschaltbar, wenn es beides gibt).
const farbeStatus = (st) => st === "leer" || st === "kritisch" ? "#ff6b6b" : st === "warnung" ? "#fab219" : "#7fd0ff";
function zeigeAnsicht(name) {
  const a = (d.ansichten || {})[name] || d;
  const unb = a.unbegrenzt;
  setze("zahl", unb ? "∞" : gb(a.left));
  setze("einheit", unb ? S.unbegrenzt : (name === "roaming" ? S.gb_roaming_frei : S.gb_frei) + " " + S.von + " " + gb(a.total) + " GB");
  const st = a.status || "gut";
  document.getElementById("punkt").style.background = st === "gut" ? "#3fc23f" : farbeStatus(st);
  setze("statustext", (st === "gut" ? S.alles_gruen : { leer: S.status_leer, kritisch: S.status_kritisch, warnung: S.status_warnung }[st]) + (d.stale ? " · ⚠︎ " + (d.hinweis || S.nicht_aktuell) : ""));
  const r = 44, u = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, unb ? 1 : a.pct || 0));
  document.getElementById("ring").innerHTML =
    '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="10"/>' +
    '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="' + farbeStatus(st) + '" stroke-width="10" stroke-linecap="round" ' +
    'stroke-dasharray="' + (u * pct) + ' ' + u + '" transform="rotate(-90 52 52)"/>' +
    '<text x="52" y="58" text-anchor="middle" font-size="17" font-weight="700" fill="#fff">' + Math.round(pct * 100) + '%</text>';
  document.getElementById("btnRoaming").className = name === "roaming" ? "an" : "";
  document.getElementById("btnInland").className = name === "inland" ? "an" : "";
}
if (d.ansichten && d.ansichten.roaming && d.ansicht === "roaming") {
  document.getElementById("umschalter").hidden = false;
  setze("btnRoaming", "🌍 " + S.roaming); setze("btnInland", "🇩🇪 " + S.inland);
  document.getElementById("btnRoaming").onclick = () => zeigeAnsicht("roaming");
  document.getElementById("btnInland").onclick = () => zeigeAnsicht("inland");
}
zeigeAnsicht(d.ansicht || "inland");

const kpis = [
  [S.guthaben, d.guthabenText, ""],
  [S.laufzeit, d.resttageText, d.ablauf],
  [S.tagesbudget, d.tagesbudget === null || d.tagesbudget === undefined ? "–" : gb(d.tagesbudget) + " GB", S.bis_laufzeitende],
  [S.prognose, !d.prognose ? "–" : d.prognose.proTag <= 0 ? S.kein_verbrauch : d.prognose.reicht ? S.reicht : d.leerAm, !d.prognose ? S.sammelt : d.durchschnitt],
];
for (const [l, w, u] of kpis) {
  const k = document.createElement("div"); k.className = "kpi";
  for (const [cls, text] of [["l", l], ["w", w], ["u", u]]) { const e = document.createElement("div"); e.className = cls; e.textContent = text; k.appendChild(e); }
  document.getElementById("kpis").appendChild(k);
}

// Säulendiagramm: eine Reihe, Säulen ≤ 24 px, oben 4 px rund, unten gerade, Tagesbudget als Haarlinie.
const svg = document.getElementById("diagramm");
const W = Math.round(svg.getBoundingClientRect().width) || 340, H = 170, links = 34, unten = 22, oben = 10;
svg.setAttribute("viewBox", "0 0 " + W + " " + H);
svg.setAttribute("aria-label", TXT.vTitel);
const tage = d.tageVerbrauch || [];
const maxWert = Math.max(d.tagesbudget || 0, ...tage.map(x => x.gb), 0.01);
const schritt = (() => { const roh = maxWert / 3; const p = Math.pow(10, Math.floor(Math.log10(roh))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= roh); })();
const yMax = Math.ceil(maxWert / schritt) * schritt;
const y = v => oben + (H - unten - oben) * (1 - v / yMax);
const ns = "http://www.w3.org/2000/svg";
const el = (n, a) => { const e = document.createElementNS(ns, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
const style = getComputedStyle(document.querySelector(".app"));
const c = v => style.getPropertyValue(v).trim();
// Nachkommastellen nach der Schrittweite: 2,5 statt "3", 0,25 statt "0".
const achsenStellen = Number.isInteger(schritt) ? 0 : Number.isInteger(Math.round(schritt * 1e6) / 1e5) ? 1 : 2;
for (let i = 0; i * schritt <= yMax + 1e-9; i++) {
  const v = i * schritt;
  svg.appendChild(el("line", { x1: links, x2: W, y1: y(v), y2: y(v), stroke: v === 0 ? c("--baseline") : c("--grid"), "stroke-width": 1 }));
  const tx = el("text", { x: links - 6, y: y(v) + 4, "text-anchor": "end", "font-size": 10, fill: c("--muted") }); tx.textContent = zahl(v, achsenStellen); svg.appendChild(tx);
}
const fach = (W - links) / Math.max(1, tage.length);
const breite = Math.min(24, fach - 4);
const tip = document.getElementById("tooltip");
const datum = (ts) => new Date(ts).toLocaleDateString(loc, { weekday: "short", day: "2-digit", month: "2-digit" });
tage.forEach((tg, i) => {
  const x = links + i * fach + (fach - breite) / 2;
  const h = Math.max(0, y(0) - y(tg.gb));
  if (h > 0) {
    const r = Math.min(4, h, breite / 2);
    const pfad = "M" + x + "," + y(0) + "V" + (y(0) - h + r) + "Q" + x + "," + (y(0) - h) + " " + (x + r) + "," + (y(0) - h) + "H" + (x + breite - r) + "Q" + (x + breite) + "," + (y(0) - h) + " " + (x + breite) + "," + (y(0) - h + r) + "V" + y(0) + "Z";
    svg.appendChild(el("path", { d: pfad, fill: c("--series"), opacity: tg.heute ? 1 : 0.5 }));
  }
  if (i % 2 === (tage.length - 1) % 2) {
    // Das letzte Etikett ("heute") rechtsbündig, damit es nicht abgeschnitten wird.
    const letztes = i === tage.length - 1;
    const lab = el("text", { x: letztes ? W - 1 : links + i * fach + fach / 2, y: H - 6, "text-anchor": letztes ? "end" : "middle", "font-size": 10, fill: c("--muted") });
    lab.textContent = tg.heute ? S.heute : S.wochentage[new Date(tg.t).getDay()];
    svg.appendChild(lab);
  }
  // Treffer-Fläche größer als die Säule (ganzes Fach), Tooltip bei Tippen/Zeigen
  const treffer = el("rect", { x: links + i * fach, y: oben, width: fach, height: H - unten - oben, fill: "transparent", tabindex: 0 });
  const zeige = () => {
    tip.replaceChildren();
    const b = document.createElement("b"); b.textContent = gb(tg.gb) + " GB";
    const s = document.createElement("span"); s.textContent = datum(tg.t);
    tip.append(b, s); tip.style.display = "block";
    const box = treffer.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - 110, Math.max(6, box.left + box.width / 2 - 45)) + "px";
    tip.style.top = (box.top + 4) + "px";
  };
  treffer.addEventListener("pointerdown", zeige); treffer.addEventListener("pointermove", zeige); treffer.addEventListener("focus", zeige);
  treffer.addEventListener("pointerleave", () => tip.style.display = "none");
  svg.appendChild(treffer);
  const zeile = document.createElement("tr");
  const a = document.createElement("td"); a.textContent = datum(tg.t);
  const b = document.createElement("td"); b.textContent = gb(tg.gb) + " GB";
  zeile.append(a, b); document.querySelector("#tabelle tbody").appendChild(zeile);
});
if (d.tagesbudget) {
  svg.appendChild(el("line", { x1: links, x2: W, y1: y(d.tagesbudget), y2: y(d.tagesbudget), stroke: c("--text-2"), "stroke-width": 1 }));
  // Beschriftung links – rechts steht meist die Säule von heute.
  const bl = el("text", { x: links + 4, y: y(d.tagesbudget) - 4, "text-anchor": "start", "font-size": 10, fill: c("--text-2"), stroke: c("--surface"), "stroke-width": 3, "paint-order": "stroke" });
  bl.textContent = S.tagesbudget_linie + " " + gb(d.tagesbudget) + " GB"; svg.appendChild(bl);
}
document.addEventListener("pointerdown", (e) => { if (!(e.target instanceof SVGRectElement)) tip.style.display = "none"; });

// Pakete mit kleinem Füllbalken; im Ausland nur die Roaming-Pakete oben, der Rest ausgegraut darunter.
const pakete = document.getElementById("pakete");
const paket = (name, wert, anteil, aus, ziel = pakete) => {
  const p = document.createElement("div"); p.className = "paket" + (aus ? " aus" : "");
  const z = document.createElement("div"); z.className = "z";
  const n = document.createElement("span"); n.textContent = name;
  const w = document.createElement("span"); w.textContent = wert;
  z.append(n, w); p.appendChild(z);
  if (anteil !== null) { const m = document.createElement("div"); m.className = "m"; const f = document.createElement("div"); f.style.width = Math.round(Math.max(0, Math.min(1, anteil)) * 100) + "%"; m.appendChild(f); p.appendChild(m); }
  ziel.appendChild(p);
};
const datenPaket = (p, aus) => paket((p.roaming ? "🌍 " : "") + p.name, p.unbegrenzt ? S.unbegrenzt : gb(p.left) + " / " + gb(p.total) + " GB", p.unbegrenzt || !p.total ? null : p.left / p.total, aus);
const gruppe = (text) => { const g = document.createElement("div"); g.className = "gruppe"; g.textContent = text; pakete.appendChild(g); };
if (d.ansicht === "roaming") {
  (d.pakete || []).filter(p => p.roaming).forEach(p => datenPaket(p, false));
  const rest = (d.pakete || []).filter(p => !p.roaming);
  if (rest.length) { gruppe(S.nur_deutschland); rest.forEach(p => datenPaket(p, true)); }
} else {
  (d.pakete || []).forEach(p => datenPaket(p, false));
}
for (const s of d.sonstige || []) paket(S[s.typ] || s.typ, s.unbegrenzt ? S.flat : zahl(s.left, 0) + " / " + zahl(s.total, 0), null, false);
const rb = d.rueckblick;
setze("rTitel", rb.titel);
setze("rText", rb.text);
document.getElementById("rText").hidden = !rb.text;
for (const z of rb.liste) paket(z.name, z.wert, z.anteil, z.aus, document.getElementById("rueckblick"));
setze("tzTitel", d.tageszeitTexte.titel);
if (d.tageszeit) {
  setze("tzText", d.tageszeit.satz);
  const max = Math.max.apply(null, d.tageszeit.anteile.concat([1]));
  d.tageszeit.anteile.forEach(function (a, i) {
    const s = document.createElement("div");
    const v = document.createElement("b"); v.textContent = a + " %";
    const bar = document.createElement("i"); bar.style.height = Math.round(a / max * 70) + "%"; if (i === d.tageszeit.top) bar.style.background = "var(--brand-2)";
    const n = document.createElement("span"); n.textContent = d.tageszeit.namen[i]; n.title = d.tageszeit.spannen[i];
    s.append(v, bar, n); document.getElementById("tzBalken").appendChild(s);
  });
} else { setze("tzText", d.tageszeitTexte.leer); document.getElementById("tzBalken").hidden = true; }
const au = d.aufladungen;
if (au.liste.length) {
  document.getElementById("aufladungen").hidden = false;
  setze("aTitel", au.titel);
  setze("aText", [au.summe, au.hinweis].filter(Boolean).join(" · "));
  for (const a of au.liste) paket(a.datum, a.betrag, null, false, document.getElementById("aufladungen"));
}
setze("fuss", d.fussText);
</script></body></html>`;
}

// ============================================================
//  Menüs (beim Start in der App oder Antippen des kleinen Widgets)
// ============================================================
async function hauptmenue() {
  // Zugangsdaten wurden abgelehnt: zuerst das klären.
  if (loginSperreAktiv()) {
    const a = new Alert();
    a.title = "ALDI TALK";
    a.message = t("abgelehnt_text", loginSperreText());
    a.addAction(t("neu_eingeben"));
    a.addAction(t("nochmal_alte"));
    a.addCancelAction(t("abbrechen"));
    const wahl = await a.presentAlert();
    if (wahl === -1) return;
    if (wahl === 0) vergissZugangsdaten();
    hebeLoginSperreAuf();
    forceRefresh();
  }

  while (true) {
    const d = await holeDaten();
    const m = new Alert();
    m.title = "ALDI TALK";
    const titel = auslandTitel(d);
    m.message = d.error ? "⚠︎ " + d.error
      : (titel ? titel + (d.roamingLage.landName ? ` (${d.roamingLage.landName})` : "") + ": " : "")
        + (d.unbegrenzt ? t("n_unbegrenzt") : t("menue_volumen", fmtGB(d.left), fmtGB(d.total)))
        + (isNaN(d.guthaben) ? "" : " · " + t("menue_guthaben", fmtEuro(d.guthaben)))
        + (d.resttage !== null && d.resttage !== undefined ? " · " + t("noch_tage_lang", d.resttage) : "")
        + (d.hinweis ? "\n⚠︎ " + d.hinweis : "");
    const aktionen = [
      [t("m_uebersicht"), async () => { await zeigeDashboard(d.error ? await holeDaten({ erzwingen: true }) : d); return true; }],
      [t("m_aktualisieren"), async () => { await zeigeDashboard(await holeDaten({ erzwingen: true })); return true; }],
      [t("m_nachbuchen"), async () => { Safari.openInApp(BOOKING, false); return true; }],
      [t("m_portal"), async () => { Safari.openInApp(OVERVIEW, false); return true; }],
      [t("m_land"), async () => { await landMenue(); return false; }],
      [t("m_vorschau"), async () => { await vorschauMenue(d); return true; }],
      [t("m_siri"), async () => { await siriMenue(d); return false; }],
      [t("m_einstellungen"), async () => (await einstellungsMenue(d)) === "reset"],
      ["⬆️ Updates", async () => updateMenue()],
      [t("m_zugang"), async () => {
        vergissZugangsdaten(); hebeLoginSperreAuf(); forceRefresh();
        await zeigeDashboard(await holeDaten({ erzwingen: true }));
        return true;
      }],
    ];
    for (const [text] of aktionen) m.addAction(text);
    m.addCancelAction(t("fertig"));
    const wahl = await m.presentSheet();
    if (wahl < 0) return;
    // Nach Land- und Einstellungsmenü zurück ins Hauptmenü (Werte könnten sich geändert haben).
    if (await aktionen[wahl][1]()) return;
  }
}

async function vorschauMenue(d) {
  const a = new Alert();
  a.title = t("vorschau");
  const groessen = [["StandBy", "standby"], [t("klein"), "small"], [t("mittel"), "medium"], [t("gross"), "large"], [t("sperr_rund"), "accessoryCircular"], [t("sperr_rechteck"), "accessoryRectangular"]];
  for (const [n] of groessen) a.addAction(n);
  a.addCancelAction(t("zurueck"));
  const wahl = await a.presentSheet();
  if (wahl < 0) return;
  let familie = groessen[wahl][1];
  if (familie === "standby") { standbyWahl = true; familie = "small"; }
  const w = baueWidget(d, familie);
  standbyWahl = false;
  if (familie === "small") await w.presentSmall();
  else if (familie === "medium") await w.presentMedium();
  else if (familie === "large") await w.presentLarge();
  else if (familie === "accessoryCircular" && w.presentAccessoryCircular) await w.presentAccessoryCircular();
  else if (w.presentAccessoryRectangular) await w.presentAccessoryRectangular();
}

/** Land & Roaming: Anzeige, Land festlegen, Prüfabstand, jetzt prüfen, Verlauf. */
async function landMenue() {
  const intervalle = [[60, t("l_iv_stuendlich")], [360, t("l_iv_6")], [1440, t("l_iv_taeglich")]];
  const anzeigeNamen = { auto: t("l_anzeige_auto"), an: t("l_anzeige_an"), aus: t("l_anzeige_aus") };
  while (true) {
    const info = standortInfo();
    const a = new Alert();
    a.title = t("l_titel");
    a.message = `${info.flagge} ${info.titel}${info.zone ? " – " + info.zone : ""}\n${info.details}`;
    const ivName = (intervalle.find((i) => i[0] === einstellungen.landIntervall) || intervalle[2])[1];
    const punkte = [
      [t("l_anzeige", anzeigeNamen[einstellungen.roaming] || anzeigeNamen.auto), "anzeige"],
      [t("l_land", einstellungen.landManuell ? `${flagge(einstellungen.landManuell)} ${landName(einstellungen.landManuell)}` : t("l_automatisch")), "land"],
      [t("l_intervall", ivName), "intervall"],
      [t("l_jetzt"), "jetzt"],
      [t("l_verlauf"), "verlauf"],
      [t("m_reise"), "reise"],
    ];
    for (const [tx] of punkte) a.addAction(tx);
    a.addCancelAction(t("zurueck"));
    const wahl = await a.presentSheet();
    if (wahl < 0) return;
    const was = punkte[wahl][1];
    if (was === "anzeige") {
      const keys = Object.keys(anzeigeNamen);
      const w = await auswahl(t("l_titel"), keys.map((k) => anzeigeNamen[k]));
      if (w >= 0) { einstellungen.roaming = keys[w]; roamingWahl = keys[w]; }
    } else if (was === "land") {
      const codes = [HEIMATLAND, ...EU_LAENDER.filter((c) => LAENDER[c]).sort((x, y) => landName(x).localeCompare(landName(y))),
        ...ANDERE_LAENDER.slice().sort((x, y) => landName(x).localeCompare(landName(y)))];
      const namen = [t("l_auto_empfohlen"), ...codes.map((c) => `${flagge(c)} ${landName(c)}${c === HEIMATLAND ? "" : EU_LAENDER.includes(c) ? " · " + t("l_eu") : " · " + t("l_andere")}`)];
      const w = await auswahl(t("l_land_waehlen"), namen);
      if (w === 0) { einstellungen.landManuell = ""; standortBereit = pruefeStandort({ erzwingen: true }); await standortBereit; }
      else if (w > 0) einstellungen.landManuell = codes[w - 1];
    } else if (was === "intervall") {
      const w = await auswahl(t("l_titel"), intervalle.map((i) => i[1]));
      if (w >= 0) einstellungen.landIntervall = intervalle[w][0];
      await hinweis(t("l_titel"), t("l_iv_hinweis"));
    } else if (was === "jetzt") {
      standortBereit = pruefeStandort({ erzwingen: true });
      await standortBereit;
      const neu = standortInfo();
      await hinweis(t("l_ergebnis"), `${neu.flagge} ${neu.titel}${neu.zone ? " – " + neu.zone : ""}\n${neu.details}`);
    } else if (was === "reise") {
      await reiseVorschau();
    } else if (was === "verlauf") {
      const verlauf = liesJSON(LAENDERVERLAUF, []).slice().reverse();
      await hinweis(t("l_verlauf"), verlauf.length
        ? verlauf.map((e) => `${flagge(e.land)} ${landName(e.land)} – ${fmtDatumZeit(e.ts)} (${t("quelle_" + e.quelle)})`).join("\n")
        : t("l_kein_verlauf"));
    }
    speichereEinstellungen();
  }
}

/** Reise-Vorschau: Land wählen und sehen, was dort gilt (mit dem aktuellen Roaming-Volumen). */
async function reiseVorschau() {
  const codes = [...EU_LAENDER.filter((c) => LAENDER[c] && c !== HEIMATLAND).sort((x, y) => landName(x).localeCompare(landName(y))),
    ...ANDERE_LAENDER.slice().sort((x, y) => landName(x).localeCompare(landName(y)))];
  const w = await auswahl(t("m_reise"), codes.map((c) => `${flagge(c)} ${landName(c)}${EU_LAENDER.includes(c) ? " · " + t("l_eu") : " · " + t("l_andere")}`));
  if (w < 0) return;
  const land = codes[w];
  const cache = liesJSON(cacheName(), null);
  let text;
  if (land === HEIMATLAND) text = t("reise_inland");
  else if (zone(land) === "eu") {
    const r = cache && cache.roaming;
    text = t("reise_eu", r && !r.geschaetzt ? t("reise_eu_wert", fmtGB(r.left), fmtGB(r.total)) : r ? t("reise_eu_geschaetzt", fmtGB(r.total, true)) : "–");
  } else text = t("reise_welt");
  await hinweis(t("reise_titel", flagge(land), landName(land)), text);
}

// ============================================================
//  Home Assistant: Werte als Sensoren schicken
// ============================================================
const K_HA_URL = "alditalk_ha_url", K_HA_TOKEN = "alditalk_ha_token";
const haZugang = () => (Keychain.contains(K_HA_URL) && Keychain.contains(K_HA_TOKEN) ? { url: Keychain.get(K_HA_URL), token: Keychain.get(K_HA_TOKEN) } : null);
const haHost = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** Zugänge zu Home Assistant, die andere Widgets schon im Schlüsselbund haben. */
function haVorhandene() {
  const liste = [];
  const nimm = (url, token) => { if (url && token && !liste.some((x) => x.url === url)) liste.push({ url: String(url).replace(/\/+$/, ""), token }); };
  try { if (Keychain.contains("briefankuendigung_ha_url")) nimm(Keychain.get("briefankuendigung_ha_url"), Keychain.get("briefankuendigung_ha_token")); } catch (e) { /* egal */ }
  try { if (Keychain.contains("woist_ha_url")) nimm(Keychain.get("woist_ha_url"), Keychain.get("woist_ha_token")); } catch (e) { /* egal */ }
  try { if (Keychain.contains("woist_instanzen")) for (const i of JSON.parse(Keychain.get("woist_instanzen"))) nimm(i.url, i.token); } catch (e) { /* egal */ }
  return liste;
}

async function haAnfrage(z, pfadTeil, body) {
  const r = new Request(z.url.replace(/\/+$/, "") + pfadTeil);
  r.timeoutInterval = 8;
  r.method = body ? "POST" : "GET";
  r.headers = { Authorization: "Bearer " + z.token, "Content-Type": "application/json" };
  if (body) r.body = JSON.stringify(body);
  const text = await r.loadString();
  const st = (r.response && r.response.statusCode) || 0;
  if (st === 401) throw new Error(t("ha_admin"));
  if (st >= 400) throw new Error("HTTP " + st);
  return text;
}

/** Nach einem frischen Abruf die Sensoren setzen (je Rufnummer mit Endung _2, _3 …). Wirft nie. */
async function haSenden(d) {
  if (!einstellungen.haSync || !d || d.error || d.stale) return;
  const z = haZugang();
  if (!z) return;
  const merk = liesJSON("alditalk-ha-" + vertragIndex + ".json", {});
  if (merk.ts && merk.ts >= d.ts) return; // diesen Stand schon gesendet
  const e = vertragIndex ? "_" + (vertragIndex + 1) : "";
  const wer = d.vertraege && d.vertraege.length > 1 && d.vertraege[d.vertragIndex] ? " " + vertragName(d.vertraege[d.vertragIndex].label) : "";
  const lage = d.roamingLage || {};
  const sensoren = [
    ["sensor.aldi_talk_datenvolumen" + e, d.unbegrenzt ? "unbegrenzt" : d.left.toFixed(2), d.unbegrenzt ? { friendly_name: "ALDI TALK Datenvolumen" + wer, icon: "mdi:signal-cellular-3" }
      : { friendly_name: "ALDI TALK Datenvolumen" + wer, unit_of_measurement: "GB", device_class: "data_size", state_class: "measurement", icon: "mdi:signal-cellular-3",
        gesamt: Math.round(d.total * 100) / 100, prozent: Math.round(d.pct * 100), roaming: d.ansicht === "roaming", land: lage.land || null, status: d.status }],
    ["sensor.aldi_talk_guthaben" + e, isNaN(d.guthaben) ? "unknown" : d.guthaben.toFixed(2), { friendly_name: "ALDI TALK Guthaben" + wer, unit_of_measurement: "€", device_class: "monetary", icon: "mdi:wallet" }],
    ["sensor.aldi_talk_laufzeit" + e, d.resttage === null ? "unknown" : String(d.resttage), { friendly_name: "ALDI TALK Laufzeit" + wer, unit_of_measurement: "d", icon: "mdi:calendar-clock",
      ablauf: (parseDatum(d.vertragsEnde || d.expires) || { toISOString: () => null }).toISOString() }],
    ["sensor.aldi_talk_heute" + e, d.unbegrenzt ? "0" : (d.heuteGB || 0).toFixed(2), { friendly_name: "ALDI TALK heute verbraucht" + wer, unit_of_measurement: "GB", device_class: "data_size",
      state_class: "measurement", icon: "mdi:speedometer", tagesbudget: d.budgetHeute ? Math.round(d.budgetHeute * 100) / 100 : null, ampel: d.ampel }],
  ];
  try {
    for (const [id, state, attributes] of sensoren) await haAnfrage(z, "/api/states/" + id, { state, attributes });
    schreibJSON("alditalk-ha-" + vertragIndex + ".json", { ts: d.ts, fehler: "" });
  } catch (x) {
    schreibJSON("alditalk-ha-" + vertragIndex + ".json", { ts: merk.ts || 0, fehler: String(x.message || x) });
  }
}

async function haMenue(d) {
  const a = new Alert();
  a.title = t("m_ha");
  const merk = liesJSON("alditalk-ha-" + vertragIndex + ".json", {});
  a.message = t("ha_text") + (merk.fehler ? "\n\n⚠︎ " + merk.fehler : merk.ts ? "\n\n" + t("ha_letzter", fmtRelativ(merk.ts)) : "");
  const vorhanden = haVorhandene();
  const aktionen = vorhanden.map((z) => [t("ha_vorhanden", haHost(z.url)), z]);
  aktionen.push([t("ha_eingeben"), "eingeben"]);
  if (einstellungen.haSync) aktionen.push([t("ha_abschalten"), "aus"]);
  for (const [tx] of aktionen) a.addAction(tx);
  a.addCancelAction(t("zurueck"));
  const w = await a.presentSheet();
  if (w < 0) return;
  let z = aktionen[w][1];
  if (z === "aus") { einstellungen.haSync = false; return; }
  if (z === "eingeben") {
    const f = new Alert();
    f.title = t("m_ha");
    f.addTextField(t("ha_adresse"), (haZugang() || {}).url || "https://");
    f.addSecureTextField(t("ha_token"), "");
    f.addAction(t("speichern"));
    f.addCancelAction(t("abbrechen"));
    if ((await f.presentAlert()) !== 0) return;
    z = { url: f.textFieldValue(0).trim().replace(/\/+$/, ""), token: f.textFieldValue(1).trim() };
  }
  try {
    await haAnfrage(z, "/api/");
    Keychain.set(K_HA_URL, z.url);
    Keychain.set(K_HA_TOKEN, z.token);
    einstellungen.haSync = true;
    speichereEinstellungen();
    loesche("alditalk-ha-" + vertragIndex + ".json");
    await haSenden(d);
    await hinweis(t("m_ha"), t("ha_ok"));
  } catch (x) {
    await hinweis(t("m_ha"), t("ha_fehler", String(x.message || x)));
  }
}

/** iCloud-Abgleich ein-/ausschalten: geteilte Dateien an den neuen Ort kopieren. */
async function icloudMenue() {
  const a = new Alert();
  a.title = t("m_icloud", ICLOUD);
  a.message = t("icloud_text");
  a.addAction(ICLOUD ? t("icloud_aus") : t("icloud_an"));
  a.addCancelAction(t("abbrechen"));
  if ((await a.presentAlert()) !== 0) return;
  const lokal = FileManager.local(), w = wolke();
  const vonF = ICLOUD ? w : lokal, vonO = ICLOUD ? ORDNER_WOLKE : ORDNER;
  const nachF = ICLOUD ? lokal : w, nachO = ICLOUD ? ORDNER : ORDNER_WOLKE;
  for (const n of vonF.listContents(vonO).filter((x) => SYNC_DATEIEN.test(x))) {
    const quelle = vonF.joinPath(vonO, n), ziel = nachF.joinPath(nachO, n);
    if (ICLOUD && !vonF.isFileDownloaded(quelle)) await vonF.downloadFileFromiCloud(quelle);
    // vorhandene Datei am Ziel (z. B. vom iPad) gewinnt, wenn sie neuer ist
    if (nachF.fileExists(ziel) && nachF.modificationDate(ziel) > vonF.modificationDate(quelle)) continue;
    nachF.writeString(ziel, vonF.readString(quelle));
  }
  const merker = lokal.joinPath(ORDNER, ICLOUD_MERKER);
  if (ICLOUD) lokal.remove(merker); else lokal.writeString(merker, "1");
  await hinweis(t("m_icloud", !ICLOUD), t("icloud_fertig"));
}

async function einstellungsMenue(d) {
  while (true) {
    const a = new Alert();
    a.title = t("einstellungen");
    a.message = `ALDI TALK Widget ${VERSION}`;
    const designNamen = { aldi: t("design_aldi"), dunkel: t("design_dunkel"), hell: t("design_hell"), auto: t("design_auto") };
    const sprachNamen = { auto: t("sprache_auto"), de: t("sprache_de"), en: t("sprache_en") };
    const punkte = [
      [`${t("sprache")}: ${sprachNamen[einstellungen.sprache] || sprachNamen.auto}`, "sprache"],
      [`${t("design")}: ${designNamen[einstellungen.design] || designNamen.aldi}`, "design"],
      [t("e_volumen_warnung", fmtGB(einstellungen.warnGB)), "warnGB"],
      [t("e_guthaben_warnung", fmtEuro(einstellungen.warnGuthaben)), "warnGuthaben"],
      [t("e_mitteilungen", einstellungen.mitteilungen), "mitteilungen"],
      [t("e_tipps", einstellungen.tipps), "tipps"],
      [t("e_budget", einstellungen.budgetWarnung), "budget"],
      [t("m_ha") + ": " + (einstellungen.haSync && haZugang() ? t("ha_an", haHost(haZugang().url)) : t("ha_aus")), "ha"],
      [t("m_icloud", ICLOUD), "icloud"],
      [t("e_erinnerung", einstellungen.erinnerung), "erinnerung"],
      [t("e_intervall", einstellungen.cacheMin), "cacheMin"],
      [t("m_land"), "land"],
    ];
    if (d && d.vertraege && d.vertraege.length > 1) {
      punkte.push([t("e_vertrag", d.vertraege[Math.min(einstellungen.vertrag, d.vertraege.length - 1)].label), "vertrag"]);
      punkte.push([t("e_namen"), "namen"]);
    }
    punkte.push([t("e_verlauf"), "verlauf"]);
    punkte.push([t("e_debug"), "rohdaten"]);
    for (const [tx] of punkte) a.addAction(tx);
    a.addDestructiveAction(t("e_reset"));
    a.addCancelAction(t("fertig"));
    const wahl = await a.presentSheet();
    if (wahl === -1) return;
    if (wahl === punkte.length) {
      if (await bestaetige(t("reset_frage"), t("reset_text"))) {
        vergissZugangsdaten();
        for (const n of fm.listContents(ORDNER).filter((n) => n.startsWith("alditalk-") && n !== ICLOUD_MERKER)) loesche(n);
        if (ICLOUD) for (const n of wolke().listContents(ORDNER_WOLKE).filter((n) => n.startsWith("alditalk-"))) loesche(n);
        Object.assign(einstellungen, STANDARD);
        standort = null;
        roamingWahl = einstellungen.roaming;
        return "reset";
      }
      continue;
    }
    const was = punkte[wahl][1];
    if (was === "sprache") {
      const keys = Object.keys(sprachNamen);
      const w = await auswahl(t("sprache"), keys.map((k) => sprachNamen[k]));
      if (w >= 0) { einstellungen.sprache = keys[w]; spracheWahl = keys[w]; L = ermittleSprache(); }
    } else if (was === "design") {
      const keys = Object.keys(designNamen);
      const w = await auswahl(t("design"), keys.map((k) => designNamen[k]));
      if (w >= 0) { einstellungen.design = keys[w]; designWahl = keys[w]; }
    } else if (was === "warnGB") {
      const v = await zahlEingabe(t("volumen_warnung"), t("volumen_warnung_text"), einstellungen.warnGB);
      if (v !== null) einstellungen.warnGB = Math.max(0, v);
    } else if (was === "warnGuthaben") {
      const v = await zahlEingabe(t("guthaben_warnung"), t("guthaben_warnung_text"), einstellungen.warnGuthaben);
      if (v !== null) einstellungen.warnGuthaben = Math.max(0, v);
    } else if (was === "mitteilungen") {
      einstellungen.mitteilungen = !einstellungen.mitteilungen;
    } else if (was === "budget") {
      einstellungen.budgetWarnung = !einstellungen.budgetWarnung;
    } else if (was === "ha") {
      await haMenue(d);
    } else if (was === "icloud") {
      speichereEinstellungen();
      await icloudMenue();
      return;
    } else if (was === "tipps") {
      einstellungen.tipps = !einstellungen.tipps;
    } else if (was === "erinnerung") {
      const optionen = [0, 1, 3];
      const w = await auswahl(t("erinnerung"), optionen.map((o) => (o ? t("erinnerung_n", o) : t("erinnerung_aus"))));
      if (w >= 0) {
        einstellungen.erinnerung = optionen[w];
        speichereEinstellungen();
        if (optionen[w]) await pflegeErinnerung(d, { melden: true });
        else {
          const gemerkt = liesJSON(ERINNERUNG, {});
          for (const k of Object.keys(gemerkt)) if (gemerkt[k].id) await entferneErinnerung(gemerkt[k].id);
          loesche(ERINNERUNG);
        }
      }
    } else if (was === "namen") {
      const w = await auswahl(t("e_namen"), d.vertraege.map((v) => v.label + ((einstellungen.vertragNamen || {})[v.label] ? " – " + einstellungen.vertragNamen[v.label] : "")));
      if (w >= 0) {
        const label = d.vertraege[w].label;
        const a2 = new Alert();
        a2.title = label;
        a2.message = t("name_text");
        a2.addTextField("", (einstellungen.vertragNamen || {})[label] || "");
        a2.addAction(t("speichern"));
        a2.addCancelAction(t("abbrechen"));
        if ((await a2.presentAlert()) === 0) {
          einstellungen.vertragNamen = Object.assign({}, einstellungen.vertragNamen);
          const name = a2.textFieldValue(0).trim();
          if (name) einstellungen.vertragNamen[label] = name; else delete einstellungen.vertragNamen[label];
        }
      }
    } else if (was === "cacheMin") {
      const optionen = [15, 30, 60, 120];
      const w = await auswahl(t("aktualisieren_alle"), optionen.map((o) => t("minuten_n", o)));
      if (w >= 0) einstellungen.cacheMin = optionen[w];
    } else if (was === "land") {
      speichereEinstellungen();
      await landMenue();
    } else if (was === "rohdaten") {
      const roh = liesJSON(`alditalk-rohdaten-${vertragIndex}.json`, null);
      if (roh) {
        Pasteboard.copyString(JSON.stringify({ version: VERSION, pakete: (d && d.pakete) || [], standort, landManuell: einstellungen.landManuell,
          roaming: roamingWahl, zeitzone: geraeteZeitzone(), portal: roh }, null, 1));
      }
      await hinweis(t("fehlersuche"), roh ? t("debug_kopiert") : t("debug_leer"));
    } else if (was === "vertrag") {
      const w = await auswahl(t("vertrag"), d.vertraege.map((v) => v.label));
      if (w >= 0) { einstellungen.vertrag = w; vertragIndex = w; }
    } else if (was === "verlauf") {
      if (await bestaetige(t("verlauf_frage"), t("verlauf_text"))) {
        loesche(verlaufName("inland"));
        loesche(verlaufName("roaming"));
      }
    }
    speichereEinstellungen();
  }
}

async function auswahl(titel, optionen) {
  const a = new Alert();
  a.title = titel;
  for (const o of optionen) a.addAction(o);
  a.addCancelAction(t("abbrechen"));
  return a.presentSheet();
}

async function hinweis(titel, text) {
  const a = new Alert();
  a.title = titel;
  a.message = text;
  a.addAction(t("ok"));
  await a.presentAlert();
}

async function zahlEingabe(titel, text, wert) {
  const a = new Alert();
  a.title = titel;
  a.message = text;
  const f = a.addTextField("", L === "de" ? String(wert).replace(".", ",") : String(wert));
  f.setDecimalPadKeyboard();
  a.addAction(t("speichern"));
  a.addCancelAction(t("abbrechen"));
  if ((await a.presentAlert()) === -1) return null;
  const v = parseFloat(a.textFieldValue(0).replace(",", "."));
  return isNaN(v) ? null : v;
}

async function bestaetige(titel, text) {
  const a = new Alert();
  a.title = titel;
  a.message = text;
  a.addDestructiveAction(t("ja"));
  a.addCancelAction(t("nein"));
  return (await a.presentAlert()) === 0;
}

// ============================================================
//  Formatierung (Deutsch: 1,50 GB · 3,20 € · 12.10. – English: 1.50 GB · €3.20 · 12 Oct)
// ============================================================
const MONATE_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dezimal(x, stellen) {
  const s = x.toFixed(stellen);
  return L === "de" ? s.replace(".", ",") : s;
}

function fmtGB(v, kurz) {
  if (v === null || v === undefined || isNaN(v)) return "–";
  if (v === Infinity) return "∞";
  const x = Math.max(0, v);
  if (kurz || x >= 10) return dezimal(x, x >= 100 ? 0 : 1);
  return dezimal(x, 2);
}

function fmtEuro(v) {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return L === "de" ? dezimal(v, 2) + " €" : "€" + dezimal(v, 2);
}

/** Akzeptiert "2026-10-12", "2026-10-12 23:59:59", ISO mit Zeitzone und "12.10.2026". */
function parseDatum(s) {
  if (!s) return null;
  const text = String(s).trim();
  const deutsch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  const d = deutsch
    ? new Date(parseInt(deutsch[3], 10), parseInt(deutsch[2], 10) - 1, parseInt(deutsch[1], 10), 23, 59, 59)
    : new Date(text.length === 10 ? text + "T23:59:59" : text.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function resttage(s) {
  const d = parseDatum(s);
  if (!d) return null;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
}

function fmtDatum(ts) {
  const d = new Date(ts);
  if (L === "en") return d.getDate() + " " + MONATE_EN[d.getMonth()];
  return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + ".";
}

function fmtDatumZeit(ts) {
  const d = new Date(ts);
  return fmtDatum(ts) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function fmtAblauf(s, mitTagen = true) {
  const d = parseDatum(s);
  if (!d) return "–";
  const tage = resttage(s);
  return fmtDatum(d.getTime()) + (mitTagen && tage !== null ? ` (${t("tage_kurz", tage)})` : "");
}

function fmtRelativ(ts) {
  if (!ts) return "–";
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return t("gerade_eben");
  if (min < 60) return t("vor_min", min);
  const std = Math.round(min / 60);
  if (std < 24) return t("vor_std", std);
  return t("am", fmtDatum(ts));
}

// ============================================================
//  Updates – prüft einmal am Tag, ob es eine neue Version gibt, und installiert sie
//  (Standard) oder meldet sie. Quelle: github.com/Teyro/Scriptable-Updates – dort liegen
//  nur Versionsnummern und die Skripte; private Skripte verschlüsselt (ChaCha20), den
//  Schlüssel kennt nur dieses Skript. Vor dem Ersetzen wird geprüft, dass die Datei
//  vollständig und echt ist; die alte Fassung bleibt als Sicherung erhalten.
// ============================================================
const UPDATE_ID = "AldiTalk";
const UPDATE_SCHLUESSEL = ""; // leer = öffentliches Skript, unverschlüsselt
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
    const bytes = (await r.load()).getBytes(); // Scriptable: load() liefert Data
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
    if (mitLink) n.openURL = "scriptable:///run/" + encodeURIComponent(AUFRUF_NAME) + "?update=1";
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

// ============================================================
//  Einstieg (am Ende der Datei: alle Funktionen und Konstanten sind dann bereit)
// ============================================================
const param = (args.queryParameters && args.queryParameters.param) || "";
// Aus Siri oder der Kurzbefehle-App (ohne die App zu öffnen): nur einen Satz zurückgeben.
const KURZBEFEHL = !IM_WIDGET && (!!config.runsWithSiri || param === "siri"
  || (config.runsInApp === false && !config.runsInNotification && !config.runsInActionExtension));
// Land prüfen – parallel zum Login. In der App bei jedem Öffnen (höchstens alle 10 Minuten),
// im Widget im eingestellten Abstand und sofort nach einem Zeitzonenwechsel.
if (roamingWahl !== "aus" && !einstellungen.landManuell && param !== "book" && param !== "portal") {
  standortBereit = pruefeStandort({ erzwingen: !IM_WIDGET && !(standort && standort.ts && Date.now() - standort.ts < 10 * 60 * 1000) });
}

if (param === "update" || (args.queryParameters && args.queryParameters.update)) {
  await updateAnbieten({ erzwingen: true });
} else if (param === "book") {
  // Nachbuchen in der Buchungsübersicht (Safari-Sitzung – dort meist schon angemeldet).
  Safari.openInApp(BOOKING, false);
} else if (param === "portal") {
  Safari.openInApp(OVERVIEW, false);
} else if (param === "refresh") {
  await zeigeDashboard(await holeDaten({ erzwingen: true }));
} else if (param === "dashboard") {
  await zeigeDashboard(await holeDaten());
} else if (param === "menu") {
  await hauptmenue();
} else if (KURZBEFEHL) {
  const satz = siriSatz(await holeDaten());
  Script.setShortcutOutput(satz);
  if (config.runsWithSiri) Speech.speak(satz);
} else if (IM_WIDGET && alleVertraege && !(config.widgetFamily || "").startsWith("accessory")) {
  const liste = await holeAlle(async (d) => { await pruefeWarnungen(d); await pflegeErinnerung(d); await haSenden(d); });
  Script.setWidget(alleWidget(liste, config.widgetFamily || "small"));
  await updateImHintergrund();
} else if (IM_WIDGET) {
  const familie = config.widgetFamily || "small";
  const daten = await holeDaten();
  await pruefeWarnungen(daten);
  await pflegeErinnerung(daten);
  await haSenden(daten);
  Script.setWidget(baueWidget(daten, familie));
  await updateImHintergrund();
} else if (!(await updateAnbieten())) {
  await hauptmenue();
}
Script.complete();
