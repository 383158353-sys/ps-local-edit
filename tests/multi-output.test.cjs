const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TaskQueue, fingerprint } = require('../plugin/task-queue');

function queueFor(client) {
  return new TaskQueue({ jobs: [], persist() {}, client: async () => client, onChange() {} });
}

test('one image submits the original instruction once', async () => {
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
  assert.deepEqual(calls[0].params, { image_size: '1K', aspect_ratio: '16:9' });
  await queue.tick();
  assert.equal(record.tasks.length, 1);
  assert.deepEqual(record.tasks[0].results.map(result => result.source), ['https://cdn.example/only.png']);
  assert.equal(record.prepareNote || '', '');
});

test('three distinct task ids keep the same prompt and each card resolves its own output', async () => {
  const calls = [];
  const urls = ['https://cdn.example/a.png', 'https://cdn.example/b.png', 'https://cdn.example/c.png'];
  const client = {
    async submit(model, prompt, images, params, submissionId) { calls.push({ prompt, images, params, submissionId }); return 'task-' + calls.length; },
    async status(id) { return { is_final: true, state: 'success', result_url: urls[Number(String(id).slice(5)) - 1] }; }
  };
  const queue = queueFor(client);
  const images = ['data:image/png;base64,YQ=='];
  const params = { image_size: '1K' };
  const record = { id: 'three', count: 3, model: 'banana-2', instruction: '宴会暖光', tasks: [] };
  await queue.submit(record, images, params);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.prompt), ['宴会暖光', '宴会暖光', '宴会暖光']);
  assert.deepEqual(calls.map(call => call.submissionId), ['three-0', 'three-1', 'three-2']);
  assert.deepEqual(calls.map(call => call.images), [images, images, images]);
  assert.deepEqual(calls.map(call => call.params), [params, params, params]);
  await queue.tick();
  assert.deepEqual(record.tasks.map(task => task.id), ['task-1', 'task-2', 'task-3']);
  assert.deepEqual(record.tasks.map(task => task.results[0].source), urls);
  const output = data => record.tasks.find(task => task.id === data.taskId).results[data.index].source;
  assert.equal(output({ taskId: 'task-2', index: 0 }), urls[1]);
  assert.equal(record.prepareNote || '', '');
});

test('a repeated task id is reported with a url fingerprint and is not submitted again', async () => {
  let submits = 0;
  let polls = 0;
  const source = 'https://cdn.example/same.png';
  const client = {
    async submit(model, prompt) { submits++; assert.equal(prompt, '宴会'); return 'shared-task'; },
    async status(id) { polls++; assert.equal(id, 'shared-task'); return { is_final: true, state: 'success', result_url: source }; }
  };
  const queue = queueFor(client);
  const record = { id: 'shared', count: 3, model: 'banana-2', instruction: '宴会', tasks: [], prepareNote: '图片使用原图提交。' };
  await queue.submit(record, [], {});
  assert.equal(submits, 3);
  assert.equal(record.tasks.length, 3);
  assert.match(record.prepareNote, /图片使用原图提交/);
  assert.match(record.prepareNote, /不同任务号 1 个/);
  await queue.tick();
  await queue.tick();
  assert.equal(polls, 1);
  assert.equal(submits, 3);
  assert.deepEqual(record.tasks.map(task => task.results[0].source), [source, source, source]);
  assert.match(record.prepareNote, /地址摘要不同 1 个/);
  assert.match(record.prepareNote, new RegExp(fingerprint(source)));
  assert.doesNotMatch(record.prepareNote, /cdn\.example|宴会|data:image|sk-/);
});

test('distinct task ids with one result url are reported and not regenerated', async () => {
  let submits = 0;
  const source = 'https://cdn.example/one-picture.png';
  const client = {
    async submit() { submits++; return 'task-' + submits; },
    async status() { return { is_final: true, state: 'success', result_url: source }; }
  };
  const queue = queueFor(client);
  const record = { id: 'urls', count: 3, model: 'banana-2', instruction: '原句', tasks: [] };
  await queue.submit(record, [], {});
  await queue.tick();
  assert.equal(submits, 3);
  assert.deepEqual(record.tasks.map(task => task.id), ['task-1', 'task-2', 'task-3']);
  assert.match(record.prepareNote, /不同任务号 3 个/);
  assert.match(record.prepareNote, /地址摘要不同 1 个/);
  assert.doesNotMatch(record.prepareNote, /one-picture|原句/);
});
