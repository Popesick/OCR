// <ocr-scanner> – eigenständiges Custom Element (Shadow DOM, kein globales CSS).
//
// Attribute:  lang="deu"  auto-start  frame (Scan-Ausschnitt statt Vollbild)
// Methoden:   start(), stop(), scan(), recognizeFile(file)
// Events (bubbling, composed):
//   ocr-ready    {}                          Kamera läuft
//   ocr-progress {status, progress}          Fortschritt der Erkennung
//   ocr-result   {text, confidence, lines}   Erkennung abgeschlossen
//   ocr-accept   {text, confidence}          Nutzer übernimmt den (ggf. korrigierten) Text
//   ocr-error    {error}

import { Camera, fileToCanvas } from './camera.js';
import { OcrEngine } from './ocr-engine.js';

const FRAME = { x: 0.05, y: 0.3, w: 0.9, h: 0.4 }; // Scan-Ausschnitt (relativ)

const TEMPLATE = `
<style>
  :host { display: block; font: 16px/1.4 system-ui, sans-serif; color: var(--ocr-fg, #111);
          --accent: var(--ocr-accent, #2563eb); }
  * { box-sizing: border-box; }
  .cam { position: relative; background: #000; aspect-ratio: 3 / 4; max-height: 70vh;
         width: 100%; overflow: hidden; border-radius: 12px; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .guide { position: absolute; left: 5%; top: 30%; width: 90%; height: 40%;
           border: 2px solid #fff; border-radius: 8px; pointer-events: none;
           box-shadow: 0 0 0 100vmax rgba(0,0,0,.45); display: none; }
  :host([frame]) .guide { display: block; }
  .placeholder { position: absolute; inset: 0; display: grid; place-items: center;
                 color: #fff; text-align: center; padding: 1rem; }
  .bar { display: flex; gap: .5rem; align-items: center; justify-content: center; padding: .75rem 0; }
  button, label.btn { font: inherit; border: 0; border-radius: 999px; padding: .7rem 1.1rem;
        background: #e5e7eb; color: inherit; cursor: pointer; min-height: 44px; }
  button.primary { background: var(--accent); color: #fff; font-weight: 600; padding: .7rem 1.6rem; }
  button:disabled { opacity: .5; }
  input[type=file] { display: none; }
  .status { font-size: .875rem; color: #555; min-height: 1.4em; text-align: center; }
  progress { width: 100%; height: 6px; }
  .result { display: none; margin-top: .75rem; }
  .result.show { display: block; }
  .result img { max-width: 100%; border-radius: 8px; display: block; margin-bottom: .5rem; }
  textarea { width: 100%; min-height: 9rem; font: inherit; padding: .6rem;
             border: 1px solid #ccc; border-radius: 8px; resize: vertical; }
  .meta { font-size: .8rem; color: #666; margin: .25rem 0 .5rem; }
  [hidden] { display: none !important; }
</style>
<div class="cam">
  <video playsinline muted></video>
  <div class="guide"></div>
  <div class="placeholder">Kamera ist aus</div>
</div>
<div class="bar">
  <button class="flip" title="Kamera wechseln" aria-label="Kamera wechseln">🔄</button>
  <button class="primary shoot">📷 Scannen</button>
  <label class="btn" title="Bild auswählen">🖼️<input type="file" accept="image/*" capture="environment"></label>
</div>
<progress hidden max="1" value="0"></progress>
<div class="status"></div>
<div class="result">
  <img alt="Aufnahme">
  <textarea aria-label="Erkannter Text" spellcheck="false"></textarea>
  <div class="meta"></div>
  <div class="bar">
    <button class="copy">Kopieren</button>
    <button class="primary accept">Übernehmen</button>
  </div>
</div>`;

export class OcrScannerElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = TEMPLATE;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this.$ = {
      video: $('video'), placeholder: $('.placeholder'), shoot: $('.shoot'), flip: $('.flip'),
      file: $('input[type=file]'), progress: $('progress'), status: $('.status'),
      result: $('.result'), img: $('.result img'), text: $('textarea'), meta: $('.meta'),
      copy: $('.copy'), accept: $('.accept'),
    };
    this.camera = new Camera(this.$.video);
    this.engine = null;
    this.busy = false;
  }

  connectedCallback() {
    const { $ } = this;
    $.shoot.onclick = () => this.scan();
    $.flip.onclick = () => this._guard(() => this.camera.flip());
    $.file.onchange = () => {
      const f = $.file.files[0];
      $.file.value = '';
      if (f) this.recognizeFile(f);
    };
    $.copy.onclick = async () => {
      try { await navigator.clipboard.writeText($.text.value); this._status('Kopiert ✓'); }
      catch { $.text.select(); }
    };
    $.accept.onclick = () => this._emit('ocr-accept', {
      text: $.text.value, confidence: this._last?.confidence ?? null,
    });
    this._onVis = () => { if (document.hidden) this.stop(); };
    document.addEventListener('visibilitychange', this._onVis);

    if (!Camera.supported || !isSecureContext) {
      this._status('Kamera nicht verfügbar (HTTPS erforderlich) – Bild-Auswahl nutzen.');
      $.shoot.disabled = $.flip.disabled = true;
    } else if (this.hasAttribute('auto-start')) {
      this.start();
    } else {
      $.placeholder.innerHTML = '<button class="primary">Kamera starten</button>';
      $.placeholder.firstChild.onclick = () => this.start();
    }
  }

  disconnectedCallback() {
    document.removeEventListener('visibilitychange', this._onVis);
    this.stop();
    this.engine?.terminate();
    this.engine = null;
  }

  async start() {
    await this._guard(async () => {
      await this.camera.start();
      this.$.placeholder.hidden = true;
      this._status('');
      this._emit('ocr-ready');
      this._engine().init().catch(() => {}); // Sprachdaten schon im Hintergrund laden
    });
  }

  stop() {
    this.camera.stop();
    this.$.placeholder.hidden = false;
  }

  /** Aktuelles Kamerabild erkennen. */
  async scan() {
    if (!this.camera.active) return this.start();
    const crop = this.hasAttribute('frame') ? FRAME : null;
    await this._run(() => this.camera.grab(crop));
  }

  /** Bilddatei erkennen (Galerie / Kamera-App-Fallback). */
  async recognizeFile(file) {
    await this._run(() => fileToCanvas(file));
  }

  _engine() {
    this.engine ??= new OcrEngine({
      lang: this.getAttribute('lang') || 'deu',
      onProgress: (p) => {
        this.$.progress.hidden = false;
        this.$.progress.value = p.progress;
        this._status(labelFor(p.status));
        this._emit('ocr-progress', p);
      },
    });
    return this.engine;
  }

  async _run(getCanvas) {
    if (this.busy) return;
    this.busy = true;
    this.$.shoot.disabled = true;
    await this._guard(async () => {
      const canvas = await getCanvas();
      this.$.img.src = canvas.toDataURL('image/jpeg', 0.7);
      const res = await this._engine().recognize(canvas);
      this._last = res;
      this.$.text.value = res.text;
      this.$.meta.textContent = `Sicherheit: ${Math.round(res.confidence)} % · ${res.lines.length} Zeilen`;
      this.$.result.classList.add('show');
      this._status(res.text ? 'Fertig' : 'Kein Text erkannt – näher ran / mehr Licht.');
      this._emit('ocr-result', res);
    });
    this.$.progress.hidden = true;
    this.$.shoot.disabled = false;
    this.busy = false;
  }

  async _guard(fn) {
    try { await fn(); }
    catch (error) {
      this._status('Fehler: ' + (error.message || error));
      this._emit('ocr-error', { error });
    }
  }

  _status(t) { this.$.status.textContent = t; }
  _emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}

function labelFor(status) {
  const map = {
    'loading tesseract core': 'Lade OCR-Engine …',
    'initializing tesseract': 'Initialisiere …',
    'loading language traineddata': 'Lade Sprachdaten …',
    'initializing api': 'Initialisiere …',
    'recognizing text': 'Erkenne Text …',
  };
  return map[status] || status;
}

if (!customElements.get('ocr-scanner')) customElements.define('ocr-scanner', OcrScannerElement);
