const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TaskQueue, variationPrompt } = require('../plugin/task-queue');

function queueFor(client) {
  return new TaskQueue({ jobs: [], persist() {}, client: async () => client, onChange() {} });
}

test('one image submits the original instruction once and does not add a variation line', async () => {
  const calls = [];
  const client = {
    async submit(model, prompt, images, params) { calls.push({ model, prompt, images, params }); return 'only-task'; },
    async status() { return { is_final: true, state: 'success', result_url: 'https://cdn.example/only.png' }; }
  };
  const queue = queueFor(client);
  const record = { id: 'one', count: 1, model: 'banana-2', instruction: '把灯调暖', tasks: [] };
  await queue.submit(record, ['data:image/png;base64,YQ=='], { image_size: '1K', aspect_ratio: '16:9' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, '把灯调暖');
  assert.equal(variationPrompt('把灯调暖', 0, 1), '把灯调暖');
  await queue.tick();
  assert.equal(record.tasks.length, 1);
  assert.deepEqual(record.tasks[0].results.map(result => result.source), ['https://cdn.example/only.png']);
});

test('three distinct task ids keep three urls and each card resolves its own output', async () => {
  const calls = [];
  const urls = ['https://cdn.example/a.png', 'https://cdn.example/b.png', 'https://cdn.example/c.png'];
  const client = {
    async submit(model, prompt, images, params) { calls.push({ prompt, images, params }); return 'task-' + calls.length; },
    async status(id) { return { is_final: true, state: 'success', result_url: urls[Number(String(id).slice(5)) - 1] }; }
  };
  const queue = queueFor(client);
  const images = ['data:image/png;base64,YQ=='];
  const params = { image_size: '1K' };
  const record = { id: 'three', count: 3, model: 'banana-2', instruction: '宴会暖光', tasks: [] };
  await queue.submit(record, images, params);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map(call => call.prompt)).size, 3);
  assert.ok(calls.every(call => call.prompt.startsWith('宴会暖光')));
  assert.deepEqual(calls.map(call => call.images), [images, images, images]);
  assert.deepEqual(calls.map(call => call.params), [params, params, params]);
  await queue.tick();
  assert.deepEqual(record.tasks.map(task => task.id), ['task-1', 'task-2', 'task-3']);
  assert.deepEqual(record.tasks.map(task => task.results[0].source), urls);
  const output = data => record.tasks.find(task => task.id === data.taskId).results[data.index].source;
  assert.equal(output({ taskId: 'task-1', index: 0 }), urls[0]);
  assert.equal(output({ taskId: 'task-2', index: 0 }), urls[1]);
  assert.equal(output({ taskId: 'task-3', index: 0 }), urls[2]);
});

test('one upstream task id is kept once, polled once, and not submitted again', async () => {
  let submits = 0;
  let polls = 0;
  const client = {
    async submit() { submits++; return 'shared-task'; },
    async status(id) { polls++; assert.equal(id, 'shared-task'); return { is_final: true, state: 'success', result_url: 'https://cdn.example/same.png' }; }
  };
  const queue = queueFor(client);
  const record = { id: 'shared', count: 3, model: 'banana-2', instruction: '宴会', tasks: [] };
  await queue.submit(record, [], {});
  assert.equal(submits, 3);
  assert.equal(record.tasks.length, 1);
  assert.equal(record.tasks[0].id, 'shared-task');
  assert.match(record.prepareNote, /同一个任务/);
  assert.match(record.prepareNote, /没有再次提交/);
  await queue.tick();
  await queue.tick();
  assert.equal(polls, 1);
  assert.equal(submits, 3);
  assert.deepEqual(record.tasks[0].results.map(result => result.source), ['https://cdn.example/same.png']);
});
