import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sms = await readFile(new URL('../sms/index.html', import.meta.url), 'utf8');

test('SMS portal uses the dynamic mobile viewport and edge-to-edge phone layout', () => {
  assert.match(sms, /height:\s*100dvh/);
  assert.match(sms, /@media \(max-width: 560px\)[\s\S]*?\.page \{ padding: 60px 0 0;/);
  assert.match(sms, /\.sidebar-card, \.chat-card \{[\s\S]*?border-radius: 0;/);
});

test('SMS mobile chat separates customer details from action controls', () => {
  assert.match(sms, /grid-template-columns: 32px 38px minmax\(0,1fr\)/);
  assert.match(sms, /\.header-actions \{ grid-column: 1 \/ -1;/);
  assert.match(sms, /class="chat-phone-line" id="chatSubPhone"/);
  assert.match(sms, /class="chat-channel">SMS · via SMS Gate/);
  assert.match(sms, /#chatChips \.stage-select \{ width: 100%; max-width: 100%;/);
});

test('SMS mobile composer keeps controls readable and touch friendly', () => {
  assert.match(sms, /\.composer-label > span:last-child \{ display: grid !important;/);
  assert.match(sms, /\.tpl-toggle-btn \{ width: 100%; min-width: 0;/);
  assert.match(sms, /\.msg-input \{ min-height: 76px; max-height: 23dvh;[\s\S]*?font-size: 16px;/);
  assert.match(sms, /env\(safe-area-inset-bottom\)/);
});
