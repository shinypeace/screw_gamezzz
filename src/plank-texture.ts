/** Paint the existing lacquered bitmap as a straight beam without stretching its round caps. */
export function drawBeamBitmap(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  length: number,
  width: number,
): void {
  if (length <= 0 || width <= 0 || !image.naturalWidth || !image.naturalHeight) return;

  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  // The illustrated caps occupy approximately half the source height at each end.
  // Only the straight middle contributes the grain, horizontal rim and highlights.
  const inset = Math.min(Math.round(sourceHeight * .62), Math.floor(sourceWidth * .3));
  const pad = Math.max(1, Math.round(sourceHeight * .028));
  const bodyWidth = sourceWidth - inset * 2;
  const bodyHeight = sourceHeight - pad * 2;
  const radius = Math.min(width * .085, length * .1);
  const endWidth = Math.min(width * .075, length * .12);
  const sourceRim = Math.max(3, Math.round(bodyHeight * .085));

  context.save();
  context.translate(x, y);
  context.beginPath();
  context.moveTo(radius, 0);
  context.lineTo(length - radius, 0);
  context.quadraticCurveTo(length, 0, length, radius);
  context.lineTo(length, width - radius);
  context.quadraticCurveTo(length, width, length - radius, width);
  context.lineTo(radius, width);
  context.quadraticCurveTo(0, width, 0, width - radius);
  context.lineTo(0, radius);
  context.quadraticCurveTo(0, 0, radius, 0);
  context.closePath();
  context.clip();

  context.drawImage(image, inset, pad, bodyWidth, bodyHeight, 0, 0, length, width);

  // Turn the bitmap's own bevels onto the cut ends. Their width depends on the
  // beam thickness, never on its length, so even long beams retain square ends.
  context.save();
  context.translate(0, width);
  context.rotate(-Math.PI / 2);
  context.drawImage(image, inset, pad, bodyWidth, sourceRim, 0, 0, width, endWidth);
  context.restore();

  context.save();
  context.translate(length, 0);
  context.rotate(Math.PI / 2);
  context.scale(1, -1);
  context.drawImage(
    image, inset, sourceHeight - pad - sourceRim, bodyWidth, sourceRim,
    0, -endWidth, width, endWidth,
  );
  context.restore();
  context.restore();
}
