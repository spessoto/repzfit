import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSetRestTransitionMessage } from './bot-engine.js';

test('buildSetRestTransitionMessage avoids duplicate done prompt during rest transitions', () => {
  const started = buildSetRestTransitionMessage({
    currentSet: 2,
    targetSets: 3,
    restSeconds: 30,
    state: 'started',
  });

  assert.match(started, /descanso/i);
  assert.doesNotMatch(started, /me manda \*feito\*/i);

  const alreadyStarted = buildSetRestTransitionMessage({
    currentSet: 2,
    targetSets: 3,
    restSeconds: 20,
    remainingSeconds: 12,
    state: 'already_started',
  });

  assert.match(alreadyStarted, /faltam/i);
  assert.doesNotMatch(alreadyStarted, /me manda \*feito\*/i);
});
