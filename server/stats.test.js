// Run with: node --test server/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Stats, statsPage } from './stats.js';

const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-'));
  const s = new Stats({ dir, places: () => new Set(['chairquest']) });
  s.init();
  return s;
};

test('counts a visit once and keeps real events', () => {
  const s = fresh();
  s.record('1.2.3.4', { sid: 'abcdefgh', device: 'phone', from: 'megazine.org', secs: 20, ev: [['enter', 'chairquest', 1], ['click', 'btn-ride', 2]], grid: [[100, 3]] });
  s.record('1.2.3.4', { sid: 'abcdefgh', secs: 30, ev: [['enter', 'chairquest', 1]] });
  const t = s.summary();
  assert.equal(t.visits, 1);
  assert.equal(t.visitors, 1);
  assert.equal(t.phone, 1);
  assert.equal(t.secs, 50);
  assert.equal(t.events.enter['chairquest'], 2);
  assert.equal(t.events.click['btn-ride'], 2);
  assert.equal(t.from['megazine.org'], 1);
  assert.equal(t.durations[1], 1);
  s.stop();
});

test('refuses junk', () => {
  const s = fresh();
  for (const bad of [null, {}, { sid: '../../etc' }, { sid: 'x' }]) assert.equal(s.record('5.5.5.5', bad), false);
  s.record('5.5.5.5', { sid: 'abcdefgh', secs: 1e9, ev: [['enter', 'not-a-place', 1], ['evil', 'x', 1], ['click', '<script>', 1], 'nope'], grid: [[1e6, 1], ['a', 1]] });
  const t = s.summary();
  assert.deepEqual(t.events, {});
  assert.deepEqual(t.grid, {});
  assert.equal(t.secs, 600);
  s.stop();
});

test('totals survive a restart, and files hold no addresses', () => {
  const s = fresh();
  s.record('9.9.9.9', { sid: 'abcdefgh', secs: 5 });
  s.stop();
  assert.ok(!fs.readFileSync(s._file(s.day.date), 'utf8').includes('9.9.9.9'));
  const again = new Stats({ dir: s.dir });
  again.init();
  assert.equal(again.summary().visits, 1);
  again.record('9.9.9.9', { sid: 'ijklmnop', secs: 5 });
  assert.equal(again.summary().visitors, 1);
  again.stop();
});

test('a finished day keeps totals only', () => {
  const s = fresh();
  s.record('2.2.2.2', { sid: 'abcdefgh', secs: 700 });
  s.day.date = '2020-01-01';
  s.dirty = true;
  s.flush();
  s.summary(0);
  const old = JSON.parse(fs.readFileSync(s._file('2020-01-01'), 'utf8'));
  assert.equal(old.ids, undefined);
  assert.equal(old.sessions, undefined);
  assert.equal(old.visitors, 1);
  assert.equal(s.summary(0).visits, 1);
  s.stop();
});

test('the page draws with no data and escapes names', () => {
  const s = fresh();
  const html = statsPage(s.summary(), { days: 30, key: 'k', world: { structures: [{ id: 'a', name: '<b>', lat: 1, lon: 2 }] }, issue: { pieces: [{ id: 'a', title: '<i>' }] } });
  assert.ok(html.includes('&lt;i&gt;') && !html.includes('<i>'));
  s.stop();
});
