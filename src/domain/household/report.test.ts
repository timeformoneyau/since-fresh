/**
 * "Report a problem" in households (Google Play's user-generated content
 * policy).
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reportProblemUrl, REPORT_SUBJECT } from './report.ts';

const HOME = { id: 'household-123', name: 'Home & garden' };

describe('reportProblemUrl', () => {
  test('no address yet: no link, so the app hides Report a problem', () => {
    assert.equal(reportProblemUrl('', HOME), null);
    assert.equal(reportProblemUrl('   ', HOME), null);
  });

  test('emails the support address with a subject and a short form to fill in', () => {
    const url = reportProblemUrl(' help@example.com ', HOME)!;
    assert.match(url, /^mailto:help@example\.com\?subject=/);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    assert.equal(params.get('subject'), REPORT_SUBJECT);
    const body = params.get('body')!;
    assert.match(body, /What happened\?/);
    assert.match(body, /Who or what is it about/);
    // Says which household, so the report can be acted on
    assert.match(body, /Household: Home & garden/);
    assert.match(body, /Reference: household-123/);
  });

  test('characters that mean something in a link are escaped', () => {
    const url = reportProblemUrl('help@example.com', { id: 'h1', name: 'A&B?=#' })!;
    assert.doesNotMatch(url, /A&B/);
    assert.match(url, /A%26B%3F%3D%23/);
  });
});
