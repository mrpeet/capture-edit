# CaptureEdit

Browser-Extension für **Brave/Chrome/Edge** und **Firefox**: Audio-Clips aus einem YouTube-Video oder einer Datei holen, zuschneiden, auf Soundboard-Länge bringen und per Klick ins **Discord-Soundboard** laden, als Datei speichern oder in einen Ordner legen.

*English in short: record or open an audio clip, cut/trim/time-stretch it to Discord's 5-second soundboard limit, then upload it to one or more Discord servers (own bot) or save it. Manifest V3, no dependencies, German UI.*

## Funktionen

- **Quellen:** YouTube-Ton aufnehmen (Panel direkt auf der Seite) oder Audiodatei laden (mp3, wav, ogg, m4a …)
- **Schneiden:** Wellenform mit Auswahl, Zoom, Cut (Stück herausschneiden), Trim (nur Auswahl behalten), Undo/Redo, Play/Pause und Schleife
- **Formen:** Ziellänge (Standard 5 s) per Tempo-Stretch (Tonhöhe bleibt) oder Speed-Stretch, Fades, Lautstärke, Normalisieren, Ergebnis vorhören
- **Senden:** immer nur die Auswahl wird ausgegeben, an eines oder mehrere **Ziele**:
  - Discord-Soundboard (mehrere Server und Bots möglich, mit Anzeige freier Plätze)
  - Datei herunterladen (MP3/WAV)
  - Ordner (Unterordner im Download-Ordner)
  - Gerät (z. B. PocketSampler) – vorbereitet, kommt später
- Keine Server, kein Tracking, keine Abhängigkeiten zur Laufzeit außer dem mitgelieferten MP3-Encoder

## Installation

Fertige Pakete liegen unter *Releases*. Alternativ selbst bauen:

```bash
git clone https://github.com/mrpeet/capture-edit.git
cd capture-edit
npm run pack        # erzeugt release/*.zip und dist/chrome, dist/firefox
```

### Brave, Chrome, Edge

1. `brave://extensions` (Chrome: `chrome://extensions`) öffnen, **Entwicklermodus** einschalten.
2. **Entpackte Erweiterung laden** und den Ordner `dist/chrome` wählen (oder das ZIP aus `release/` vorher entpacken).

### Firefox

1. `about:debugging#/runtime/this-firefox` öffnen, **Temporäres Add-on laden**, `dist/firefox/manifest.json` wählen.
2. Temporäre Add-ons verschwinden beim Neustart. Dauerhaft geht es mit Firefox Developer Edition/Nightly (`xpinstall.signatures.required` auf `false`) oder einer kostenlosen Signatur über addons.mozilla.org („nicht gelistet“).
3. Fehlt das Aufnahme-Panel auf YouTube: `about:addons` → CaptureEdit → Berechtigungen → Zugriff auf youtube.com erlauben.

## Benutzen

1. **Aufnehmen:** Auf YouTube erscheint oben rechts ein Panel. „Clip aufnehmen“ startet die Aufnahme des Videotons (Echtzeit, stoppt automatisch oder per „Stopp“), danach öffnet sich der Editor. Werbung wird mit aufgenommen – vorher überspringen. **Oder** im Editor eine Datei hineinziehen.
2. **Schneiden:** In der Wellenform eine Auswahl ziehen (Kanten lassen sich anfassen, Mausrad zoomt). Leertaste = Abspielen/Pause, Entf = Cut, Strg+Z/Y = Undo/Redo.
3. **Formen:** Ziellänge und Stretch-Modus wählen, Fades und Lautstärke einstellen, mit „Ergebnis anhören“ prüfen.
4. **Senden:** Name vergeben, beim gewünschten Ziel auf „Senden“ klicken.

## Discord einrichten

Pro Server ein Ziel unter **Ziele → Ziel hinzufügen → Discord-Soundboard**:

1. [discord.com/developers/applications](https://discord.com/developers/applications): App anlegen → **Bot** → **Reset Token** → Token sofort kopieren (es gilt immer nur der neueste).
2. **OAuth2 → URL Generator**: Scope `bot`, Berechtigung **Create Expressions** (zur Sicherheit auch *Manage Expressions*), Link kopieren und öffnen, Bot auf den Server einladen. Der Link muss nicht gespeichert werden.
3. In Discord Entwicklermodus einschalten (Einstellungen → Erweitert), Rechtsklick auf den Server → **Server-ID kopieren**.
4. In CaptureEdit Token und Server-ID eintragen, **Verbindung testen**.

Limits des Soundboards: MP3 oder Ogg, höchstens 512 KB und 5,2 s. Der Upload nutzt immer MP3 (5 s ≈ 80 KB). Die Plätze richten sich nach dem Boost-Level des Servers (8/24/36/48, geschätzt).

**Datenschutz:** Der Token liegt nur im lokalen Speicher deines Browsers und wird nur an `discord.com` gesendet. Er steckt nirgends im Code. Wer die Extension weitergibt, gibt niemals den eigenen Token mit.

## Eigenes Ziel ergänzen

Ziele sind kleine Einträge in [`src/lib/targets.js`](src/lib/targets.js): Felder fürs Formular, `validate`, `send(cfg, job)` und optional `probe`/`status`. Die Oberfläche (Liste, Formular, Ziele-Fenster) entsteht daraus automatisch.

## Entwicklung

```bash
npm test        # Tests der Bibliotheken (Node ≥ 20, keine Abhängigkeiten)
npm run build   # dist/chrome und dist/firefox
npm run pack    # zusätzlich release/*.zip
npm run dev     # Editor ohne Extension auf http://localhost:5173/editor/editor.html
```

Aufbau: `src/lib` (Clip-Bearbeitung, Stretch, MP3/WAV, Discord, Ziele, Einstellungen), `src/editor` (Oberfläche, Wellenform), `src/content/youtube.js` (Aufnahme-Panel), `src/background.js` (öffnet den Editor), `src/rules` (Header-Regel für Discord), `manifests/` (je Browser).

Hinweise zu den Browsern: Die Aufnahme nutzt `captureStream()` am Video-Element statt `tabCapture`, damit sie in beiden Browsern gleich funktioniert. Die Anfragen an Discord werden per `declarativeNetRequest` als Bot gekennzeichnet, weil Discord Browser-Anfragen mit Bot-Token sonst teils blockt.

## Rechtliches

Gedacht für den **privaten Gebrauch** mit Inhalten, an denen du die nötigen Rechte hast. Das Aufnehmen von YouTube-Inhalten kann gegen deren Nutzungsbedingungen und das Urheberrecht verstoßen – das liegt in deiner Verantwortung. Kein Bezug zu YouTube, Google, Discord oder Mozilla.

## Lizenz

[MIT](LICENSE). Enthält [lamejs](https://github.com/zhuker/lamejs) (LGPL-3.0, `src/vendor/`) für die MP3-Kodierung.
