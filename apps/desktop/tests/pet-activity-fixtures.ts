export const petActivityFixture = {
  id: "dance",
  displayName: "Dance",
  outfitId: "default",
  spritesheetPath: "activities/dance.webp",
  frameCount: 8,
  fps: 4,
} as const;

/** Visible artwork on a fully transparent background in every 192×208 frame. */
export function createPetActivityPixels(frameCount = 8, visiblePixels = 400, alpha = 255): Buffer {
  const width = 192 * frameCount;
  const pixels = Buffer.alloc(width * 208 * 4);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let pixel = 0; pixel < visiblePixels; pixel += 1) {
      const x = frame * 192 + 40 + pixel % 20;
      const y = 40 + Math.floor(pixel / 20);
      const offset = (y * width + x) * 4;
      pixels[offset] = 20;
      pixels[offset + 1] = 40;
      pixels[offset + 2] = 60;
      pixels[offset + 3] = alpha;
    }
  }
  return pixels;
}

/** Only the final frame is empty, catching validators that inspect just frame one. */
export function createPetActivityEmptyFramePixels(frameCount = 8): Buffer {
  const pixels = createPetActivityPixels(frameCount);
  const width = 192 * frameCount;
  for (let y = 0; y < 208; y += 1) {
    const lastFrameOffset = (y * width + (frameCount - 1) * 192) * 4;
    pixels.fill(0, lastFrameOffset, lastFrameOffset + 192 * 4);
  }
  return pixels;
}
