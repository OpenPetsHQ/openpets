const { resolveMotionActivityAnimation } = require('@open-pets/pet-format/motion');

/** Arbitrates semantic body playback and the single pending appearance. */
function createPetBodyCoordinator(options) {
  const { player, now, random, onResult, onVisibility, onActivityResult, playExternalActivity, stopExternalActivity, getBindings } = options;
  const armTimer = options.setTimeout ?? setTimeout;
  const cancelTimer = options.clearTimeout ?? clearTimeout;
  let snapshot = null;
  let committed = null;
  let candidate = null;
  let active = null;
  let transition = null;
  let transitionTimer = null;
  let appearanceTimer = null;
  let drag = null;
  let movement = null;
  let flipped = false;
  let plugin = false;
  let activity = null;
  let latestActivityGeneration = 0;
  let pendingVariation = null;
  let reducedMotion = false;
  let disposed = false;
  let playbackId = 0;
  let semanticContext = null;
  const contextAnimations = new Map();
  const seenEvents = new Set();
  const failedPresentations = new Set();

  function send(appearance, id, outcome, intentId, epoch = snapshot?.input.epoch) {
    if (!appearance || !epoch) return;
    onResult({
      epoch,
      snapshotId: appearance.assets.snapshotId,
      presentationId: appearance.presentationId,
      outfitId: appearance.outfitId,
      playbackId: id,
      ...(intentId ? { intentId } : {}),
      outcome,
    });
  }

  function cancelTransition() {
    cancelTimer(transitionTimer);
    transitionTimer = null;
    transition = null;
  }

  function cancelActive() {
    cancelTransition();
    if (!active) return;
    const previous = active;
    active = null;
    player.stop();
    if (previous.kind !== 'activity') send(previous.appearance, previous.id, 'cancelled', previous.intentId, previous.epoch);
  }

  function activityResult(request, outcome) {
    onActivityResult?.({ format: request.format, generation: request.generation, activityId: request.activityId, ...(request.format === 'motion' ? { target: request.target } : {}), outcome });
  }

  function finishActivity(item, outcome, restore = true) {
    if (activity !== item) return;
    activity = null;
    if (item.request.format === 'classic') stopExternalActivity?.(item.request.generation);
    else if (active === item) {
      active = null;
      player.stop();
    }
    activityResult(item.request, outcome);
    if (restore && !disposed) reconcile(true);
  }

  function choose(variants, avoid) {
    if (!variants?.length) return null;
    const eligible = variants.length > 1 ? variants.filter((variant) => variant.animation !== avoid) : variants;
    const total = eligible.reduce((sum, variant) => sum + (variant.weight ?? 1), 0);
    let point = random() * total;
    for (const variant of eligible) {
      point -= variant.weight ?? 1;
      if (point < 0) return variant.animation;
    }
    return eligible[eligible.length - 1].animation;
  }

  function bindings(appearance) {
    return getBindings(appearance.assets.metadata, appearance.outfitId);
  }

  function contextTarget(appearance) {
    const context = snapshot.input.context;
    const identity = appearance.presentationId;
    const mapping = bindings(appearance);
    const variants = context === 'idle' ? mapping.idle : mapping.contexts?.[context] ?? mapping.idle;
    if (!contextAnimations.has(identity)) {
      contextAnimations.set(identity, context === 'idle' ? variants[0].animation : choose(variants));
    }
    return { kind: 'context', key: context, animation: contextAnimations.get(identity), appearance, epoch: snapshot.input.epoch };
  }

  function desired(appearance) {
    if (!appearance || !snapshot || snapshot.input.suspended || ((plugin || activity?.request.format === 'classic') && !drag)) return null;
    if (drag) {
      const direction = flipped ? (drag === 'left' ? 'right' : 'left') : drag;
      return { kind: 'drag', key: drag, animation: bindings(appearance).movement[direction], appearance, epoch: snapshot.input.epoch };
    }
    if (active?.kind === 'event' && active.appearance.presentationId === appearance.presentationId) return active;
    if (movement) {
      const direction = flipped ? (movement === 'left' ? 'right' : 'left') : movement;
      return { kind: 'movement', key: movement, animation: bindings(appearance).movement[direction], appearance, epoch: snapshot.input.epoch };
    }
    return contextTarget(appearance);
  }

  function same(a, b) {
    return a && b && a.kind === b.kind && a.key === b.key && a.animation === b.animation && a.appearance.presentationId === b.appearance.presentationId && a.epoch === b.epoch && a.still === b.still;
  }

  function playPhase(item, phase) {
    if (active !== item || disposed) return;
    const animation = item.appearance.assets.metadata.animations[item.animation];
    const clipId = phase === 'intro' ? animation.intro : phase === 'outro' ? animation.outro : animation.play === 'loop' ? animation.loop : animation.clip;
    if (!clipId) {
      phaseEnded(item, phase);
      return;
    }
    item.phase = phase;
    void player.play(item.appearance, clipId, {
      still: item.still,
      onStarted() {
        if (active !== item || item.started) return;
        item.started = true;
        if (item.kind === 'activity') {
          activityResult(item.request, 'started');
          return;
        }
        let appearanceCommitted = false;
        if (candidate?.appearance.presentationId === item.appearance.presentationId) {
          if (committed && committed.presentationId !== item.appearance.presentationId) {
            contextAnimations.delete(committed.presentationId);
          }
          committed = candidate.appearance;
          clearCandidateTimer();
          candidate = null;
          appearanceCommitted = true;
        }
        send(item.appearance, item.id, 'started', item.intentId, item.epoch);
        if (appearanceCommitted) reconcile();
      },
      onEnd() { phaseEnded(item, phase); },
      onFailed() {
        if (active !== item) return;
        if (item.kind === 'activity') {
          finishActivity(item, 'failed');
          return;
        }
        active = null;
        cancelTransition();
        if (candidate?.appearance.presentationId === item.appearance.presentationId) {
          failedPresentations.add(item.appearance.presentationId);
          contextAnimations.delete(item.appearance.presentationId);
          if (failedPresentations.size > 1024) failedPresentations.delete(failedPresentations.values().next().value);
          clearCandidateTimer();
          candidate = null;
        }
        send(item.appearance, item.id, 'failed', item.intentId, item.epoch);
        if (committed && committed.presentationId !== item.appearance.presentationId) reconcile(true);
        else if (item.kind === 'event') reconcile(true);
      },
    });
  }

  function start(target, immediate = false) {
    cancelActive();
    if (!target || disposed) return;
    if (!target.appearance.assets.metadata.animations[target.animation]) return;
    const item = { ...target, still: reducedMotion, id: ++playbackId, started: false, phase: null };
    active = item;
    playPhase(item, immediate || reducedMotion ? 'body' : 'intro');
  }

  function clearCandidateTimer() {
    cancelTimer(appearanceTimer);
    appearanceTimer = null;
    if (candidate?.eligibleSince !== null && candidate?.eligibleSince !== undefined) {
      candidate.remaining = Math.max(0, candidate.remaining - (now() - candidate.eligibleSince));
      candidate.eligibleSince = null;
    }
  }

  function deferred(reason) {
    if (!candidate || candidate.deferredReason === reason) return;
    candidate.deferredReason = reason;
    send(candidate.appearance, ++playbackId, 'deferred');
  }

  function candidateBlocked() {
    if (!snapshot || snapshot.input.suspended) return 'suspended';
    if (drag) return 'drag';
    if (plugin) return 'plugin';
    if (activity) return 'activity';
    if (snapshot.input.paused && candidate?.appearance.reason === 'scheduled') return 'paused';
    return null;
  }

  function beginCandidate() {
    if (!candidate || candidateBlocked()) return;
    clearCandidateTimer();
    const appearance = candidate.appearance;
    candidate.deferredReason = null;
    const target = contextTarget(appearance);
    start(target, true);
  }

  function updateCandidate() {
    if (!candidate || !snapshot) return;
    const blocked = candidateBlocked();
    if (blocked) {
      clearCandidateTimer();
      if (active?.appearance.presentationId === candidate.appearance.presentationId) cancelActive();
      deferred(blocked);
      return;
    }
    if (active?.appearance.presentationId === candidate.appearance.presentationId) return;
    if (!committed || candidate.appearance.reason !== 'scheduled') {
      beginCandidate();
      return;
    }
    if (candidate.remaining <= 0) {
      beginCandidate();
      return;
    }
    if (candidate.eligibleSince === null) {
      candidate.eligibleSince = now();
      appearanceTimer = armTimer(() => {
        clearCandidateTimer();
        beginCandidate();
      }, candidate.remaining);
    }
    deferred('boundary');
  }

  function phaseEnded(item, phase) {
    if (active !== item || disposed) return;
    const animation = item.appearance.assets.metadata.animations[item.animation];
    if (phase === 'intro') {
      playPhase(item, 'body');
      return;
    }
    if (phase === 'outro' || (phase === 'body' && animation.play === 'once' && !animation.outro)) {
      if (item.kind === 'activity') {
        finishActivity(item, 'completed');
        return;
      }
      if (item.kind === 'event') send(item.appearance, item.id, 'completed', item.intentId, item.epoch);
      if (animation.play === 'once' && item.kind === 'context' && item.key === 'idle') contextAnimations.delete(item.appearance.presentationId);
      active = null;
      if (candidate && !candidateBlocked()) {
        beginCandidate();
      } else {
        const target = transition ?? desired(committed);
        cancelTransition();
        start(target);
      }
      return;
    }
    if (phase === 'body' && animation.play === 'once') {
      playPhase(item, 'outro');
      return;
    }
    if (candidate && !candidateBlocked()) {
      beginCandidate();
      return;
    }
    if (transition) {
      const outro = animation.outro;
      const duration = outro ? item.appearance.assets.verifiedClips[outro].durationMs / (item.appearance.assets.metadata.clips[outro].playbackRate ?? 1) : Infinity;
      if (outro && now() + duration <= transition.deadline) playPhase(item, 'outro');
      else start(transition);
      return;
    }
    if (item.kind === 'context' && item.key === 'idle' && pendingVariation && pendingVariation.presentationId === item.appearance.presentationId) {
      const choice = pendingVariation.animation;
      pendingVariation = null;
      contextAnimations.set(item.appearance.presentationId, choice);
      start({ ...item, animation: choice });
      return;
    }
    playPhase(item, 'body');
  }

  function reconcile(immediate = false) {
    if (disposed) return;
    onVisibility?.({ drag: Boolean(drag), plugin, activity: activity?.request.format ?? null, motion: Boolean(snapshot?.motion), suspended: Boolean(snapshot?.input.suspended) });
    if (!snapshot?.motion || snapshot.input.suspended) {
      clearCandidateTimer();
      if (!activity || activity.request.format !== 'classic') cancelActive();
      if (candidate) deferred('suspended');
      return;
    }
    player.setPaused(snapshot.input.paused);
    if (snapshot.input.paused && active && !candidate && !reducedMotion) return;
    if (activity?.request.format === 'motion') return;
    if ((plugin || activity?.request.format === 'classic') && !drag) {
      cancelActive();
      updateCandidate();
      return;
    }
    updateCandidate();
    if (active && candidate && active.appearance.presentationId === candidate.appearance.presentationId) return;
    const desiredTarget = desired(committed);
    const target = desiredTarget && { ...desiredTarget, still: reducedMotion };
    if (!target) return;
    if (same(active, target)) {
      cancelTransition();
      return;
    }
    if (snapshot.input.paused && active && !reducedMotion) return;
    if (reducedMotion) {
      start(target, true);
      return;
    }
    if (target.kind === 'drag') {
      start(target, true);
      return;
    }
    if (!immediate && active && player.remaining() <= 150) {
      if (transition) {
        transition = { ...target, deadline: transition.deadline };
      } else {
        transition = { ...target, deadline: now() + 150 };
        transitionTimer = armTimer(() => { if (transition) start(transition); }, 150);
      }
      return;
    }
    start(target, immediate);
  }

  function update(next) {
    if (disposed || !next?.input) return false;
    if (snapshot && snapshot.input.epoch === next.input.epoch && next.input.revision <= snapshot.input.revision) return false;
    const epochChanged = snapshot?.input.epoch !== next.input.epoch;
    if (epochChanged) {
      seenEvents.clear();
      semanticContext = null;
      contextAnimations.clear();
      pendingVariation = null;
      if (activity) finishActivity(activity, 'cancelled', false);
      cancelActive();
    }
    snapshot = next;
    const newAppearance = Boolean(next.motion)
      && next.motion.presentationId !== committed?.presentationId
      && next.motion.presentationId !== candidate?.appearance.presentationId
      && !failedPresentations.has(next.motion.presentationId);
    const newEvent = next.input.event && !seenEvents.has(next.input.event.id);
    const busyContext = next.input.context !== 'idle'
      && (next.motion || semanticContext !== next.input.context);
    if (newAppearance || newEvent || busyContext || next.input.paused || next.input.suspended || epochChanged) {
      pendingVariation = null;
      if (activity) finishActivity(activity, 'cancelled', false);
    }
    if (semanticContext !== next.input.context) {
      semanticContext = next.input.context;
      contextAnimations.clear();
    }
    if (!next.motion) {
      clearCandidateTimer();
      candidate = null;
      committed = null;
      cancelActive();
      player.clear();
      onVisibility?.({ drag: Boolean(drag), plugin, activity: activity?.request.format ?? null, motion: false, suspended: next.input.suspended });
      return true;
    }
    if (newAppearance) {
      clearCandidateTimer();
      if (active && candidate && active.appearance.presentationId === candidate.appearance.presentationId) cancelActive();
      candidate = { appearance: next.motion, remaining: 5000, eligibleSince: null, deferredReason: null };
    }
    const event = next.input.event;
    if (event && !seenEvents.has(event.id)) {
      seenEvents.add(event.id);
      if (seenEvents.size > 1024) seenEvents.delete(seenEvents.values().next().value);
      const appearance = committed ?? candidate?.appearance;
      const variants = appearance && bindings(appearance).events?.[event.reaction];
      const candidateAllowsEvent = !candidate || !committed || candidate.appearance.reason === 'scheduled';
      if (appearance && !reducedMotion && !next.input.paused && !next.input.suspended && !drag && !plugin && !(active?.kind === 'event' && active.key === event.reaction) && variants?.length && candidateAllowsEvent) {
        start({ kind: 'event', key: event.reaction, intentId: event.id, animation: choose(variants), appearance, epoch: next.input.epoch });
      } else if (appearance) {
        send(appearance, ++playbackId, 'cancelled', event.id);
      }
    }
    reconcile(epochChanged);
    return true;
  }

  function setDragDirection(value) {
    const next = value === 'run-left' ? 'left' : value === 'run-right' ? 'right' : null;
    if (next === drag) return;
    drag = next;
    if (next) { pendingVariation = null; if (activity) finishActivity(activity, 'cancelled', false); }
    reconcile(true);
  }
  function setMotionState(value) {
    const next = value === 'run-left' ? 'left' : value === 'run-right' ? 'right' : null;
    if (next === movement) return;
    movement = next;
    if (next) { pendingVariation = null; if (activity) finishActivity(activity, 'cancelled', false); }
    reconcile(true);
  }
  function setFlipped(value) {
    const next = Boolean(value);
    if (next === flipped) return;
    flipped = next;
    reconcile(true);
  }
  function setPlugin(value) {
    plugin = Boolean(value);
    if (plugin) {
      pendingVariation = null;
      if (activity) finishActivity(activity, 'cancelled', false);
    }
    reconcile(true);
  }
  function canAdmitActivity() {
    const input = snapshot?.input;
    return Boolean(input && (!snapshot.motion || input.context === 'idle') && !input.paused && !input.suspended && !reducedMotion
      && !drag && !movement && !plugin && active?.kind !== 'event' && !candidate);
  }

  function isClassicActivityTarget(request) {
    return !snapshot?.motion
      && typeof request.imageUrl === 'string'
      && request.imageUrl.startsWith('data:image/webp;base64,')
      && Number.isInteger(request.frameCount)
      && request.frameCount >= 4 && request.frameCount <= 32
      && Number.isInteger(request.fps)
      && request.fps >= 1 && request.fps <= 12
      && typeof request.scale === 'number' && Number.isFinite(request.scale) && request.scale > 0;
  }

  function isMotionActivityTarget(request) {
    if (!committed || !snapshot?.motion || !request.target) return false;
    const { target } = request;
    if (target.epoch !== snapshot.input.epoch
      || target.snapshotId !== committed.assets.snapshotId
      || target.presentationId !== committed.presentationId
      || target.outfitId !== committed.outfitId) return false;
    const metadata = committed.assets.metadata;
    const activityDefinition = metadata.activities?.find((entry) => entry.id === request.activityId);
    if (!activityDefinition) return false;
    const representation = resolveMotionActivityAnimation(activityDefinition, committed.outfitId);
    return representation?.animation === request.animation && metadata.animations[request.animation]?.play === 'once';
  }

  function startActivity(request) {
    if (!request || request.kind !== 'play' || !Number.isSafeInteger(request.generation)
      || request.generation <= 0 || request.generation <= latestActivityGeneration) return false;
    latestActivityGeneration = request.generation;
    if (activity) finishActivity(activity, 'cancelled', false);
    pendingVariation = null;
    const targetValid = request.format === 'classic'
      ? isClassicActivityTarget(request)
      : request.format === 'motion' && isMotionActivityTarget(request);
    if (!canAdmitActivity() || !targetValid || typeof request.activityId !== 'string' || !request.activityId) {
      activityResult(request, 'cancelled');
      reconcile(true);
      return false;
    }
    cancelActive();
    const item = {
      kind: 'activity',
      request,
      started: false,
      appearance: committed,
      epoch: snapshot.input.epoch,
      animation: request.animation,
      id: ++playbackId,
    };
    activity = item;
    if (request.format === 'classic') {
      onVisibility?.({ drag: false, plugin, activity: 'classic', motion: false, suspended: false });
      playExternalActivity(request, (outcome) => {
        if (activity !== item) return;
        if (outcome === 'started') {
          if (!item.started) {
            item.started = true;
            activityResult(request, outcome);
          }
        } else if (outcome === 'completed' || outcome === 'cancelled' || outcome === 'failed') {
          finishActivity(item, outcome);
        }
      });
    } else {
      active = item;
      onVisibility?.({ drag: false, plugin, activity: 'motion', motion: true, suspended: false });
      playPhase(item, 'intro');
    }
    return true;
  }
  function cancelActivity(generation) {
    if (!Number.isSafeInteger(generation) || generation <= 0) return;
    latestActivityGeneration = Math.max(latestActivityGeneration, generation);
    if (activity?.request.generation === generation) finishActivity(activity, 'cancelled');
  }
  function offerVariation() {
    if (reducedMotion || pendingVariation || activity || candidate || !committed || !snapshot || snapshot.input.context !== 'idle' || snapshot.input.paused || snapshot.input.suspended || drag || movement || plugin || active?.kind !== 'context' || active.key !== 'idle') return false;
    const variants = bindings(committed).idle;
    if (variants.length < 2) return false;
    pendingVariation = { presentationId: committed.presentationId, animation: choose(variants, active.animation) };
    return true;
  }
  function refresh() {
    player.mount();
    reconcile();
  }
  function setReducedMotion(value) {
    const next = Boolean(value);
    if (next === reducedMotion || disposed) return;
    reducedMotion = next;
    pendingVariation = null;
    if (next) {
      if (activity) finishActivity(activity, 'cancelled', false);
      cancelActive();
      reconcile(true);
    } else if (!snapshot?.input.paused) {
      cancelActive();
      reconcile(true);
    }
  }
  function dispose() {
    if (disposed) return;
    if (activity) finishActivity(activity, 'cancelled', false);
    clearCandidateTimer();
    cancelActive();
    candidate = null;
    disposed = true;
    player.dispose();
  }
  function hitTest(x, y) {
    if ((plugin || activity?.request.format === 'classic') && !drag) return null;
    return player.hitTest(x, y);
  }
  return { update, setDragDirection, setMotionState, setFlipped, setPlugin, setReducedMotion, startActivity, cancelActivity, offerVariation, refresh, dispose, hitTest };
}
module.exports = { createPetBodyCoordinator };
