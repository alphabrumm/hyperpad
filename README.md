# HyperPad – HTML-Seiten bauen am iPad

HyperPad ist ein touchfreundlicher HTML-Editor für den Unterricht. Links steht der Code, rechts
erscheint sofort die fertige Webseite. Gestaltung und Bedienung entsprechen
[JPad](https://github.com/alphabrumm/jpad) – wer JPad kennt, findet sich sofort zurecht.

## Funktionen

- **Editor links, Live-Vorschau rechts** (iPad quer, Laptop). Auf dem Handy und am iPad hochkant
  wechselt man unten zwischen *Code*, *Vorschau* und *Probleme*. Der Knopf rechts neben den
  Dateireitern vergrößert den Editor auf volle Breite.
- **Mehrere Dateien in Reitern**: HTML-Seiten, CSS-Dateien, JavaScript-Dateien und Bilder.
  Ein Tipp auf den aktiven Reiter öffnet Umbenennen, Einzeln sichern und Löschen.
  Beim Umbenennen bietet HyperPad an, Links und Verweise in den anderen Dateien anzupassen.
- **Autovervollständigung für Tags und Attribute** (CodeMirror 6): `<ul` + Enter ergibt
  `<ul>|</ul>`, `<img` ergibt `<img src="|" alt="">`, `<a` ergibt `<a href="|"></a>`, Attribute werden
  mit `=""` eingefügt. Die Vorschlagsliste erklärt jedes Tag auf Deutsch („Überschrift 2. Ordnung“).
- **Tags werden sofort geschlossen**: Wer `<p>` tippt, bekommt `</p>` dazu; `</` ergänzt das passende
  schließende Tag. Enter zwischen `<ul>` und `</ul>` rückt sauber ein.
- **Syntax-Hervorhebung** für HTML und eingebettetes bzw. eigenes CSS und JavaScript, hell und dunkel.
- **Fehlerhinweise für Schüler**: nicht geschlossene oder falsch verschachtelte Tags, unbekannte Tags
  (Tippfehler wie `<dvi>`), CSS-Schreibfehler und JavaScript-Fehler der Seite. Der Hinweis zur
  Cursorzeile steht unter dem Editor (kein Mouse-over nötig), alle Hinweise in der Liste *Probleme*.
- **Colors**: Der gelbe Knopf oben öffnet alle 148 HTML/CSS-Farbnamen mit Farbmuster, Suche
  (auch deutsch: „rot“, „grün“ …) und Sortierung nach Farbton. Ein Tipp kopiert die Farbe als
  Name, `#Hex` oder `rgb(…)`.
- **Links funktionieren in der Vorschau**: Ein Link auf `seite2.html` öffnet diese Seite des Projekts,
  `#anker` springt innerhalb der Seite, Links ins Internet öffnen einen neuen Tab. Eingebundene
  CSS-, JavaScript- und Bilddateien des Projekts werden automatisch verwendet.
- **Hilfsleiste über der Bildschirmtastatur** mit `< > </ / ="" " " { } : ; #` usw., Cursortasten,
  Vorschlägen und Info zum Tag am Cursor (auf dem Handy fest unter den Dateireitern).
- **Ohne Login, ohne Server**: Projekte werden automatisch im Browser gespeichert und lassen sich als
  Datei `Name.hyperpad.json` sichern und wieder öffnen (iPad: Teilen-Menü → „In Dateien sichern“,
  AirDrop, Teams, mebis …). Einzelne `.html`-Dateien lassen sich ebenfalls als Projekt öffnen.
- **Offline nutzbar**, wenn HyperPad auf dem Home-Bildschirm installiert wird
  (Teilen → „Zum Home-Bildschirm“). Das schützt zugleich die lokal gespeicherten Projekte davor,
  dass Safari sie nach längerer Nichtnutzung löscht.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `index.html`, `src/main.ts` | Einstieg |
| `src/App.ts` | Oberfläche: Kopfzeile, Dateireiter, Vorschau, Probleme, Menü |
| `src/Editor.ts` | CodeMirror-Editor, Vervollständigung mit vollständigen Tags |
| `src/Preview.ts` | Vorschau im abgeschotteten iframe, Links zwischen Seiten, eingebundene Dateien |
| `src/lint.ts` | Fehlerhinweise für HTML und CSS |
| `src/ColorBook.ts`, `src/cssColors.ts` | Colors-Fenster |
| `src/KeyBar.ts` | Hilfsleiste über der Bildschirmtastatur |
| `src/ProjectStore.ts` | Projektliste (localStorage), Dateien (IndexedDB), Import/Export |
| `src/hyperpad.css` | Gestaltung (aus JPad übernommen), Hell/Dunkel |

## Bauen

```
npm install
npm run build
```

Das Ergebnis liegt in `dist/` und kann auf jeden Webspace mit HTTPS hochgeladen werden
(eine `.htaccess` für Apache liegt bei). Bei jedem Push auf `main` baut GitHub Actions HyperPad,
veröffentlicht es auf GitHub Pages und stellt den Ordner als Artefakt „hyperpad-webspace“ bereit.
Damit das Veröffentlichen klappt, muss unter *Settings → Pages* als Quelle „GitHub Actions“ gewählt sein.

Der Workflow „Abhängigkeiten paketieren“ legt `node_modules` im Branch `deps-cache` ab, damit
Umgebungen ohne npm-Zugang bauen und testen können.
