/** Dedicated native strip player. Never owns or clears plugin sprite state. */
function createNativePetActivityPlayer(options) {
  const { document, createImage, setTimeout, clearTimeout, now, onComplete } = options;
  let current = null;
  let latestGeneration = 0;

  const clear = (playback) => {
    clearTimeout(playback.timer);
    playback.image.onload = null;
    playback.image.onerror = null;
    playback.image.src = "";
    if (playback.element) playback.element.remove();
    if (!document.querySelector(".plugin-sprite-override")) {
      const base = document.querySelector(".pet-shell .sprite, .pet-shell .installed-card");
      if (base) base.style.visibility = "";
    }
  };

  const cancel = (generation) => {
    if (!current || (generation !== undefined && current.generation !== generation)) return;
    const playback = current;
    current = null;
    clear(playback);
  };

  const finish = (playback, failed) => {
    if (current !== playback) return;
    current = null;
    clear(playback);
    onComplete({ generation: playback.generation, failed });
  };

  const refreshStage = () => {
    if (!current?.element) return;
    const shell = document.querySelector(".pet-shell");
    if (!shell || document.querySelector(".plugin-sprite-override")) {
      finish(current, true);
      return;
    }
    const base = shell.querySelector(".sprite, .installed-card");
    if (base) base.style.visibility = "hidden";
    shell.appendChild(current.element);
  };

  const play = (payload) => {
    if (!payload || !Number.isSafeInteger(payload.generation)) return;
    if (payload.cancel === true) {
      cancel(payload.generation);
      return;
    }
    if (payload.generation <= latestGeneration) return;
    latestGeneration = payload.generation;
    cancel();
    if (typeof payload.imageUrl !== "string" || !payload.imageUrl.startsWith("data:image/webp;base64,")) return;
    if (!Number.isInteger(payload.frameCount) || payload.frameCount < 4 || payload.frameCount > 32) return;
    if (!Number.isInteger(payload.fps) || payload.fps < 1 || payload.fps > 12) return;
    if (typeof payload.scale !== "number" || !Number.isFinite(payload.scale) || payload.scale <= 0) return;
    const image = createImage();
    const playback = { generation: payload.generation, image, element: null, timer: null };
    current = playback;
    playback.timer = setTimeout(() => finish(playback, true), 3_000);
    image.onerror = () => finish(playback, true);
    image.onload = () => {
      if (current !== playback) return;
      image.onload = null;
      image.onerror = null;
      clearTimeout(playback.timer);
      const shell = document.querySelector(".pet-shell");
      if (!shell || document.querySelector(".plugin-sprite-override") || image.naturalWidth !== payload.frameCount * 192 || image.naturalHeight !== 208) {
        finish(playback, true);
        return;
      }
      const element = document.createElement("div");
      playback.element = element;
      element.className = "native-activity-sprite";
      // Match the base sprite's local box/transform; the shell owns baseline and flip.
      element.style.cssText = `position:absolute;left:0;top:0;width:192px;height:208px;transform:scale(${payload.scale});transform-origin:top left;background-repeat:no-repeat;background-size:${payload.frameCount * 192}px 208px;pointer-events:none;`;
      element.style.backgroundImage = `url("${payload.imageUrl}")`;
      const base = shell.querySelector(".sprite, .installed-card");
      if (base) base.style.visibility = "hidden";
      shell.appendChild(element);
      const startedAt = now();
      const duration = payload.frameCount * 1_000 / payload.fps;
      const step = () => {
        if (current !== playback) return;
        const elapsed = now() - startedAt;
        if (elapsed >= duration) {
          finish(playback, false);
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

  return { play, cancel, refreshStage };
}

module.exports = { createNativePetActivityPlayer };
