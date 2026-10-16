# Component 1 Plan — KMZ/KML Container + Asset Provider

## Ziel

Diese Komponente stellt eine standalone, browser-first TypeScript-Abstraktion für KMZ- und KML-Dateien bereit. Sie soll

- `.kmz`-Archive und `.kml`-Dateien transparent öffnen,
- `doc.kml` lesen und schreiben,
- Assets auflisten und lazy auflösen,
- einen einheitlichen Asset-Provider bereitstellen,
- modifizierte Inhalte sauber als neues Archiv oder neue KML-Ausgabe exportieren,
- ohne Abhängigkeit von Three.js, Redux, WebXR oder Rendering auskommen.

Die Implementierung orientiert sich an der bestehenden Contract-Datei [src/contracts/kmz-container.ts](../contracts/kmz-container.ts) und an der Architektur aus [plan.md](../../plan.md).

---

## Verantwortlichkeiten

### In Scope

- Öffnen von `File` oder `ArrayBuffer`
- Erkennen von KML vs. KMZ
- Extrahieren oder Referenzieren von `doc.kml`
- Auflisten verfügbarer Assets
- Lazy-Auflösung von `href` zu Bytes
- Erzeugen von Blob-URLs für Assets
- Schreiben von geänderten `doc.kml`-Inhalten
- Export als neues Archiv oder als KML-Text
- Deskriptive Fehler für fehlende, beschädigte oder ungültige Inhalte

### Nicht in Scope

- XML-Parsing oder KML-Mutation
- Rendering oder Geo-Logik
- Three.js, Redux oder WebXR
- Dateisystem-Access-API
- Google-Earth-spezifische Semantik

---

## Vertrag und API-Map

Die Umsetzung folgt der in [src/contracts/kmz-container.ts](../contracts/kmz-container.ts) definierten Schnittstelle:

- `IKmzContainer`
  - `open(source)`
  - `getDocKml()`
  - `setDocKml(content)`
  - `listAssets()`
  - `save()`
  - `getAssetProvider()`
  - `dispose()`

- `IAssetProvider`
  - `getAssetUrl(href)`
  - `getAssetBytes(href)`
  - `hasAsset(href)`
  - `dispose()`

- `AssetEntry`
  - `path`
  - `size`
  - `modified`

Die in der Anforderung beschriebene konzeptionelle API (`readKml`, `writeKml`, `getAsset`, etc.) wird intern über die Contracts-Schnittstelle abgebildet.

---

## Architekturvorschlag

Die Implementierung soll modular und austauschbar gehalten werden:

- [src/kmz-io/container.ts](container.ts)
  - Haupt-Implementierung von `IKmzContainer`
  - Koordiniert Öffnen, Lesen, Schreiben und Export

- [src/kmz-io/provider.ts](provider.ts)
  - Implementierung von `IAssetProvider`
  - Verantwortlich für Blob-URL-Erzeugung, Caching und Release

- [src/kmz-io/zip-adapter.ts](zip-adapter.ts)
  - Abstraktionsschicht über die ZIP-Bibliothek
  - Verbirgt `fflate` oder `@zip.js/zip.js` hinter einer kleinen gemeinsamen API

- [src/kmz-io/errors.ts](errors.ts)
  - Deskriptive Fehlerklassen wie `KmzContainerError`, `DocKmlMissingError`, `ArchiveCorruptError`, `UnsupportedEncodingError`, `InvalidHrefError`, `AssetNotFoundError`, `AssetLoadError`

- [src/kmz-io/types.ts](types.ts)
  - Interne Typen für Archiv-Entries, Asset-Resolver-Resultate und Provider-Zustand

- [src/kmz-io/index.ts](index.ts)
  - Export aller öffentlichen Typen und Klassen

---

## Umsetzungsphasen

### Phase 1 — Grundstruktur und Typen

- Ordner und Module anlegen
- Contracts passend implementieren
- Fehlerklassen definieren
- Interne Modellierung für KMZ- und KML-Container festlegen

### Phase 2 — KMZ- und KML-Erkennung

- `open(source)` implementieren
- Prüfen, ob Input ein `File` oder `ArrayBuffer` ist
- Erkennen, ob es sich um ein ZIP-Archiv oder eine reine KML-Datei handelt
- `doc.kml` aus dem Archiv extrahieren bzw. aus dem KML-Text ableiten
- Falls mehrere `doc.kml`-Varianten oder keine passende Datei gefunden wird, sauberen Fehler werfen

### Phase 3 — Asset-Handling

- Archiv-Entries auflisten
- Relative `href`-Werte gegen die KML-Position auflösen
- Remote-URLs (`http`, `https`) on demand laden
- Relative lokale Pfade wie `image.png`, `files/image.png` oder `models/tree/model.dae` unterstützen
- Lazy-Loading nur bei Bedarf; keine unnötigen Kopien im Speicher

### Phase 4 — Asset Provider

- `getAssetUrl(href)` implementieren
- Bytes in `Blob` umwandeln
- `URL.createObjectURL()` nutzen
- Cache pro `href` führen, bis `release`/`dispose` aufgerufen wird
- `getAssetBytes(href)` direkt aus dem Container bereitstellen

### Phase 5 — Schreiben und Export

- `setDocKml(content)` unterstützen
- `save()` implementieren
- Für KMZ:
  - unveränderte Assets byte-identisch erhalten
  - nur geänderte Einträge neu schreiben
  - `doc.kml` aktualisieren
  - Ordnerstruktur beibehalten
- Für KML:
  - nur den aktualisierten XML-Text ausgeben

### Phase 6 — Fehler- und Lifecycle-Handling

- Deskriptive Fehler bei fehlendem Asset, falscher `href`, Netzwerkfehlern und ungültigem Archiv
- Blob-URLs sauber bei `dispose()` oder `release` freigeben
- Keine stillen Fallbacks bei unzulässigen Zuständen

---

## Detail-Design

### Öffnen

- `open(source)` akzeptiert `File | ArrayBuffer`
- Falls `source` ein `File` ist, wird dessen `ArrayBuffer` gelesen
- Der Inhalt wird geprüft:
  - Wenn es sich um ein valides ZIP-Archiv handelt, wird ein KMZ-Container aufgebaut
  - Andernfalls wird angenommen, dass es sich um eine reine KML-Datei handelt
- Für KML wird nur der Text gespeichert; Assets sind nur extern oder remote verfügbar

### `doc.kml`

- Der Container speichert den aktuellen KML-Text als String
- Änderungen werden über `setDocKml()` ersetzt
- Beim Export wird der neue Text verwendet

### Asset-Resolution

Die Auflösung soll folgende Fälle unterstützen:

- `image.png`
- `files/image.png`
- `models/tree/model.dae`
- `textures/diffuse.png`
- `https://...`
- `http://...`

Relative Pfade werden relativ zur Position von `doc.kml` interpretiert. Für reine KML-Dateien werden solche Pfade nur dann aufgelöst, wenn ein externer Resolver vorhanden ist; ansonsten wird ein sinnvoller Fehler geworfen.

### Blob-URL-Cache

- Pro `href` wird maximal eine aktive Blob-URL gehalten
- `getAssetUrl()` erzeugt eine URL nur bei Bedarf
- `release(href)` oder `dispose()` revoke die URL
- Nach dem Freigeben darf der Eintrag erneut erzeugt werden

---

## Tests

Die Implementierung soll die folgenden Fälle abdecken:

1. KMZ öffnen und sofort exportieren
   - KML identisch
   - Asset-Anzahl identisch
   - Asset-Bytes identisch

2. Bekannte Bild-Referenz auflösen
3. COLLADA-Modell auflösen
4. Textur aus einer COLLADA-Referenz auflösen
5. `doc.kml` ersetzen und Archiv exportieren
   - nur KML geändert, übrige Assets byte-identisch

6. Ein Asset ersetzen
   - nur dieses Asset verändert, alles andere identisch

7. Reines KML öffnen und exportieren
   - identischer XML-Text

8. Remote Asset laden
   - Blob-URL wird erzeugt

9. Fehlendes Asset
   - aussagekräftiger Fehler

10. Blob-URL freigeben
   - `URL.revokeObjectURL()` wurde aufgerufen

Die Tests sollten möglichst als unit/integration tests mit kleinen Fixtures aufgebaut werden.

---

## Abnahmekriterien

Die Komponente gilt als abgeschlossen, wenn:

- KMZ-Dateien geöffnet werden können
- KML-Dateien geöffnet werden können
- `doc.kml` lesbar und schreibbar ist
- Assets aufgelistet werden können
- Assets lazy und korrekt aufgelöst werden
- Blob-URLs erzeugt und wieder freigegeben werden
- modifizierte KML-Inhalte exportiert werden können
- modifizierte Assets exportiert werden können
- unveränderte Assets byte-identisch bleiben
- spätere Renderer keine Kenntnis über KMZ vs. KML brauchen

---

## Hinweis zur Umsetzung

Die erste Implementierung soll bewusst klein und sauber bleiben. Der Fokus liegt auf:

- klarer Abstraktion,
- minimalem API,
- stabiler Fehlerbehandlung,
- einfacher Austauschbarkeit der ZIP-Engine.

Die ZIP-Details dürfen intern verborgen bleiben; die Außenwelt arbeitet nur mit dem Container- und Provider-Interface.
