// OCR-Engine: kapselt Tesseract.js (lazy geladen). Keine UI, keine Kamera.
//
// const ocr = new OcrEngine({ lang: 'deu' });
// const { text, confidence, lines } = await ocr.recognize(canvas);

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => {
      loading = null;
      reject(new Error('Tesseract.js konnte nicht geladen werden (offline?)'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Verkleinern + Graustufen + Kontrastspreizung: bessere Ergebnisse, schneller. */
export function preprocess(source, { maxSize = 1800, enhance = true } = {}) {
  const k = Math.min(1, maxSize / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * k);
  canvas.height = Math.round(source.height * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (!enhance) return canvas;

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) * 255) / range;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export class OcrEngine {
  /**
   * @param {object} o
   * @param {string} [o.lang]  Tesseract-Sprachcode, z. B. 'deu', 'eng', 'deu+eng'
   * @param {(p:{status:string, progress:number})=>void} [o.onProgress]
   */
  constructor({ lang = 'deu', onProgress = null } = {}) {
    this.lang = lang;
    this.onProgress = onProgress;
    this.worker = null;
    this._init = null;
  }

  /** Lädt Bibliothek, WASM und Sprachdaten. Wird bei Bedarf automatisch aufgerufen. */
  init() {
    this._init ??= (async () => {
      const T = await loadTesseract();
      this.worker = await T.createWorker(this.lang, 1, {
        logger: (m) => this.onProgress?.({ status: m.status, progress: m.progress ?? 0 }),
      });
    })().catch((e) => {
      this._init = null;
      throw e;
    });
    return this._init;
  }

  /** @param {HTMLCanvasElement|HTMLImageElement|Blob|string} image */
  async recognize(image, { enhance = true } = {}) {
    await this.init();
    const input = image instanceof HTMLCanvasElement ? preprocess(image, { enhance }) : image;
    const { data } = await this.worker.recognize(input);
    return {
      text: data.text.trim(),
      confidence: data.confidence, // 0..100
      lines: (data.lines || []).map((l) => ({
        text: l.text.trim(),
        confidence: l.confidence,
        bbox: l.bbox,
      })),
    };
  }

  async terminate() {
    await this.worker?.terminate();
    this.worker = null;
    this._init = null;
  }
}
