# OCR-Tool (Mobile First)

Kamera → Foto → Texterkennung im Browser (Tesseract.js, komplett clientseitig).

## Starten
Kamera-Zugriff braucht **HTTPS** oder `localhost`.

    cd ocr-tool && python3 -m http.server 8080      # Desktop: http://localhost:8080
    # Handy: z. B. `npx localtunnel --port 8080` oder auf GitHub Pages/Netlify legen

## Struktur
| Datei | Aufgabe |
|---|---|
| `src/camera.js` | getUserMedia, Frontkamera/Rückkamera, Frame-Grab, Datei→Canvas |
| `src/ocr-engine.js` | Tesseract-Wrapper (lazy), Preprocessing, `recognize(canvas)` |
| `src/ocr-scanner.js` | `<ocr-scanner>` Web Component (Shadow DOM) |
| `index.html` | Testseite |

## Einbindung ins Pubquiz-Tool
    <script type="module" src="ocr-tool/src/ocr-scanner.js"></script>
    <ocr-scanner lang="deu" frame></ocr-scanner>

    el.addEventListener('ocr-accept', e => fillAnswer(e.detail.text));

Ohne UI (z. B. eigene Oberfläche): `Camera` und `OcrEngine` direkt importieren.
Styling per CSS-Variablen: `--ocr-accent`, `--ocr-fg`.

## Hinweise
- Erster Scan lädt ~15 MB (WASM + Sprachdaten, danach vom Browser gecacht).
- Für Offline-Betrieb Tesseract-Dateien selbst hosten (`TESSERACT_URL` + `workerPath/corePath/langPath` in `ocr-engine.js`).
- Handschrift wird von Tesseract nur schlecht erkannt; für gedruckten Text gut.
