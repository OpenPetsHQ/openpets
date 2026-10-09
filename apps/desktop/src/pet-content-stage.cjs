function createPetContentStageController(document) {
  let receivedScaleOverride = null;

  const applyReceivedScaleOverride = () => {
    if (receivedScaleOverride === null) return;
    const sprite = document.querySelector(".sprite, .installed-sprite");
    if (sprite) sprite.style.transform = `scale(${receivedScaleOverride})`;
  };

  const replaceStage = (bodyHtml) => {
    const currentStage = document.querySelector(".stage");
    if (currentStage) {
      try {
        const template = document.createElement("template");
        template.innerHTML = bodyHtml.trim();
        const newStage = template.content && template.content.firstElementChild;
        if (newStage && newStage.classList && newStage.classList.contains("stage")) {
          currentStage.replaceWith(newStage);
        } else {
          currentStage.outerHTML = bodyHtml;
        }
      } catch {
        currentStage.outerHTML = bodyHtml;
      }
    } else {
      document.body.insertAdjacentHTML("afterbegin", bodyHtml);
    }
    applyReceivedScaleOverride();
  };

  const setScaleOverride = (scale) => {
    const value = Number(scale);
    if (!Number.isFinite(value) || value < 0.25 || value > 3) return;
    receivedScaleOverride = value;
    applyReceivedScaleOverride();
  };

  return { replaceStage, setScaleOverride };
}

module.exports = { createPetContentStageController };
