const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('editable placement stays in the working document and reaches the selected bounds', async () => {
    const events = [];
    const layer = {
        kind: 'smartObject',
        bounds: { left: 300, top: 200, right: 700, bottom: 500 }
    };
    const doc = {
        id: 12,
        activeLayers: [layer],
        selection: {
            bounds: { left: 25, top: 40, right: 225, bottom: 190 },
            async deselect() { events.push('deselect'); }
        }
    };
    const app = {
        activeDocument: doc,
        documents: {
            length: 1,
            add() { throw new Error('A temporary document must not be created'); }
        }
    };
    const action = {
        async batchPlay(descriptors) {
            const command = descriptors[0];
            events.push(command._obj);
            if (command._obj === 'transform') {
                const width = layer.bounds.right - layer.bounds.left;
                const height = layer.bounds.bottom - layer.bounds.top;
                layer.bounds.right = layer.bounds.left + width * command.width._value / 100;
                layer.bounds.bottom = layer.bounds.top + height * command.height._value / 100;
            } else if (command._obj === 'move') {
                const x = command.to.horizontal._value;
                const y = command.to.vertical._value;
                layer.bounds = {
                    left: layer.bounds.left + x,
                    right: layer.bounds.right + x,
                    top: layer.bounds.top + y,
                    bottom: layer.bounds.bottom + y
                };
            }
            return [{}];
        }
    };
    const core = {
        async executeAsModal(callback) {
            await callback({ hostControl: {
                async suspendHistory() { return 1; },
                async resumeHistory() {}
            } });
        }
    };
    const code = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'modules', 'ps.js'), 'utf8');
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module,
        console,
        require(name) {
            if (name === 'photoshop') return { app, action, core, imaging: {}, constants: {} };
            if (name === './settings.js' || name === './geometry.js') return {};
            throw new Error(`Unexpected import: ${name}`);
        }
    }, { filename: 'ps.js' });

    await module.exports.placeBack(
        'editableSo', 'result-token',
        { left: 25, top: 40, width: 200, height: 150 },
        null, { skipImageBlur: true }
    );

    assert.deepEqual(events, ['deselect', 'placeEvent', 'transform', 'move']);
    assert.deepEqual(layer.bounds, { left: 25, top: 40, right: 225, bottom: 190 });
    assert.equal(app.activeDocument, doc);
});
