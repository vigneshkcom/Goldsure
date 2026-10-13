// Local-only demo and visual QA. No production credentials, network mail or DB writes.
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { certificateAction } from '../lib/qld-certificates.js';
import { CHECKS, signingToken } from '../lib/qld-certificate-model.js';
import { certificatePdf } from '../lib/qld-certificate-pdf.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.env.QLD_DEMO_OUTPUT || path.join(root, '..', 'output', 'pdf'));
await mkdir(output, { recursive: true });
const data = new Map(), mail = [];
const store = {
  setup: async () => {},
  get: async key => data.get(key) || null,
  put: async (key, value) => { if (data.has(key)) return false; data.set(key, value); return true; },
  list: async offset => [...data.keys()].filter(k => k.startsWith('requests/')).slice(offset, offset + 25).map(k => ({ name: k.split('/')[1] })),
};
const env = { DASHBOARD_PASSWORD: 'demo-only', QLD_CERTIFICATE_SIGNING_SECRET: 'local-demo-secret-never-use-in-production-12345' };
const draft = { jobNumber: 'DEMO-1001', customerName: 'Alex Taylor (SAMPLE)', customerEmail: 'customer@example.test', customerPhone: '0400 000 000', customerAddress: '10 Example Street, Brisbane QLD 4000', siteAddress: '10 Example Street, Brisbane QLD 4000', workForName: 'Alex Taylor (SAMPLE)', workForAddress: '10 Example Street, Brisbane QLD 4000', workForEmail: 'customer@example.test', electricianName: 'Sam Electrician (SAMPLE)', electricianEmail: 'electrician@example.test', certificateType: 'installation', state: 'QLD', smokeInspection: true, workDescription: 'SAMPLE ONLY. Installed and tested six interconnected photoelectric smoke alarms: three bedrooms, hallway and living areas. Tested alarm operation and interconnection for the work performed.' };
const id = 'c813f089-2f74-4f32-9231-b09d0f04ec44';
draft.prefill = { contractorName: 'Example Electrical (SAMPLE)', contractorLicence: 'SAMPLE-NOT-A-LICENCE', contractorPhone: '0400 000 001', testDate: '2026-10-12', smokeOutcome: 'compliant', checks: CHECKS.map(() => 'Yes'), replacementDate: '2036-10-12', notes: 'Prefilled sample only. Electrician must review and confirm.' };
const deps = { store, env, mailer: async item => { mail.push(item); }, allowedOrigin: 'http://127.0.0.1:4177' };
await certificateAction({ action: 'qld-certificate-send', draft, id, confirmSend: true }, { headers: { 'x-certificate-password': 'demo-only' } }, deps);
const preview = await certificatePdf({ ...draft, id: 'SAMPLE PREVIEW', createdAt: '2026-10-13T01:00:00Z' });
await writeFile(path.join(output, 'Queensland-Certificate-Preview.pdf'), preview);
const signed = { signerName: draft.electricianName, contractorName: 'Example Electrical (SAMPLE)', contractorLicence: 'SAMPLE-NOT-A-LICENCE', contractorPhone: '0400 000 001', testDate: '2026-10-12', signedAt: '2026-10-13T02:00:00Z', declaration: 'SAMPLE ONLY - NOT AN ISSUED CERTIFICATE. The electrical installation, to the extent affected by the work described, has been tested to ensure it is electrically safe and complies with applicable wiring rules and standards.', checks: CHECKS.map(() => 'Yes'), smokeOutcome: 'compliant', replacementDate: '2036-10-12', notes: 'Demonstration only. No real electrical work or certification.', strokes: [[[.1,.7],[.15,.3],[.2,.5],[.25,.8],[.3,.25],[.4,.6],[.5,.4],[.65,.6],[.8,.3]]] };
await writeFile(path.join(output, 'Queensland-Certificate-Signed-Sample.pdf'), await certificatePdf({ ...draft, id: 'SAMPLE-NOT-VALID', createdAt: '2026-10-13T01:00:00Z' }, signed));
await writeFile(path.join(output, 'Queensland-Certificate-Long-Fields-Sample.pdf'), await certificatePdf({ ...draft, id: 'SAMPLE-NOT-VALID', workDescription: 'Long example installation and equipment description. '.repeat(27), customerAddress: 'Long example customer address in Queensland. '.repeat(5), workForAddress: 'Long example commissioning-party address. '.repeat(5) }, { ...signed, notes: 'Detailed defect or exclusion description. '.repeat(35) }));
if (process.argv.includes('--render-only')) process.exit(0);
const token = signingToken(id, env.QLD_CERTIFICATE_SIGNING_SECRET);
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/demo-info') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ id, token, draft, mailCount: mail.length })); }
    if (req.url === '/api/smoke-alarms/google-key' && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 200000) throw new Error('Too large'); }
      const body = JSON.parse(raw);
      if (body.action === 'qld-certificate-lookup') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ...draft, source: 'LOCAL DEMO. Synthetic customer details only.' })); }
      const result = await certificateAction(body, req, deps);
      res.setHeader('Content-Type', result.pdf ? 'application/pdf' : 'application/json');
      return res.end(result.pdf || JSON.stringify(result));
    }
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.resolve(root, `.${urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath}`);
    if (!filename.startsWith(root) || !['.html', '.js', '.css', '.jpg', '.png'].includes(path.extname(filename))) { res.statusCode = 404; return res.end(); }
    const body = await readFile(filename);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' })[path.extname(filename)]);
    res.end(body);
  } catch (error) { res.statusCode = error.status || 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: error.message })); }
});
server.listen(4177, '127.0.0.1', () => console.log('LOCAL DEMO ONLY http://127.0.0.1:4177/compliance/ | Password: demo-only | Emails are mocked.'));
