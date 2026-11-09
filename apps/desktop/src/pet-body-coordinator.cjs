/** Arbitrates semantic body playback and the single pending appearance. */
function createPetBodyCoordinator(options) {
  const { player, now, random, onResult, onVisibility, onActivityCancel, getBindings } = options;
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
  let activity = false;
  let disposed = false;
  let playbackId = 0;
  let semanticContext = null;
  const contextAnimations = new Map();
  let lastIdleVariant = null;
  let nextIdleOpportunity = now() + 30000;
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
    send(previous.appearance, previous.id, 'cancelled', previous.intentId, previous.epoch);
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
    if (!appearance || !snapshot || snapshot.input.suspended || ((plugin || activity) && !drag)) return null;
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
    return a && b && a.kind === b.kind && a.key === b.key && a.animation === b.animation && a.appearance.presentationId === b.appearance.presentationId && a.epoch === b.epoch;
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
      onStarted() {
        if (active !== item || item.started) return;
        item.started = true;
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
    const item = { ...target, id: ++playbackId, started: false, phase: null };
    active = item;
    playPhase(item, immediate ? 'body' : 'intro');
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
    if (item.kind === 'context' && item.key === 'idle' && now() >= nextIdleOpportunity) {
      nextIdleOpportunity = now() + 30000;
      const variants = bindings(item.appearance).idle;
      if (variants.length > 1 && random() < 0.25) {
        const choice = choose(variants, lastIdleVariant ?? item.animation);
        lastIdleVariant = choice;
        contextAnimations.set(item.appearance.presentationId, choice);
        start({ ...item, animation: choice });
        return;
      }
    }
    playPhase(item, 'body');
  }

  function reconcile(immediate = false) {
    if (disposed) return;
    onVisibility?.({ drag: Boolean(drag), plugin, activity, motion: Boolean(snapshot?.motion), suspended: Boolean(snapshot?.input.suspended) });
    if (!snapshot?.motion || snapshot.input.suspended) {
      clearCandidateTimer();
      cancelActive();
      if (candidate) deferred('suspended');
      return;
    }
    player.setPaused(snapshot.input.paused);
    if (snapshot.input.paused && active && !candidate) return;
    if ((plugin || activity) && !drag) {
      cancelActive();
      updateCandidate();
      return;
    }
    updateCandidate();
    if (active && candidate && active.appearance.presentationId === candidate.appearance.presentationId) return;
    const target = desired(committed);
    if (!target) return;
    if (same(active, target)) {
      cancelTransition();
      return;
    }
    if (snapshot.input.paused && active) return;
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
    if (disposed || !next?.input) return;
    if (snapshot && snapshot.input.epoch === next.input.epoch && next.input.revision <= snapshot.input.revision) return;
    const epochChanged = snapshot?.input.epoch !== next.input.epoch;
    if (epochChanged) {
      seenEvents.clear();
      semanticContext = null;
      contextAnimations.clear();
      lastIdleVariant = null;
      nextIdleOpportunity = now() + 30000;
      cancelActive();
    }
    snapshot = next;
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
      onVisibility?.({ drag: Boolean(drag), plugin, activity, motion: false, suspended: next.input.suspended });
      return;
    }
    if (next.motion.presentationId !== committed?.presentationId && next.motion.presentationId !== candidate?.appearance.presentationId && !failedPresentations.has(next.motion.presentationId)) {
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
      if (appearance && !next.input.paused && !next.input.suspended && !drag && !plugin && !(active?.kind === 'event' && active.key === event.reaction) && variants?.length && candidateAllowsEvent) {
        if (activity) {
          activity = false;
          onActivityCancel?.();
        }
        start({ kind: 'event', key: event.reaction, intentId: event.id, animation: choose(variants), appearance, epoch: next.input.epoch });
      } else if (appearance) {
        send(appearance, ++playbackId, 'cancelled', event.id);
      }
    }
    reconcile(epochChanged);
  }

  function setDragDirection(value) {
    const next = value === 'run-left' ? 'left' : value === 'run-right' ? 'right' : null;
    if (next === drag) return;
    drag = next;
    reconcile(true);
  }
  function setMotionState(value) {
    const next = value === 'run-left' ? 'left' : value === 'run-right' ? 'right' : null;
    if (next === movement) return;
    movement = next;
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
    reconcile(true);
  }
  function setActivity(value) {
    if (value && (drag || plugin || active?.kind === 'event' || snapshot?.input.paused || snapshot?.input.suspended)) return false;
    activity = Boolean(value);
    reconcile(true);
    return true;
  }
  function refresh() {
    player.mount();
    reconcile();
  }
  function dispose() {
    if (disposed) return;
    clearCandidateTimer();
    cancelActive();
    candidate = null;
    disposed = true;
    player.dispose();
  }
  function hitTest(x, y) {
    if ((plugin || activity) && !drag) return null;
    return player.hitTest(x, y);
  }
  return { update, setDragDirection, setMotionState, setFlipped, setPlugin, setActivity, refresh, dispose, hitTest };
}
module.exports = { createPetBodyCoordinator };
