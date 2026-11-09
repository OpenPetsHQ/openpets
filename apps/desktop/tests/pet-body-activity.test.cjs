const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPetBodyCoordinator } = require('../src/pet-body-coordinator.cjs');

function fixture(classic = false) {
  const calls = [];
  const bodyResults = [];
  const activityResults = [];
  const visibility = [];
  const external = [];
  const stops = [];
  const player = {
    play(appearance, clip, callbacks) { calls.push({ appearance, clip, callbacks }); },
    stop() {}, clear() {}, setPaused() {}, remaining: () => 1000, mount() {}, hitTest: () => true, dispose() {},
  };
  const coordinator = createPetBodyCoordinator({
    player, now: () => 0, random: () => 0, onResult: result => bodyResults.push(result),
    onActivityResult: result => activityResults.push(result),
    playExternalActivity: (command, callback) => external.push({ command, callback }),
    stopExternalActivity: generation => stops.push(generation),
    onVisibility: state => visibility.push(state),
    getBindings: metadata => metadata.bindings,
  });
  const appearance = {
    presentationId: 'presentation', outfitId: 'default', reason: 'initial',
    assets: { snapshotId: 'snapshot', metadata: {
      animations: { idle: { play: 'loop', loop: 'idle' }, alternate: { play: 'loop', loop: 'alternate' }, wave: { play: 'once', intro: 'intro', clip: 'wave', outro: 'outro' }, run: { play: 'loop', loop: 'run' }, work: { play: 'loop', loop: 'work' } },
      bindings: { idle: [{ animation: 'idle' }, { animation: 'alternate' }], contexts: { working: [{ animation: 'work' }] }, movement: { left: 'run', right: 'run' }, events: {} }, clips: {},
      activities: [{ id: 'test', outfitId: 'default', animation: 'wave' }],
    }, verifiedClips: {} },
  };
  const input = { epoch: 'epoch', revision: 1, context: 'idle', paused: false, suspended: false };
  coordinator.update({ input, motion: classic ? null : appearance });
  if (!classic) calls.at(-1).callbacks.onStarted();
  const target = { epoch: 'epoch', snapshotId: 'snapshot', presentationId: 'presentation', outfitId: 'default' };
  const motion = generation => ({ kind: 'play', format: 'motion', generation, activityId: 'test', target, animation: 'wave' });
  const strip = generation => ({ kind: 'play', format: 'classic', generation, activityId: 'test', imageUrl: 'data:image/webp;base64,AA==', frameCount: 4, fps: 4, scale: 1 });
  const update = (revision, overrides = {}, nextAppearance = classic ? null : appearance) => coordinator.update({ input: { ...input, revision, ...overrides }, motion: nextAppearance });
  return { coordinator, calls, bodyResults, activityResults, visibility, external, stops, motion, strip, update, appearance };
}

test('motion reports first frame and completes only after all finite phases', () => {
  const f = fixture(); const initial = f.bodyResults.length;
  assert.equal(f.coordinator.startActivity(f.motion(1)), true);
  assert.equal(f.calls.at(-1).clip, 'intro'); assert.deepEqual(f.activityResults, []);
  f.calls.at(-1).callbacks.onStarted();
  assert.equal(f.activityResults.at(-1).outcome, 'started');
  f.calls.at(-1).callbacks.onEnd(); assert.equal(f.calls.at(-1).clip, 'wave');
  f.calls.at(-1).callbacks.onStarted(); f.calls.at(-1).callbacks.onEnd(); assert.equal(f.calls.at(-1).clip, 'outro');
  f.calls.at(-1).callbacks.onStarted(); assert.equal(f.activityResults.length, 1);
  f.calls.at(-1).callbacks.onEnd(); assert.deepEqual(f.activityResults.map(x => x.outcome), ['started', 'completed']);
  assert.deepEqual(f.activityResults[1], { format: 'motion', generation: 1, activityId: 'test', target: f.motion(1).target, outcome: 'completed' });
  assert.equal(f.bodyResults.slice(initial).some(x => x.presentationId === 'presentation' && x.outcome === 'completed'), false);
  assert.equal(f.visibility.some(x => x.activity === 'motion'), true);
  f.coordinator.dispose();
});

test('new scheduled appearance cancels before candidate starts; late callbacks ignored', () => {
  const f = fixture(); f.coordinator.startActivity(f.motion(1)); const callbacks = f.calls.at(-1).callbacks;
  callbacks.onStarted(); const replacement = { ...f.appearance, presentationId: 'new', reason: 'scheduled' };
  f.update(2, {}, replacement); callbacks.onEnd(); callbacks.onFailed(new Error('late'));
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['started', 'cancelled']);
  assert.equal(f.bodyResults.some(x => x.presentationId === 'new' && x.outcome === 'deferred'), true);
  f.coordinator.dispose();
});

test('failed appearance refresh preserves retained activity; fresh retry cancels it before commit', () => {
  const f = fixture();
  const failed = { ...f.appearance, presentationId: 'failed', reason: 'manual' };
  f.update(2, {}, failed);
  assert.equal(f.calls.at(-1).appearance.presentationId, 'failed');
  f.calls.at(-1).callbacks.onFailed(new Error('decode'));
  assert.equal(f.bodyResults.at(-1).outcome, 'failed');

  assert.equal(f.coordinator.startActivity(f.motion(1)), true);
  f.calls.at(-1).callbacks.onStarted();
  const callsBeforeRefresh = f.calls.length;
  const bodyResultsBeforeRefresh = f.bodyResults.length;
  f.update(3, {}, failed);
  assert.equal(f.calls.length, callsBeforeRefresh);
  assert.equal(f.bodyResults.length, bodyResultsBeforeRefresh);
  assert.deepEqual(f.activityResults.map(x => [x.generation, x.outcome]), [[1, 'started']]);

  f.calls.at(-1).callbacks.onEnd();
  assert.equal(f.calls.at(-1).clip, 'wave');
  f.calls.at(-1).callbacks.onStarted();
  f.calls.at(-1).callbacks.onEnd();
  assert.equal(f.calls.at(-1).clip, 'outro');
  f.calls.at(-1).callbacks.onStarted();
  f.calls.at(-1).callbacks.onEnd();
  assert.deepEqual(f.activityResults.map(x => [x.generation, x.outcome]), [[1, 'started'], [1, 'completed']]);

  assert.equal(f.coordinator.startActivity(f.motion(2)), true);
  f.calls.at(-1).callbacks.onStarted();
  const retry = { ...failed, presentationId: 'retry' };
  f.update(4, {}, retry);
  assert.deepEqual(f.activityResults.map(x => [x.generation, x.outcome]), [[1, 'started'], [1, 'completed'], [2, 'started'], [2, 'cancelled']]);
  assert.equal(f.calls.at(-1).appearance.presentationId, 'retry');
  assert.equal(f.bodyResults.some(x => x.presentationId === 'retry' && x.outcome === 'started'), false);
  f.calls.at(-1).callbacks.onStarted();
  assert.equal(f.bodyResults.at(-1).presentationId, 'retry');
  assert.equal(f.bodyResults.at(-1).outcome, 'started');
  f.coordinator.dispose();
});

test('wrong target and cancelled generations cannot start', () => {
  const f = fixture(); f.coordinator.cancelActivity(2);
  assert.equal(f.coordinator.startActivity(f.motion(2)), false);
  assert.equal(f.coordinator.startActivity({ ...f.motion(3), target: { ...f.motion(3).target, outfitId: 'wrong' } }), false);
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['cancelled']);
  assert.equal(f.coordinator.startActivity(f.motion(4)), true); f.coordinator.cancelActivity(4);
  f.calls.at(-2).callbacks.onStarted();
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['cancelled', 'cancelled']);
  f.coordinator.dispose();
});

test('motion activity identity must resolve to the requested outfit animation', () => {
  const f = fixture();
  f.appearance.assets.metadata.animations.other = { play: 'once', clip: 'wave' };
  assert.equal(f.coordinator.startActivity({ ...f.motion(1), activityId: 'missing' }), false);
  assert.equal(f.coordinator.startActivity({ ...f.motion(2), animation: 'other' }), false);
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['cancelled', 'cancelled']);
  assert.equal(f.coordinator.startActivity(f.motion(3)), true);
  f.coordinator.dispose();
});

test('motion activity uses exact outfit variant without default fallback', () => {
  const f = fixture();
  f.appearance.assets.metadata.activities[0].outfitVariants = [{ outfitId: 'coat', animation: 'coatWave' }];
  f.appearance.assets.metadata.animations.coatWave = { play: 'once', clip: 'wave' };
  const coat = { ...f.appearance, outfitId: 'coat', presentationId: 'coat-presentation' };
  f.update(2, {}, coat); f.calls.at(-1).callbacks.onStarted();
  const target = { ...f.motion(1).target, outfitId: 'coat', presentationId: 'coat-presentation' };
  assert.equal(f.coordinator.startActivity({ ...f.motion(1), target }), false);
  assert.equal(f.coordinator.startActivity({ ...f.motion(2), target, animation: 'coatWave' }), true);
  f.coordinator.dispose();
});

test('classic uses same arbiter and ignores stale external callbacks', () => {
  const f = fixture(true); assert.equal(f.coordinator.startActivity(f.strip(1)), true);
  const first = f.external[0].callback; first('started'); f.coordinator.setMotionState('run-left');
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['started', 'cancelled']);
  f.coordinator.setMotionState('idle'); assert.equal(f.coordinator.startActivity(f.strip(2)), true);
  first('completed'); assert.equal(f.activityResults.length, 2);
  f.external[1].callback('started'); f.external[1].callback('completed');
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['started', 'cancelled', 'started', 'completed']);
  assert.deepEqual(f.stops, [1, 2]); f.coordinator.dispose();
});

test('reduced motion cancels Classic activity and rejects subsequent activities', () => {
  const f = fixture(true);
  assert.equal(f.coordinator.startActivity(f.strip(1)), true);
  f.external[0].callback('started');
  f.coordinator.setReducedMotion(true);
  f.external[0].callback('completed');
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['started', 'cancelled']);
  assert.equal(f.coordinator.startActivity(f.strip(2)), false);
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['started', 'cancelled', 'cancelled']);
  assert.equal(f.coordinator.offerVariation(), false);
  f.coordinator.dispose();
});

test('body updates report acceptance for Classic epochs and reject stale revisions', () => {
  const f = fixture(true);
  const body = { epoch: 'epoch', revision: 1, context: 'idle', paused: false, suspended: false };
  assert.equal(f.coordinator.update({ input: body, motion: null }), false);
  assert.equal(f.coordinator.update({ input: { ...body, revision: 2 }, motion: null }), true);
  assert.equal(f.coordinator.update({ input: { ...body, epoch: 'next', revision: 0 }, motion: null }), true);
  f.coordinator.dispose();
});

test('reduced motion cancels a Motion activity and does not route its result as a body event', () => {
  const f = fixture();
  assert.equal(f.coordinator.startActivity(f.motion(1)), true);
  const old = f.calls.at(-1).callbacks;
  old.onStarted();
  f.coordinator.setReducedMotion(true);
  old.onEnd(); old.onFailed(new Error('stale'));
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['started', 'cancelled']);
  assert.equal(f.bodyResults.some(x => x.intentId === 'test'), false);
  assert.equal(f.coordinator.startActivity(f.motion(2)), false);
  f.coordinator.dispose();
});

test('context preemption cancels activity and restores newest context', () => {
  const f = fixture(); f.coordinator.startActivity(f.motion(1));
  f.update(2, { context: 'working' });
  assert.equal(f.activityResults.at(-1).outcome, 'cancelled'); assert.equal(f.calls.at(-1).clip, 'work');
  f.coordinator.dispose();
});

test('variation waits for one loop boundary and is discarded by movement', () => {
  const f = fixture(); const idle = f.calls.at(-1).callbacks;
  assert.equal(f.coordinator.offerVariation(), true); assert.equal(f.coordinator.offerVariation(), false);
  idle.onEnd(); assert.equal(f.calls.at(-1).clip, 'alternate');
  assert.equal(f.coordinator.offerVariation(), true); f.coordinator.setMotionState('run-left');
  f.coordinator.setMotionState('idle'); const restored = f.calls.at(-1); restored.callbacks.onEnd();
  assert.equal(f.calls.at(-1).clip, 'alternate'); f.coordinator.dispose();
});

test('drag, plugin, pause and suspension cancel without reporting asset failure', () => {
  for (const interrupt of [
    f => f.coordinator.setDragDirection('run-left'),
    f => f.coordinator.setPlugin(true),
    f => f.update(2, { paused: true }),
    f => f.update(2, { suspended: true }),
  ]) {
    const f = fixture(); f.coordinator.startActivity(f.motion(1));
    const old = f.calls.at(-1).callbacks;
    interrupt(f); old.onStarted(); old.onFailed(new Error('stale decode'));
    assert.deepEqual(f.activityResults.map(x => x.outcome), ['cancelled']);
    f.coordinator.dispose();
  }
});

test('event preempts activity and decode failure does not poison later activity', () => {
  const f = fixture(); f.coordinator.startActivity(f.motion(1));
  f.calls.at(-1).callbacks.onFailed(new Error('decode'));
  assert.equal(f.activityResults.at(-1).outcome, 'failed');
  assert.equal(f.coordinator.startActivity(f.motion(2)), true);
  f.update(2, { event: { id: 'event', reaction: 'waving' } });
  assert.deepEqual(f.activityResults.map(x => x.outcome), ['failed', 'cancelled']);
  f.coordinator.dispose();
});

test('stale cancellation cannot stop a newer external generation', () => {
  const f = fixture(true); f.coordinator.startActivity(f.strip(1));
  f.coordinator.startActivity(f.strip(2)); f.coordinator.cancelActivity(1);
  f.external[1].callback('started'); f.external[1].callback('completed');
  assert.deepEqual(f.activityResults.map(x => [x.generation, x.outcome]), [[1, 'cancelled'], [2, 'started'], [2, 'completed']]);
  f.coordinator.dispose();
});

test('pending appearance blocks activity admission', () => {
  const f = fixture();
  f.update(2, {}, { ...f.appearance, presentationId: 'other', reason: 'scheduled' });
  assert.equal(f.coordinator.startActivity(f.motion(1)), false);
  assert.equal(f.activityResults.at(-1).outcome, 'cancelled');
  f.coordinator.dispose();
});

test('event decode failure does not disable an unrelated activity', () => {
  const f = fixture();
  f.appearance.assets.metadata.bindings.events.waving = [{ animation: 'wave' }];
  f.update(2, { event: { id: 'event', reaction: 'waving' } });
  f.calls.at(-1).callbacks.onFailed(new Error('event decode'));
  assert.equal(f.coordinator.startActivity(f.motion(1)), true);
  f.calls.at(-1).callbacks.onStarted();
  assert.equal(f.activityResults.at(-1).outcome, 'started');
  f.coordinator.dispose();
});
