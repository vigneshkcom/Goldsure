// Base URL for the SMS Gate API.
//
// Defaults to the project's free public cloud server. Point SMSGATE_API_URL at a
// self-hosted ("private") server in Vercel to move every send, delivery lookup
// and inbox export across with no code change and no redeploy of logic:
//
//   SMSGATE_API_URL=https://sms.goldsure.com.au
//
// Give it scheme + host only — the /3rdparty/v1 prefix is appended here, so the
// value works unchanged whether the server sits at a domain root or behind a
// path-preserving proxy. Trailing slashes are tolerated.
const BASE = (process.env.SMSGATE_API_URL || 'https://api.sms-gate.app').replace(/\/+$/, '');

export const SMSGATE_API = `${BASE}/3rdparty/v1`;

// True when still pointed at the shared public cloud — used by the health probe
// to say which server it is actually reporting on.
export const SMSGATE_IS_PUBLIC_CLOUD = BASE === 'https://api.sms-gate.app';
