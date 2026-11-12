import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createSubmissionStore} from '../helper/server/media-submissions.mjs';

const payload = {model: 'banana-2', prompt: '保持原句', params: {image_size: '1K', images: ['data:image/png;base64,YQ==']}};

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {promise, release};
}

async function storeWith(fetchImpl) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'media-sub-'));
  return {directory, store: createSubmissionStore({directory, fetchImpl})};
}

test('three request ids with one payload each reach the platform once', async () => {
  const gate = deferred();
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(options.body);
    await gate.promise;
    return {status: 200, headers: {get: () => 'application/json'}, async text() { return JSON.stringify({data: {task_id: 'platform-' + bodies.length}}); }};
  };
  const {directory, store} = await storeWith(fetchImpl);
  try {
    const records = await Promise.all([0, 1, 2].map(index => store.start({key: 'test-key', payload, requestId: 'region-1-' + index})));
    assert.equal(new Set(records.map(record => record.id)).size, 3);
    assert.equal(bodies.length, 3);
    assert.deepEqual(bodies.map(body => JSON.parse(body).prompt), ['保持原句', '保持原句', '保持原句']);
    gate.release();
    await store.settled();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('repeating one request id does not start a second platform submission', async () => {
  const gate = deferred();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await gate.promise;
    return {status: 200, headers: {get: () => 'application/json'}, async text() { return JSON.stringify({data: {task_id: 'only-task'}}); }};
  };
  const {directory, store} = await storeWith(fetchImpl);
  try {
    const first = await store.start({key: 'test-key', payload, requestId: 'region-1-0'});
    const second = await store.start({key: 'test-key', payload, requestId: 'region-1-0'});
    assert.equal(first.id, second.id);
    assert.equal(calls, 1);
    gate.release();
    await store.settled();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
