// Kamera-Zugriff: kapselt getUserMedia und das Auslesen eines Einzelbilds.
// Keine UI, keine OCR-Abhängigkeit.

export class Camera {
  /** @param {HTMLVideoElement} video */
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facing = 'environment';
  }

  static get supported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  get active() {
    return !!this.stream;
  }

  async start(facing = this.facing) {
    this.stop();
    this.facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.setAttribute('playsinline', '');
    await this.video.play();
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async flip() {
    await this.start(this.facing === 'environment' ? 'user' : 'environment');
  }

  /**
   * Einzelbild als Canvas. `crop` ist ein Rechteck (0..1) relativ zum
   * sichtbaren Videobereich (Element mit object-fit: cover).
   */
  grab(crop = null) {
    const v = this.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) throw new Error('Kein Videobild verfügbar');

    // Sichtbarer Ausschnitt des Videos in Videopixeln
    const ew = v.clientWidth || vw;
    const eh = v.clientHeight || vh;
    const scale = Math.max(ew / vw, eh / vh);
    const visW = ew / scale;
    const visH = eh / scale;
    const visX = (vw - visW) / 2;
    const visY = (vh - visH) / 2;

    const c = crop || { x: 0, y: 0, w: 1, h: 1 };
    const sx = visX + c.x * visW;
    const sy = visY + c.y * visH;
    const sw = c.w * visW;
    const sh = c.h * visH;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    canvas.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
}

/** Datei (z. B. Foto aus der Galerie) -> Canvas, EXIF-Rotation wird beachtet. */
export async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return canvas;
}
