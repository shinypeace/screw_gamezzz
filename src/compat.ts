/** Vite transpiles syntax, but older VK WebViews still need these web APIs. */
type Radius = { x: number; y: number };

export function installCanvasRoundRect(Context: { prototype: object } | undefined =
  typeof CanvasRenderingContext2D === 'undefined' ? undefined : CanvasRenderingContext2D): void {
  if (!Context) return;
  const prototype = Context.prototype as CanvasRenderingContext2D;
  if (typeof prototype.roundRect === 'function') return;
  Object.defineProperty(prototype, 'roundRect', {
    configurable: true, writable: true,
    value: function (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
      radii: number | DOMPointInit | Iterable<number | DOMPointInit> = 0): void {
      const values = typeof radii === 'object' && radii !== null && Symbol.iterator in radii
        ? Array.from(radii as Iterable<number | DOMPointInit>) : [radii as number | DOMPointInit];
      if (values.length < 1 || values.length > 4) throw new RangeError('Expected one to four corner radii');
      const corners: Radius[] = values.map(value => typeof value === 'number'
        ? { x: value, y: value } : { x: value.x ?? 0, y: value.y ?? 0 });
      if (corners.some(radius => radius.x < 0 || radius.y < 0)) throw new RangeError('Corner radii cannot be negative');
      if (![x, y, width, height, ...corners.flatMap(radius => [radius.x, radius.y])].every(Number.isFinite)) return;
      let [tl, tr, br, bl] = corners.length === 1 ? [corners[0], corners[0], corners[0], corners[0]]
        : corners.length === 2 ? [corners[0], corners[1], corners[0], corners[1]]
        : corners.length === 3 ? [corners[0], corners[1], corners[2], corners[1]] : corners;
      if (width < 0) { x += width; width = -width; [tl, tr, br, bl] = [tr, tl, bl, br]; }
      if (height < 0) { y += height; height = -height; [tl, tr, br, bl] = [bl, br, tr, tl]; }
      const factor = Math.min(1, width / (tl.x + tr.x || 1), width / (bl.x + br.x || 1),
        height / (tl.y + bl.y || 1), height / (tr.y + br.y || 1));
      [tl, tr, br, bl] = [tl, tr, br, bl].map(radius => ({ x: radius.x * factor, y: radius.y * factor }));
      const corner = (cx: number, cy: number, radius: Radius, start: number, end: number) => {
        if (!radius.x || !radius.y) this.lineTo(cx + Math.cos(end) * radius.x, cy + Math.sin(end) * radius.y);
        else this.ellipse(cx, cy, radius.x, radius.y, 0, start, end);
      };
      this.moveTo(x + tl.x, y);
      this.lineTo(x + width - tr.x, y); corner(x + width - tr.x, y + tr.y, tr, -Math.PI / 2, 0);
      this.lineTo(x + width, y + height - br.y); corner(x + width - br.x, y + height - br.y, br, 0, Math.PI / 2);
      this.lineTo(x + bl.x, y + height); corner(x + bl.x, y + height - bl.y, bl, Math.PI / 2, Math.PI);
      this.lineTo(x, y + tl.y); corner(x + tl.x, y + tl.y, tl, Math.PI, Math.PI * 1.5);
      this.closePath();
      this.moveTo(x, y);
    },
  });
}

export function installObjectHasOwn(): void {
  if (typeof Object.hasOwn === 'function') return;
  Object.defineProperty(Object, 'hasOwn', {
    configurable: true, writable: true,
    value: (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key),
  });
}

installObjectHasOwn();
installCanvasRoundRect();
