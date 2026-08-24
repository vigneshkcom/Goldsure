// Single source of truth for who can be assigned a task on the team board and
// where their mail goes. Everyone is on @goldsure.com.au.
//
// Keep this list in step with two other places when the team changes:
//   - todo/index.html          PEOPLE (the name picker)
//   - todo/schema.sql          the assignee / created_by / completed_by CHECKs
export const AGENT_EMAILS = Object.freeze({
  Vignesh: 'vignesh@goldsure.com.au',
  David: 'david@goldsure.com.au',
  Shanira: 'shanira@goldsure.com.au',
  Alda: 'alda@goldsure.com.au',
  Amit: 'amit@goldsure.com.au',
});

export const AGENT_NAMES = Object.freeze(Object.keys(AGENT_EMAILS));

// Everyone who should receive the daily team digest.
export const DIGEST_RECIPIENTS = Object.freeze(Object.values(AGENT_EMAILS));

export function agentEmail(name) {
  return AGENT_EMAILS[name] || null;
}
