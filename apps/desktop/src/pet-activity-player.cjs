/** Renders an admitted Classic activity; the body coordinator owns arbitration. */
function createNativePetActivityPlayer(options) {
  const { document, createImage, setTimeout, clearTimeout, now } = options;
  let current = null;

  const clear = (playback) => {
    clearTimeout(playback.timer);
    playback.image.onload = null;
    playback.image.onerror = null;
    playback.image.src = "";
    playback.element?.remove();
  };

  const finish = (playback, outcome) => {
    if (current !== playback) return;
    current = null;
    clear(playback);
    playback.onOutcome(outcome);
  };

  const cancel = (generation) => {
    if (!current || current.generation !== generation) return;
    finish(current, "cancelled");
  };

  const refreshStage = () => {
    if (!current?.element) return;
    const shell = document.querySelector(".pet-shell");
    if (!shell) {
      finish(current, "failed");
      return;
    }
    shell.appendChild(current.element);
  };

  const play = (payload, onOutcome) => {
    if (current) finish(current, "cancelled");
    if (typeof payload.imageUrl !== "string" || !payload.imageUrl.startsWith("data:image/webp;base64,")
      || !Number.isInteger(payload.frameCount) || payload.frameCount < 4 || payload.frameCount > 32
      || !Number.isInteger(payload.fps) || payload.fps < 1 || payload.fps > 12
      || typeof payload.scale !== "number" || !Number.isFinite(payload.scale) || payload.scale <= 0) {
      onOutcome("failed");
      return;
    }
    const image = createImage();
    const playback = { generation: payload.generation, image, element: null, timer: null, onOutcome };
    current = playback;
    playback.timer = setTimeout(() => finish(playback, "failed"), 3_000);
    image.onerror = () => finish(playback, "failed");
    image.onload = () => {
      if (current !== playback) return;
      image.onload = null;
      image.onerror = null;
      clearTimeout(playback.timer);
      const shell = document.querySelector(".pet-shell");
      if (!shell || image.naturalWidth !== payload.frameCount * 192 || image.naturalHeight !== 208) {
        finish(playback, "failed");
        return;
      }
      const element = document.createElement("div");
      playback.element = element;
      element.className = "native-activity-sprite";
      // Match the base sprite's local box/transform; the shell owns baseline and flip.
      element.style.cssText = `position:absolute;left:0;top:0;width:192px;height:208px;transform:scale(${payload.scale});transform-origin:top left;background-repeat:no-repeat;background-size:${payload.frameCount * 192}px 208px;pointer-events:none;`;
      element.style.backgroundImage = `url("${payload.imageUrl}")`;
      element.style.backgroundPosition = "0px 0px";
      shell.appendChild(element);
      const startedAt = now();
      const duration = payload.frameCount * 1_000 / payload.fps;
      onOutcome("started");
      const step = () => {
        if (current !== playback) return;
        const elapsed = now() - startedAt;
        if (elapsed >= duration) {
          finish(playback, "completed");
          return;
        }
        const frame = Math.min(payload.frameCount - 1, Math.floor(elapsed * payload.fps / 1_000));
        element.style.backgroundPosition = `${-frame * 192}px 0px`;
        playback.timer = setTimeout(step, Math.max(1, Math.min(duration - elapsed, (frame + 1) * 1_000 / payload.fps - elapsed)));
      };
      step();
    };
    image.src = payload.imageUrl;
  };

  const dispose = () => {
    if (current) finish(current, "cancelled");
  };

  return { play, cancel, refreshStage, dispose };
}

module.exports = { createNativePetActivityPlayer };
