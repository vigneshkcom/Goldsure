import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('David payment details come from a per-agent server override, not a public fallback', () => {
  const source = readFileSync(new URL('../api/smoke-alarms/reports/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Marijo Mcgoon|100127457|HFCLFJFJXXX/);
  assert.match(source, /David:\s*\{[^\n]*payName: '', bsb: '', acct: ''/);
  assert.match(source, /agentDetails\[agent\] = \{ \.\.\.agentDetails\[agent\], \.\.\.details \}/);
});

test('manager invoice can display the Fiji bank and SWIFT fields safely', () => {
  const html = readFileSync(new URL('../time/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  new vm.Script(script);
  assert.match(script, /Pay in Fiji dollars \(FJD\)/);
  assert.match(script, /escapeHtml\(d\.bank\)/);
  assert.match(script, /escapeHtml\(d\.swift\)/);
});
