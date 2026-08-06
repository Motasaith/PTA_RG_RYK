/**
 * A minimal but *real* 2D canvas context for Node.
 *
 * It is pixel-backed, and fillRect actually writes pixels, so code that reads its own
 * drawing back — the Sobel normal-map derivation in materials.ts — is genuinely exercised
 * by the tests rather than being skipped over a stub that returns nothing.
 *
 * Vector ops (arc, stroke, gradients) are no-ops: nothing in the game reads those back.
 */

function parseColour(css) {
  if (typeof css !== 'string') return [0, 0, 0, 255];
  const s = css.trim();
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 255];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
  }
  let m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? Math.round(p[3] * 255) : 255];
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    const [h, sat, l] = [p[0] / 360, p[1] / 100, p[2] / 100];
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const pp = 2 * l - q;
    const cv = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return pp + (q - pp) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return pp + (q - pp) * (2 / 3 - t) * 6;
      return pp;
    };
    return [
      Math.round(cv(h + 1 / 3) * 255), Math.round(cv(h) * 255), Math.round(cv(h - 1 / 3) * 255),
      p.length > 3 ? Math.round(p[3] * 255) : 255,
    ];
  }
  return [128, 128, 128, 255];
}

class Ctx2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.font = '';
    this.textAlign = 'left';
    this.textBaseline = 'top';
    this.lineCap = 'butt';
    this.globalAlpha = 1;
    this._data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  get _w() { return this.canvas.width; }
  get _h() { return this.canvas.height; }

  fillRect(x, y, w, h) {
    const [r, g, b, a] = parseColour(this.fillStyle);
    const al = (a / 255) * this.globalAlpha;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this._w, Math.round(x + w)), y1 = Math.min(this._h, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = (py * this._w + px) * 4;
        this._data[i] = this._data[i] * (1 - al) + r * al;
        this._data[i + 1] = this._data[i + 1] * (1 - al) + g * al;
        this._data[i + 2] = this._data[i + 2] * (1 - al) + b * al;
        this._data[i + 3] = 255;
      }
    }
  }

  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const src = ((py + y) * this._w + (px + x)) * 4;
        const dst = (py * w + px) * 4;
        for (let k = 0; k < 4; k++) out[dst + k] = this._data[src + k] ?? 0;
      }
    }
    return { data: out, width: w, height: h };
  }

  createImageData(w, h) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }

  putImageData(img, x, y) {
    for (let py = 0; py < img.height; py++) {
      for (let px = 0; px < img.width; px++) {
        const src = (py * img.width + px) * 4;
        const dst = ((py + y) * this._w + (px + x)) * 4;
        for (let k = 0; k < 4; k++) this._data[dst + k] = img.data[src + k];
      }
    }
  }

  measureText(t) { return { width: String(t).length * 8 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
}

// everything we do not need to read back
for (const m of [
  'strokeRect', 'clearRect', 'beginPath', 'closePath', 'arc', 'fill', 'stroke', 'moveTo',
  'lineTo', 'rect', 'save', 'restore', 'translate', 'rotate', 'scale', 'clip', 'fillText',
  'strokeText', 'drawImage', 'setTransform', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo',
  'ellipse', 'arcTo', 'roundRect', 'transform', 'resetTransform', 'createPattern',
]) {
  Ctx2D.prototype[m] = function noop() {};
}

export function installCanvasStub() {
  const makeCanvas = () => {
    const c = { width: 1, height: 1, style: {} };
    c.getContext = () => {
      if (!c._ctx || c._ctx._w !== c.width || c._ctx._h !== c.height) c._ctx = new Ctx2D(c);
      return c._ctx;
    };
    return c;
  };
  globalThis.document = globalThis.document ?? {};
  globalThis.document.createElement = (tag) => (tag === 'canvas' ? makeCanvas() : { style: {} });
  globalThis.document.createElementNS = () => ({ style: {} });
  globalThis.document.addEventListener = () => {};
  globalThis.document.removeEventListener = () => {};
  globalThis.window = globalThis;
  globalThis.self = globalThis;
}
