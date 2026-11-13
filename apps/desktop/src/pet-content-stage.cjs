const { calculateMotionLayout, motionLayoutCssVariables } = require('./pet-motion-layout.ts');

/** Commits only a candidate whose artwork is usable, preserving the current presentation until then. */
function createPetContentStageController(document, options = {}) {
  const parseDocument = options.parseDocument ?? ((html) => new DOMParser().parseFromString(html, 'text/html'));
  const createImage = options.createImage ?? (() => new Image());
  const createStyleSheet = options.createStyleSheet ?? (() => new CSSStyleSheet());
  let receivedScaleOverride = null;
  let generation = 0;
  let loadingImage = null;
  let pendingMotion = null;
  let pendingPresentation = null;
  let visibleMotion = null;
  let disposed = false;

  function applyCurrentLayout() {
    const sprite = document.querySelector('.sprite, .installed-sprite');
    if (!sprite) return;
    if (sprite.hasAttribute('data-motion-body')) {
      const input = JSON.parse(sprite.getAttribute('data-motion-layout'));
      const layout = calculateMotionLayout({ ...input, requestedScale: receivedScaleOverride ?? input.requestedScale });
      const stage = sprite.closest('.stage');
      if (!stage) throw new Error('Motion stage is unavailable.');
      for (const [name, value] of Object.entries(motionLayoutCssVariables(layout))) stage.style.setProperty(name, value);
    } else if (receivedScaleOverride !== null) {
      sprite.style.transform = `scale(${receivedScaleOverride})`;
    }
  }

  function setScaleOverride(scale) {
    const value = Number(scale);
    if (!Number.isFinite(value) || value < 0.25 || value > 3) return;
    receivedScaleOverride = value;
    applyCurrentLayout();
  }

  function artworkUrl(parsed, sprite) {
    const sheet = createStyleSheet();
    sheet.replaceSync([...parsed.head.querySelectorAll('style')].map((style) => style.textContent).join('\n'));
    let value = '';
    for (const rule of sheet.cssRules) {
      if (rule.selectorText && sprite.matches(rule.selectorText) && rule.style?.backgroundImage) {
        value = rule.style.backgroundImage;
      }
    }
    const match = /^url\((?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\)$/.exec(value.trim());
    if (!match) throw new Error('Classic pet artwork URL is unavailable.');
    return (match[1] ?? match[2] ?? match[3]).replace(/\\(.)/g, '$1');
  }

  function applyDocument(candidate) {
    const { parsed, stage, state, onApplied } = candidate;
    const current = document.querySelector('.stage');
    if (current) current.replaceWith(stage);
    else document.body.insertBefore(stage, document.body.firstChild);

    const styles = [...parsed.head.querySelectorAll('style')].map((style) => style.textContent).join('\n');
    let hostStyle = document.head.querySelector('style[data-openpets-pet-document]');
    if (!hostStyle) {
      hostStyle = document.head.querySelector('style');
      if (!hostStyle) {
        hostStyle = document.createElement('style');
        document.head.prepend(hostStyle);
      }
      hostStyle.setAttribute('data-openpets-pet-document', '');
    }
    hostStyle.textContent = styles;
    const root = document.documentElement;
    root.lang = parsed.documentElement.lang;
    for (const name of ['petRole', 'petDisplayName', 'petAssetName', 'reactionState', 'nativePetDrag', 'flipX', 'codexSpriteVersion', 'paused']) {
      const value = parsed.documentElement.dataset[name];
      if (value === undefined) delete root.dataset[name];
      else root.dataset[name] = value;
    }
    applyCurrentLayout();
    onApplied?.(state);
  }

  function commit(candidate) {
    if (candidate.state.contentCommitToken) {
      options.onCommit?.({ token: candidate.state.contentCommitToken, presentationId: candidate.state.motionPresentationId ?? null, outfitId: candidate.state.motionOutfitId ?? null });
    }
  }

  function cancelLoad() {
    if (!loadingImage) return;
    loadingImage.onload = null;
    loadingImage.onerror = null;
    loadingImage.src = '';
    loadingImage = null;
  }

  function replaceStage(state, onApplied) {
    const token = ++generation;
    cancelLoad();
    pendingMotion = null;
    pendingPresentation = null;
    if (disposed) return;
    try {
      const parsed = parseDocument(state.documentHtml);
      const original = parsed.querySelector('.stage');
      if (!original) throw new Error('Pet document has no stage.');
      const stage = document.importNode(original, true);
      const candidate = { parsed, stage, state, onApplied, generation: token };
      const motion = stage.querySelector('.pet-shell .sprite[data-motion-body]');
      if (motion) {
        if (typeof state.motionSnapshotId !== 'string' || !state.motionSnapshotId || typeof state.motionPresentationId !== 'string' || !state.motionPresentationId || typeof state.motionOutfitId !== 'string' || !state.motionOutfitId) {
          throw new Error('Motion content has no snapshot identity.');
        }
        if (matches(state, visibleMotion)) {
          applyDocument(candidate);
          commit(candidate);
        } else {
          pendingMotion = candidate;
        }
        return;
      }
      const sprite = stage.querySelector('.pet-shell .installed-sprite, .pet-shell .sprite');
      if (!sprite) throw new Error('Classic pet document has no sprite.');
      const url = artworkUrl(parsed, sprite);
      const image = createImage();
      loadingImage = image;
      image.onload = async () => {
        try {
          if (typeof image.decode === 'function') await image.decode();
          if (disposed || token !== generation || loadingImage !== image) return;
          image.onload = null;
          image.onerror = null;
          loadingImage = null;
          applyDocument(candidate);
          visibleMotion = null;
          commit(candidate);
        } catch (error) {
          if (!disposed && token === generation && loadingImage === image) {
            image.onload = null;
            image.onerror = null;
            loadingImage = null;
            options.onError?.(error);
          }
        }
      };
      image.onerror = () => {
        if (disposed || token !== generation) return;
        loadingImage = null;
        options.onError?.(new Error('Classic pet artwork failed to load.'));
      };
      image.src = url;
    } catch (error) {
      if (!disposed && token === generation) options.onError?.(error);
    }
  }

  function matches(state, appearance) {
    return appearance && state.motionSnapshotId === appearance.assets.snapshotId && state.motionPresentationId === appearance.presentationId && state.motionOutfitId === appearance.outfitId;
  }

  function prepareMotionPresentation(appearance) {
    if (disposed) return false;
    if (visibleMotion && appearance.presentationId === visibleMotion.presentationId && appearance.outfitId === visibleMotion.outfitId && appearance.assets.snapshotId === visibleMotion.assets.snapshotId) return true;
    if (pendingMotion && matches(pendingMotion.state, appearance)) {
      const candidate = pendingMotion;
      pendingMotion = null;
      applyDocument(candidate);
      pendingPresentation = candidate;
      return true;
    }
    // The initial document is already loaded before the first body snapshot.
    const initial = !visibleMotion && !pendingMotion && Boolean(document.querySelector('.pet-shell .sprite[data-motion-body]'));
    if (initial) applyCurrentLayout();
    return initial;
  }

  function motionPresented(appearance) {
    if (disposed) return;
    visibleMotion = appearance;
    if (pendingPresentation && matches(pendingPresentation.state, appearance) && pendingPresentation.generation === generation) {
      const candidate = pendingPresentation;
      pendingPresentation = null;
      commit(candidate);
    }
  }

  function dispose() {
    disposed = true;
    generation += 1;
    cancelLoad();
    pendingMotion = null;
    pendingPresentation = null;
  }

  return { replaceStage, setScaleOverride, prepareMotionPresentation, motionPresented, dispose };
}
module.exports = { createPetContentStageController };
