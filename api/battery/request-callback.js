// Multi-purpose handler: SMS Gateway (send/receive/history) + legacy battery callback email
// Stays within the Vercel Hobby 12-function limit by reusing this file.
//
// Routes:
//   GET  ?phone=+61...                  → conversation history for that number
//   GET  (no phone)                     → contacts list (last message per number)
//   POST { action:'send', phone, message }  → send SMS via SMS Gate cloud API
//   POST { action:'webhook', ... }      → receive inbound SMS (webhook from SMS Gate)
//   POST { fullName, phone, ... }       → legacy battery callback email (unchanged)

import { sendHostingerMail } from '../../lib/hostinger-mail.js';

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  // Service-role key bypasses Row Level Security — needed for privileged ops like
  // hard-deletes (the anon key is subject to RLS, which can silently delete 0 rows
  // and still return 204). Server-side only; falls back to anon if it isn't set.
  const SUPABASE_ADMIN_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

  // Title-case names that come back all-lower or all-upper from GHL ("karen parsons"
  // → "Karen Parsons"), but leave deliberately mixed-case names ("McDonald") alone.
  const tidyName = (name) => {
    if (!name) return name;
    if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
    return name.toLowerCase().replace(/(^|[\s'’\-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  };

  // Normalise AU mobile formats to E.164 so inbound replies land in the same
  // thread as outbound sends (0412… / 61412… / +61412… are all the one number).
  // Non-matching values (shortcodes, alphanumeric sender IDs) pass through as-is.
  const normalizeAuPhone = (raw) => {
    let s = String(raw || '').replace(/[\s\-().]/g, '');
    if (!s) return s;
    if (s[0] === '+') return s;                          // already E.164
    if (s.startsWith('0061')) s = s.slice(2);            // 0061… intl prefix → 61…
    if (/^61\d{9}$/.test(s)) return '+' + s;             // 61451898761 → +61451898761
    if (/^0\d{9}$/.test(s)) return '+61' + s.slice(1);   // 0451898761 / 0712345678 → +61…
    if (/^4\d{8}$/.test(s)) return '+61' + s;            // 451898761 — leading 0 dropped by Excel
    return s;
  };

  // Opt-out state = most recent optout/optin marker row for this number.
  // Markers are set on inbound messages by the webhook (STOP → optout, START → optin).
  const isOptedOut = async (phone) => {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}&status=in.(optout,optin)&order=created_at.desc&limit=1&select=status`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await r.json();
      return Array.isArray(rows) && rows[0] && rows[0].status === 'optout';
    } catch { return false; }
  };

  // Best-effort GHL customer name for a phone number (last-9-digit match), bounded
  // so it can never hang a request. Returns '' on miss/error/timeout. Same lookup
  // approach as the ghl-opps / ghl-lookup actions.
  const ghlNameForPhone = async (phone) => {
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    if (!apiKey || !locationId || !phone) return '';
    const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);
    const target = last9(phone);
    if (target.length < 6) return '';
    const headers = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
    const variants = [...new Set([phone, phone.replace(/^\+/, ''), '0' + target, target])];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      for (const q of variants) {
        try {
          const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`, { headers, signal: ctrl.signal });
          if (!r.ok) continue;
          const d = await r.json();
          const match = (d.contacts || []).find(c => last9(c.phone) === target);
          if (match) {
            const name = tidyName([match.firstName, match.lastName].filter(Boolean).join(' ') || match.name || '');
            if (name) return name;
          }
        } catch { /* try the next phone-format variant */ }
      }
    } finally {
      clearTimeout(timer);
    }
    return '';
  };

  // Move a contact's opportunity into a "Quote Sent"-type stage (best-effort,
  // non-fatal). Used after an aircon / HWS quote email goes out. No GHL id config
  // is required: it reads the contact's existing opportunity and finds the stage
  // in that opportunity's own pipeline whose name matches one of `stageNames`.
  // Optional env overrides can force a specific pipeline id and/or stage id.
  // Won-/lost- (closed) opportunities are left untouched so a finished deal is
  // never dragged back to "Quote Sent". Returns { moved, reason } for logging.
  const moveContactToStage = async ({ contactId, stageNames = [], pipelineIdEnv = '', stageIdEnv = '' }) => {
    const apiKey = process.env.GHL_API_KEY, locationId = process.env.GHL_LOCATION_ID;
    if (!apiKey || !locationId || !contactId) return { moved: false, reason: 'not-configured' };
    const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
    try {
      const oRes = await fetch(`https://services.leadconnectorhq.com/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}`, { headers: hdrs });
      if (!oRes.ok) return { moved: false, reason: `opp-search ${oRes.status}` };
      let opps = (await oRes.json()).opportunities || [];
      // Never touch a closed deal.
      opps = opps.filter(o => !['won', 'lost', 'abandoned'].includes(String(o.status || '').toLowerCase()));
      if (!opps.length) return { moved: false, reason: 'no-open-opportunity' };
      // Prefer an opp in the configured pipeline; else the most recently updated one.
      if (pipelineIdEnv) {
        const inPipe = opps.filter(o => o.pipelineId === pipelineIdEnv);
        if (inPipe.length) opps = inPipe;
      }
      opps.sort((a, b) => new Date(b.updatedAt || b.dateUpdated || 0) - new Date(a.updatedAt || a.dateUpdated || 0));
      const opp = opps[0];
      const pipelineId = opp.pipelineId;
      let stageId = stageIdEnv || '';
      if (!stageId) {
        const pRes = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers: hdrs });
        const pipes = pRes.ok ? ((await pRes.json()).pipelines || []) : [];
        const pipe = pipes.find(p => p.id === pipelineId);
        const stages = pipe ? (pipe.stages || []) : [];
        const wanted = stageNames.map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
        const match = stages.find(s => wanted.includes(String(s.name || '').trim().toLowerCase()))
          || stages.find(s => wanted.some(w => String(s.name || '').toLowerCase().includes(w)));
        stageId = match ? match.id : '';
      }
      if (!stageId) return { moved: false, reason: 'stage-not-found' };
      if (opp.pipelineStageId === stageId) return { moved: false, reason: 'already-there' };
      const uRes = await fetch(`https://services.leadconnectorhq.com/opportunities/${encodeURIComponent(opp.id)}`, {
        method: 'PUT', headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId, pipelineStageId: stageId }),
      });
      if (!uRes.ok) return { moved: false, reason: `update ${uRes.status}` };
      return { moved: true };
    } catch (e) { return { moved: false, reason: e.message }; }
  };

  // ── GET: history or contacts ────────────────────────────────────────────────
  if (req.method === 'GET') {
    // Debug: last 25 rows as saved (newest receive-time first) — use to check
    // whether a missing reply ever reached the database at all.
    if (req.query.action === 'recent') {
      const supaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,direction,status,created_at,message,sms_gate_id&order=created_at.desc&limit=25`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await supaRes.json();
      return res.status(200).json(rows);
    }

    // Shared read-state for the unread badge. Lives server-side so "read" is the
    // same on every browser/device (the old localStorage version was per-browser,
    // which is why a fresh browser showed every conversation as unread). The
    // reserved row phone_number='__ALL__' holds the global "mark all read" time.
    // Returns { allReadAt:<ISO|null>, seen:{ "<phone>":"<ISO>" } }. If the table
    // hasn't been created yet it returns empty state, so the UI falls back to its
    // local cache instead of breaking.
    if (req.query.action === 'read-state') {
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/sms_read_state?select=phone_number,last_seen_at`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        if (!r.ok) return res.status(200).json({ allReadAt: null, seen: {}, warning: 'read-state table missing' });
        const rows = await r.json();
        const seen = {};
        let allReadAt = null;
        for (const row of (Array.isArray(rows) ? rows : [])) {
          if (row.phone_number === '__ALL__') allReadAt = row.last_seen_at;
          else seen[row.phone_number] = row.last_seen_at;
        }
        return res.status(200).json({ allReadAt, seen });
      } catch (e) {
        return res.status(200).json({ allReadAt: null, seen: {}, warning: 'read-state unavailable' });
      }
    }

    // GHL contact search (used by new-conversation picker in the SMS UI)
    if (req.query.action === 'ghl-contacts') {
      const q = (req.query.q || '').trim();
      if (!q) return res.status(200).json([]);
      const apiKey    = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (!apiKey || !locationId) return res.status(200).json([]);
      const ghlRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`,
        { headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' } }
      );
      if (!ghlRes.ok) return res.status(200).json([]);
      const ghlData = await ghlRes.json();
      const contacts = (ghlData.contacts || [])
        .filter(c => c.phone)
        .map(c => ({
          id:    c.id,
          name:  tidyName([c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '') || c.phone,
          phone: c.phone,
          email: c.email || '',
          address: [c.address1, c.city, c.state, c.postalCode].filter(Boolean).join(', '),
        }));
      return res.status(200).json(contacts);
    }

    // GHL reverse lookup: phone numbers → customer names (resolves sidebar names)
    if (req.query.action === 'ghl-lookup') {
      const phones = String(req.query.phones || '')
        .split(',').map(p => p.trim()).filter(Boolean).slice(0, 50);
      if (!phones.length) return res.status(200).json({});
      const apiKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (!apiKey || !locationId) {
        return res.status(200).json(req.query.debug ? { error: 'GHL env not set', hasKey: !!apiKey, hasLocation: !!locationId } : {});
      }

      const debug   = !!req.query.debug;
      const last9   = s => String(s || '').replace(/\D/g, '').slice(-9);
      const headers = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
      const out = {};
      const diag = [];

      await Promise.all(phones.map(async (phone) => {
        const target = last9(phone);
        if (target.length < 6) return;
        // Query GHL with the full number as stored (E.164), then national, then bare —
        // first format that returns a contact whose last-9 digits match wins.
        const variants = [phone, phone.replace(/^\+/, ''), '0' + target, target];
        for (const q of [...new Set(variants)]) {
          try {
            const r = await fetch(
              `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`,
              { headers }
            );
            const d = r.ok ? await r.json() : {};
            const candidates = d.contacts || [];
            if (debug) diag.push({ phone, query: q, status: r.status, returned: candidates.length,
              candidates: candidates.slice(0, 5).map(c => ({ name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name, phone: c.phone, last9: last9(c.phone) })) });
            const match = candidates.find(c => last9(c.phone) === target);
            if (match) {
              const name = [match.firstName, match.lastName].filter(Boolean).join(' ') || match.name || '';
              if (name) { out[phone] = tidyName(name); return; }
            }
          } catch (e) { if (debug) diag.push({ phone, query: q, error: String(e) }); }
        }
      }));

      return res.status(200).json(debug ? { results: out, diag } : out);
    }

    // GHL opportunities: phones → { name, contactId, pipeline, stage, value, link }
    // Powers the stage pill in the sidebar and the pipeline chips in the chat header.
    if (req.query.action === 'ghl-opps') {
      const phones = String(req.query.phones || '')
        .split(',').map(p => p.trim()).filter(Boolean).slice(0, 15);
      if (!phones.length) return res.status(200).json({});
      const apiKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (!apiKey || !locationId) return res.status(200).json({});

      const last9   = s => String(s || '').replace(/\D/g, '').slice(-9);
      const headers = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };

      // Pipeline + stage id → name maps (one call covers every contact)
      let pipes = [];
      try {
        const pRes = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers });
        if (pRes.ok) pipes = (await pRes.json()).pipelines || [];
      } catch {}
      const pipeName  = pid => (pipes.find(p => p.id === pid) || {}).name || '';
      const stageName = (pid, sid) => {
        const p = pipes.find(x => x.id === pid);
        return p ? ((p.stages || []).find(s => s.id === sid) || {}).name || '' : '';
      };

      const out = {};
      await Promise.all(phones.map(async (phone) => {
        let contactId = phones.length === 1 ? (req.query.cid || null) : null;
        let name = '';
        if (!contactId) {
          const target = last9(phone);
          if (target.length < 6) return;
          const variants = [...new Set([phone, phone.replace(/^\+/, ''), '0' + target, target])];
          for (const q of variants) {
            try {
              const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`, { headers });
              if (!r.ok) continue;
              const d = await r.json();
              const match = (d.contacts || []).find(c => last9(c.phone) === target);
              if (match) {
                contactId = match.id;
                name = tidyName([match.firstName, match.lastName].filter(Boolean).join(' ') || match.name || '');
                break;
              }
            } catch {}
          }
        }
        if (!contactId) { out[phone] = { none: true }; return; }

        const info = {
          name, contactId,
          link: `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`,
        };
        try {
          const oRes = await fetch(`https://services.leadconnectorhq.com/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}`, { headers });
          if (oRes.ok) {
            const opps = (await oRes.json()).opportunities || [];
            const byUpdated = (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
            const opp = opps.filter(o => o.status === 'open').sort(byUpdated)[0] || opps.sort(byUpdated)[0];
            if (opp) {
              info.pipeline      = pipeName(opp.pipelineId);
              info.stage         = stageName(opp.pipelineId, opp.pipelineStageId);
              info.value         = opp.monetaryValue || 0;
              info.oppStatus     = opp.status || '';
              info.opportunityId = opp.id;
              info.pipelineId    = opp.pipelineId;
              info.stageId       = opp.pipelineStageId;
              // Stage list for this contact's pipeline → powers the stage dropdown
              const pipe = pipes.find(x => x.id === opp.pipelineId);
              info.stages = pipe ? (pipe.stages || []).map(s => ({ id: s.id, name: s.name })) : [];
            }
          }
        } catch {}
        out[phone] = info;
      }));

      return res.status(200).json(out);
    }

    // Find GHL contacts by name plus the last 4 digits of their mobile.
    // The photo tracker only knows customers as "John Smith (8761)" — the two
    // together pin down one contact without needing the full number stored
    // anywhere, and it resolves folders created before any of this existed.
    //   ?action=ghl-find&items=John%20Smith~8761,Karen%20Parsons~4821
    // → { "John Smith~8761": { phone, pipeline, stage, contactId, link } }
    if (req.query.action === 'ghl-find') {
      const items = String(req.query.items || '')
        .split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
      if (!items.length) return res.status(200).json({});

      const apiKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (!apiKey || !locationId) return res.status(200).json({});
      const headers = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };

      let pipes = [];
      try {
        const pRes = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers });
        if (pRes.ok) pipes = (await pRes.json()).pipelines || [];
      } catch {}
      const pipeName  = pid => (pipes.find(p => p.id === pid) || {}).name || '';
      const stageName = (pid, sid) => {
        const p = pipes.find(x => x.id === pid);
        return p ? ((p.stages || []).find(s => s.id === sid) || {}).name || '' : '';
      };

      const out = {};
      await Promise.all(items.map(async (item) => {
        const [rawName, last4] = item.split('~');
        const name = (rawName || '').trim();
        if (!name) return;
        try {
          const r = await fetch(
            `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(name)}&limit=20`,
            { headers }
          );
          if (!r.ok) return;
          const contacts = (await r.json()).contacts || [];
          const digits = c => String(c.phone || '').replace(/\D/g, '');
          // With last 4 digits, insist on that match so two customers sharing a
          // name can't be confused. Without them, only accept an unambiguous
          // single result rather than guessing.
          const match = last4
            ? contacts.find(c => digits(c).slice(-4) === last4)
            : (contacts.length === 1 ? contacts[0] : null);
          if (!match) return;

          const info = {
            contactId: match.id,
            phone: match.phone || '',
            link: `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${match.id}`,
          };
          try {
            const oRes = await fetch(`https://services.leadconnectorhq.com/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(match.id)}`, { headers });
            if (oRes.ok) {
              const opps = (await oRes.json()).opportunities || [];
              const byUpdated = (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
              const opp = opps.filter(o => o.status === 'open').sort(byUpdated)[0] || opps.sort(byUpdated)[0];
              if (opp) {
                info.pipeline = pipeName(opp.pipelineId);
                info.stage    = stageName(opp.pipelineId, opp.pipelineStageId);
                info.opportunityId = opp.id;
              }
            }
          } catch {}
          out[item] = info;
        } catch {}
      }));

      return res.status(200).json(out);
    }

    // Delivery status: poll SMS Gate for outbound message states and persist
    // delivered/failed back to Supabase so polling stops once final.
    if (req.query.action === 'delivery') {
      const ids = String(req.query.ids || '')
        .split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
      if (!ids.length) return res.status(200).json({ states: {}, changed: 0 });
      const user = process.env.SMSGATE_USERNAME;
      const pass = process.env.SMSGATE_PASSWORD;
      if (!user || !pass) return res.status(200).json({ states: {}, changed: 0 });
      const credentials = Buffer.from(`${user}:${pass}`).toString('base64');

      const states = {};
      let changed = 0;
      for (const id of ids) {
        try {
          const r = await fetch(`https://api.sms-gate.app/3rdparty/v1/messages/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Basic ${credentials}` },
          });
          if (!r.ok) continue;
          const d = await r.json();
          const st = String(d.state || '').toLowerCase();
          states[id] = st;
          const newStatus = st === 'delivered' ? 'delivered' : st === 'failed' ? 'failed' : null;
          if (newStatus) {
            await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?sms_gate_id=eq.${encodeURIComponent(id)}&direction=eq.outbound&status=neq.deleted&status=neq.${newStatus}`, {
              method: 'PATCH',
              headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ status: newStatus }),
            });
            changed++;
          }
        } catch {}
      }
      return res.status(200).json({ states, changed });
    }

    // Dashboard stats: 30-day aggregates + scheduled queue + opt-out count.
    // `tzo` = client timezone offset minutes (Date.getTimezoneOffset()) so day
    // buckets ("today", the 14-day chart) follow the viewer's local midnight.
    if (req.query.action === 'stats') {
      const tzo = parseInt(req.query.tzo, 10) || 0;
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

      const [rowsRes, schedRes, markersRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,message,direction,status,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=2000`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,message,sms_gate_id&status=eq.scheduled&limit=50`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,status,created_at&status=in.(optout,optin)&order=created_at.desc&limit=1000`, { headers }),
      ]);
      const rows = await rowsRes.json().catch(() => []);
      const schedRows = await schedRes.json().catch(() => []);
      const markers = await markersRes.json().catch(() => []);

      // Local calendar-day key for a timestamp, shifted by the client's offset
      const dayKey = (iso) => new Date(new Date(iso).getTime() - tzo * 60000).toISOString().slice(0, 10);
      const todayKey = dayKey(new Date().toISOString());

      const daily = [];
      const dailyIdx = {};
      for (let i = 13; i >= 0; i--) {
        const key = dayKey(new Date(Date.now() - i * 86400000).toISOString());
        dailyIdx[key] = daily.length;
        daily.push({ date: key, sent: 0, received: 0 });
      }

      const today = { sent: 0, received: 0 };
      const month = { sent: 0, received: 0 };
      const weekCut = Date.now() - 7 * 86400000;
      const phonesSeen = new Set();

      for (const r of (Array.isArray(rows) ? rows : [])) {
        const st = r.status;
        // Internal rows aren't traffic. optout/optin ARE inbound texts (STOP/START)
        // so they still count as received.
        if (st === 'note' || st === 'cancelled' || st === 'scheduled' || st === 'sending' || st === 'deleted') continue;
        const isOut = r.direction === 'outbound';
        const isIn = r.direction === 'inbound';
        phonesSeen.add(r.phone_number);
        const key = dayKey(r.created_at);

        if (isOut) month.sent++; else if (isIn) month.received++;
        if (key === todayKey) { if (isOut) today.sent++; else if (isIn) today.received++; }
        if (key in dailyIdx) {
          if (isOut) daily[dailyIdx[key]].sent++;
          else if (isIn) daily[dailyIdx[key]].received++;
        }
      }

      const failed = (Array.isArray(rows) ? rows : [])
        .filter(r => r.direction === 'outbound' && r.status === 'failed' && new Date(r.created_at).getTime() >= weekCut)
        .slice(0, 10)
        .map(r => ({ phone: r.phone_number, preview: String(r.message || '').slice(0, 90), at: r.created_at }));

      // Currently opted out = newest marker per phone is 'optout'
      const markerSeen = new Set();
      let optedOut = 0;
      for (const m of (Array.isArray(markers) ? markers : [])) {
        if (markerSeen.has(m.phone_number)) continue;
        markerSeen.add(m.phone_number);
        if (m.status === 'optout') optedOut++;
      }

      const scheduled = (Array.isArray(schedRows) ? schedRows : [])
        .map(s => ({
          phone: s.phone_number,
          at: (typeof s.sms_gate_id === 'string' && s.sms_gate_id.startsWith('sched:')) ? s.sms_gate_id.slice(6) : null,
          preview: String(s.message || '').slice(0, 90),
        }))
        .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));

      return res.status(200).json({
        today, month, daily,
        activeContacts: phonesSeen.size,
        scheduled, failed, optedOut,
      });
    }

    // Fire all past-due scheduled messages across every phone. Driven by:
    //   • the GitHub Actions cron (every 5 min) so sends happen with no portal open
    //   • the bulk-send progress poller and the per-conversation open path in the UI
    // Drains in batches within a time budget so a backlog clears quickly without
    // ever exceeding the serverless function timeout. Per-message claim
    // (scheduled→sending) guarantees a message is never sent twice.
    if (req.query.action === 'fire-scheduled') {
      const ah = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
      const user = process.env.SMSGATE_USERNAME;
      const pass = process.env.SMSGATE_PASSWORD;
      const credentials = (user && pass) ? Buffer.from(`${user}:${pass}`).toString('base64') : null;
      const deadline = Date.now() + 8000; // stay safely under the 10s default timeout
      let fired = 0, failed = 0, cancelled = 0;
      const processed = []; // [{id, status}] so the UI can reflect the real outcome

      while (credentials && Date.now() < deadline) {
        const schedRes = await fetch(
          `${SUPABASE_URL}/rest/v1/sms_messages?status=eq.scheduled&select=id,phone_number,message,sms_gate_id&order=created_at.asc&limit=25`,
          { headers: ah }
        );
        const all = await schedRes.json().catch(() => []);
        const pastDue = (Array.isArray(all) ? all : []).filter(m => {
          if (!m.sms_gate_id || !m.sms_gate_id.startsWith('sched:')) return false;
          const ts = new Date(m.sms_gate_id.slice(6, 32));
          return !isNaN(ts) && ts <= new Date();
        });
        if (!pastDue.length) break; // nothing due right now (older rows are future-dated)

        for (const m of pastDue) {
          if (Date.now() >= deadline) break;
          if (await isOptedOut(m.phone_number)) {
            await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}`, {
              method: 'PATCH',
              headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ status: 'cancelled' }),
            });
            cancelled++; processed.push({ id: m.id, status: 'cancelled' });
            continue;
          }
          const claimRes = await fetch(
            `${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}&status=eq.scheduled`,
            { method: 'PATCH', headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify({ status: 'sending' }) }
          );
          const claimed = await claimRes.json().catch(() => []);
          if (!Array.isArray(claimed) || !claimed.length) continue; // claimed by a concurrent run
          try {
            const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
              method: 'POST',
              headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phoneNumbers: [m.phone_number],
                textMessage: { text: m.message },
                ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}),
              }),
            });
            const newStatus = smsRes.ok ? 'sent' : 'failed';
            const smsData = smsRes.ok ? await smsRes.json().catch(() => ({})) : {};
            await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}`, {
              method: 'PATCH',
              headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ status: newStatus, ...(smsData.id ? { sms_gate_id: smsData.id } : {}) }),
            });
            if (smsRes.ok) { fired++; processed.push({ id: m.id, status: 'sent' }); }
            else { failed++; processed.push({ id: m.id, status: 'failed' }); }
          } catch (e) {
            // Network/send error after claiming — mark failed so it isn't stuck
            // 'sending' forever (and won't be re-sent, since it's no longer scheduled).
            await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}`, {
              method: 'PATCH',
              headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ status: 'failed' }),
            }).catch(() => {});
            failed++; processed.push({ id: m.id, status: 'failed' });
          }
        }
      }

      // Total remaining scheduled (so callers know whether to keep draining)
      const remRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?status=eq.scheduled&select=id&limit=1000`,
        { headers: ah }
      );
      const remRows = await remRes.json().catch(() => []);
      return res.status(200).json({
        fired, failed, cancelled, processed,
        remaining: Array.isArray(remRows) ? remRows.length : 0,
        ...(credentials ? {} : { error: 'SMS gateway credentials not configured' }),
      });
    }

    // Status of specific scheduled rows by id — lets the bulk-send progress
    // screen show the *real* outcome (sent / failed / cancelled / still pending)
    // instead of guessing from the clock.
    if (req.query.action === 'bulk-status') {
      const ah = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
      const ids = String(req.query.ids || '')
        .split(',').map(s => s.trim())
        .filter(s => /^[0-9a-fA-F-]{6,40}$/.test(s)) // uuids only
        .slice(0, 500);
      if (!ids.length) return res.status(200).json({ statuses: [] });
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?id=in.(${ids.join(',')})&select=id,status`,
        { headers: ah }
      );
      const rows = r.ok ? await r.json().catch(() => []) : [];
      return res.status(200).json({ statuses: Array.isArray(rows) ? rows : [] });
    }

    // Bulk-only conversations: phones whose only (non-cancelled) activity is
    // bulk sends. The sidebar shows these collapsed behind one named group per
    // campaign; the moment a customer replies (or is messaged manually) they
    // gain a non-bulk row and move to the main contacts list instead.
    // Returns { campaigns: [{ name, count, latest, contacts }], count, latest }.
    if (req.query.action === 'bulk-threads') {
      res.setHeader('Cache-Control', 'no-store');
      const ah = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
      const empty = { campaigns: [], count: 0, latest: null };

      // Try selecting campaign too; fall back if the column doesn't exist yet
      let bulkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,message,direction,created_at,status,campaign&is_bulk=is.true&order=created_at.desc&limit=500`,
        { headers: ah }
      );
      if (!bulkRes.ok) {
        bulkRes = await fetch(
          `${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,message,direction,created_at,status&is_bulk=is.true&order=created_at.desc&limit=500`,
          { headers: ah }
        );
      }
      if (!bulkRes.ok) return res.status(200).json(empty);
      const bulkRows = await bulkRes.json().catch(() => []);

      // Latest non-cancelled bulk row per phone (carries that phone's campaign)
      const latestBulk = [];
      const seenBulk = new Set();
      for (const r of (Array.isArray(bulkRows) ? bulkRows : [])) {
        if (r.status === 'cancelled' || r.status === 'deleted') continue;
        if (seenBulk.has(r.phone_number)) continue;
        seenBulk.add(r.phone_number);
        latestBulk.push(r);
      }
      if (!latestBulk.length) return res.status(200).json(empty);

      // Drop phones with any real (non-bulk) activity — those live in the main list
      const realRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,status&is_bulk=not.is.true&order=created_at.desc&limit=500`,
        { headers: ah }
      );
      const realRows = realRes.ok ? await realRes.json().catch(() => []) : [];
      const realPhones = new Set((Array.isArray(realRows) ? realRows : [])
        .filter(r => r.status !== 'note' && r.status !== 'cancelled' && r.status !== 'deleted')
        .map(r => r.phone_number));
      const contacts = latestBulk.filter(r => !realPhones.has(r.phone_number));
      if (!contacts.length) return res.status(200).json(empty);

      // Group by campaign name (untagged / legacy rows fall under "Bulk sends")
      const groups = new Map();
      for (const c of contacts) {
        const name = (c.campaign && String(c.campaign).trim()) || 'Bulk sends';
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(c);
      }
      const campaigns = [...groups.entries()].map(([name, list]) => ({
        name,
        count: list.length,
        latest: list[0] ? list[0].created_at : null, // list keeps desc order from the source
        contacts: list,
      })).sort((a, b) => new Date(b.latest) - new Date(a.latest));

      return res.status(200).json({
        campaigns,
        count: contacts.length,
        latest: campaigns.length ? campaigns[0].latest : null,
      });
    }

    // Return all GHL pipelines with their stages — used to populate the bulk SMS
    // pipeline/stage filter dropdowns. On failure the response carries GHL's own
    // status + message (and ?debug=1 adds env state) so production failures are
    // diagnosable from the browser without Vercel log access.
    if (req.query.action === 'ghl-pipelines') {
      res.setHeader('Cache-Control', 'no-store');
      const apiKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      const debug      = !!req.query.debug;
      const dbg = (extra) => debug ? {
        hasKey: !!apiKey, keyLength: (apiKey || '').length,
        locationId: locationId || null, ...extra,
      } : {};
      if (!apiKey || !locationId) {
        return res.status(200).json({ error: 'GHL not configured on server — set GHL_API_KEY and GHL_LOCATION_ID in Vercel', ...dbg() });
      }
      try {
        const r = await fetch(
          `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
          { headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' } }
        );
        const raw = await r.text();
        let data = null;
        try { data = JSON.parse(raw); } catch {}
        if (!r.ok) {
          const ghlMsg = data && (data.message || data.error) ? String(data.message || data.error).slice(0, 160) : '';
          console.error('[ghl-pipelines] GHL error', r.status, raw.slice(0, 400));
          return res.status(200).json({
            error: `GHL responded ${r.status}${ghlMsg ? ': ' + ghlMsg : ''}`,
            ...dbg({ ghlStatus: r.status, ghlBody: raw.slice(0, 400) }),
          });
        }
        const pipelines = (data && data.pipelines) || [];
        if (!pipelines.length) {
          console.error('[ghl-pipelines] empty pipeline list. Body:', raw.slice(0, 400));
          return res.status(200).json({
            error: 'GHL returned no pipelines — check GHL_LOCATION_ID matches the location that owns the pipelines',
            ...dbg({ ghlStatus: r.status, ghlBody: raw.slice(0, 400) }),
          });
        }
        return res.status(200).json(
          pipelines.map(p => ({
            id: p.id, name: p.name,
            stages: (p.stages || []).map(s => ({ id: s.id, name: s.name })),
          }))
        );
      } catch (e) {
        console.error('[ghl-pipelines] fetch threw', e.message);
        return res.status(200).json({ error: 'GHL request failed: ' + e.message, ...dbg() });
      }
    }

    // Return contacts (phone + name) for every open opportunity in a given pipeline
    // stage — powers "load all from GHL stage" in bulk SMS.
    if (req.query.action === 'ghl-stage-contacts') {
      res.setHeader('Cache-Control', 'no-store');
      const stageId    = String(req.query.stageId || '').trim();
      const apiKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (!stageId) return res.status(200).json({ error: 'stageId required' });
      if (!apiKey || !locationId) return res.status(200).json({ error: 'GHL not configured on server — set GHL_API_KEY and GHL_LOCATION_ID in Vercel' });
      const ghlHeaders = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
      try {
        const r = await fetch(
          `https://services.leadconnectorhq.com/opportunities/search?location_id=${encodeURIComponent(locationId)}&pipeline_stage_id=${encodeURIComponent(stageId)}&status=open&limit=100`,
          { headers: ghlHeaders }
        );
        const raw = await r.text();
        let data = null;
        try { data = JSON.parse(raw); } catch {}
        if (!r.ok) {
          const ghlMsg = data && (data.message || data.error) ? String(data.message || data.error).slice(0, 160) : '';
          console.error('[ghl-stage-contacts] GHL error', r.status, raw.slice(0, 400));
          return res.status(200).json({ error: `GHL responded ${r.status}${ghlMsg ? ': ' + ghlMsg : ''}` });
        }
        const opportunities = (data && data.opportunities) || [];
        const out = [];
        const missingPhone = []; // opps whose embedded contact had no usable phone
        for (const opp of opportunities) {
          const c = opp.contact || {};
          const phone = normalizeAuPhone(c.phone || '');
          const name = tidyName([c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '');
          if (phone && /\d{6,}/.test(phone)) out.push({ phone, name });
          else if (c.id || opp.contactId) missingPhone.push(c.id || opp.contactId);
        }
        // Some GHL responses embed the contact without a phone — fetch those
        // contacts individually so stages still load completely.
        if (missingPhone.length) {
          await Promise.all([...new Set(missingPhone)].slice(0, 50).map(async (cid) => {
            try {
              const cr = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(cid)}`, { headers: ghlHeaders });
              if (!cr.ok) return;
              const cd = await cr.json();
              const c = cd.contact || cd || {};
              const phone = normalizeAuPhone(c.phone || '');
              if (!phone || !/\d{6,}/.test(phone)) return;
              const name = tidyName([c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '');
              out.push({ phone, name });
            } catch {}
          }));
        }
        if (!out.length && opportunities.length) {
          return res.status(200).json({ error: `Stage has ${opportunities.length} open opportunit${opportunities.length > 1 ? 'ies' : 'y'} but none have a contact phone number` });
        }
        // Deduplicate by phone (can be multiple opps per contact)
        const seen = new Set();
        return res.status(200).json(out.filter(x => seen.has(x.phone) ? false : (seen.add(x.phone), true)));
      } catch (e) {
        console.error('[ghl-stage-contacts] fetch threw', e.message);
        return res.status(200).json({ error: 'GHL request failed: ' + e.message });
      }
    }

    const { phone } = req.query;

    if (phone) {
      // Conversation thread for one number. Fetch newest-first then reverse, so
      // a thread longer than 300 rows keeps its NEWEST messages — ascending with
      // a limit would silently cut off the latest replies on busy threads.
      const supaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}&status=neq.deleted&order=created_at.desc&limit=300`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await supaRes.json();
      const messages = (Array.isArray(rows) ? rows : []).reverse();

      // Fire any past-due scheduled messages (best-effort, async)
      const pastDue = messages.filter(m =>
        m.status === 'scheduled' &&
        typeof m.sms_gate_id === 'string' && m.sms_gate_id.startsWith('sched:') &&
        new Date(m.sms_gate_id.replace('sched:', '')) <= new Date()
      );
      if (pastDue.length) {
        const user = process.env.SMSGATE_USERNAME;
        const pass = process.env.SMSGATE_PASSWORD;
        if (user && pass) {
          const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
          for (const m of pastDue) {
            // Claim the row first (scheduled → sending). PostgREST only returns
            // rows it actually updated, so if a concurrent/overlapping poll has
            // already claimed this one, we get nothing back and skip it — the
            // message can never be sent twice.
            let claimed = [];
            try {
              const claimRes = await fetch(
                `${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}&status=eq.scheduled`,
                {
                  method: 'PATCH',
                  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
                  body: JSON.stringify({ status: 'sending' }),
                }
              );
              claimed = await claimRes.json().catch(() => []);
            } catch (e) { console.error('[Schedule claim]', e.message); }
            if (!Array.isArray(claimed) || !claimed.length) { m.status = 'sending'; continue; }

            // Customer may have opted out after this was scheduled
            if (await isOptedOut(m.phone_number)) {
              await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}`, {
                method: 'PATCH',
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ status: 'cancelled' }),
              });
              m.status = 'cancelled';
              continue;
            }

            try {
              const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
                method: 'POST',
                headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  phoneNumbers: [m.phone_number],
                  textMessage: { text: m.message },
                  ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}),
                }),
              });
              const newStatus = smsRes.ok ? 'sent' : 'failed';
              const smsData = smsRes.ok ? await smsRes.json().catch(() => ({})) : {};
              await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}`, {
                method: 'PATCH',
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ status: newStatus, sms_gate_id: smsData.id || m.sms_gate_id }),
              });
              m.status = newStatus;
            } catch (e) { console.error('[Schedule fire]', e.message); }
          }
        }
      }

      return res.status(200).json(messages);
    }

    // Contacts: deduplicate to latest message per phone number.
    // Skip internal notes and cancelled rows so they don't masquerade as the
    // conversation's latest message in the sidebar preview.
    // Bulk-send rows are excluded entirely: a blast must not flood the
    // sidebar, reshuffle it, or push real conversations out of the 500-row
    // window. Conversations appear here through their real (non-bulk)
    // activity only; bulk-only threads are served by ?action=bulk-threads.
    // Falls back to the unfiltered query until the is_bulk column exists.
    const listUrl = (excludeBulk) =>
      `${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,message,direction,created_at,status` +
      `&status=neq.deleted` +
      (excludeBulk ? '&is_bulk=not.is.true' : '') +
      `&order=created_at.desc&limit=500`;
    const listHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
    let supaRes = await fetch(listUrl(true), { headers: listHeaders });
    if (!supaRes.ok) supaRes = await fetch(listUrl(false), { headers: listHeaders });
    const rows = await supaRes.json();
    const seen = new Set();
    const contacts = (Array.isArray(rows) ? rows : []).filter(r => {
      if (r.status === 'note' || r.status === 'cancelled' || r.status === 'deleted') return false;
      if (seen.has(r.phone_number)) return false;
      seen.add(r.phone_number);
      return true;
    });
    return res.status(200).json(contacts);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=eco-comment-notify: email alert when someone leaves an "Eco
  // Comment" on a VIC Aircon job (job-tracker.html). Eco Comments have no
  // password — anyone with the tracker link can add one — so Goldsure gets an
  // email the moment it happens rather than having to keep the page open to
  // notice. The comment itself is already saved straight to Supabase by the
  // browser before this call; this endpoint only sends the notification and
  // never touches the row, so a failed/slow email can never lose or block a
  // comment. Best-effort: any failure here is caught and logged, not surfaced
  // to the person who left the comment.
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'eco-comment-notify') {
    const jobNo = String(body.job_no || '').slice(0, 40);
    const customer = String(body.customer || '').slice(0, 200);
    const address = String(body.address || '').slice(0, 300);
    const comment = String(body.comment || '').slice(0, 4000);
    if (!comment.trim()) return res.status(400).json({ error: 'comment required' });

    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const when = new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Melbourne' });
    const subjectBits = [jobNo ? `#${jobNo}` : null, customer || null].filter(Boolean).join(' — ');

    try {
      await sendHostingerMail({
        to: ['vignesh@goldsure.com.au'],
        displayName: 'Goldsure VIC Aircon Tracker',
        subject: `New Eco Comment${subjectBits ? ' — ' + subjectBits : ''}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#323338;max-width:560px">
            <p style="margin:0 0 14px">A new <strong>Eco Comment</strong> was left on the VIC Aircon Job Tracker.</p>
            <table style="border-collapse:collapse;width:100%;margin-bottom:14px">
              ${jobNo ? `<tr><td style="padding:4px 10px 4px 0;color:#676879;white-space:nowrap">Job No.</td><td style="padding:4px 0;font-weight:600">${esc(jobNo)}</td></tr>` : ''}
              ${customer ? `<tr><td style="padding:4px 10px 4px 0;color:#676879;white-space:nowrap">Customer</td><td style="padding:4px 0">${esc(customer)}</td></tr>` : ''}
              ${address ? `<tr><td style="padding:4px 10px 4px 0;color:#676879;white-space:nowrap">Address</td><td style="padding:4px 0">${esc(address)}</td></tr>` : ''}
              <tr><td style="padding:4px 10px 4px 0;color:#676879;white-space:nowrap">When</td><td style="padding:4px 0">${esc(when)}</td></tr>
            </table>
            <div style="background:#f5f6f8;border:1px solid #e6e9ef;border-radius:8px;padding:14px;white-space:pre-wrap">${esc(comment)}</div>
          </div>`,
        text: `New Eco Comment${subjectBits ? ' — ' + subjectBits : ''}\n\n` +
          (jobNo ? `Job No.: ${jobNo}\n` : '') + (customer ? `Customer: ${customer}\n` : '') +
          (address ? `Address: ${address}\n` : '') + `When: ${when}\n\n${comment}`,
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[eco-comment-notify] send failed:', err.message);
      // Still 200: the comment already saved fine, and the caller doesn't
      // retry or show an error for a notification email that didn't go out.
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=job-status-notify: email alert when a job is dragged (or edited)
  // into a different group on the VIC Aircon Job Tracker (job-tracker.html) —
  // e.g. "To Book" → "Scheduled". Same shape as eco-comment-notify: the move is
  // already saved to Supabase by the browser before this call, so this only
  // sends the email and never touches the row.
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'job-status-notify') {
    const jobNo = String(body.job_no || '').slice(0, 40);
    const customer = String(body.customer || '').slice(0, 200);
    const address = String(body.address || '').slice(0, 300);
    const fromLabel = String(body.from_label || '').slice(0, 60);
    const toLabel = String(body.to_label || '').slice(0, 60);
    if (!customer.trim() || !toLabel.trim()) return res.status(400).json({ error: 'customer and to_label required' });

    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const when = new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Melbourne' });
    const subjectBits = [jobNo ? `#${jobNo}` : null, customer || null].filter(Boolean).join(' — ');
    // A small colour per stage so the badge reads at a glance, matching the
    // board's own group colours (blue/amber/green) rather than a plain grey pill.
    const stageColor = (label) => {
      const l = label.toLowerCase();
      if (l.includes('book')) return { bg: '#e8f1ff', fg: '#1d5fd6' };
      if (l.includes('schedul')) return { bg: '#fef3e2', fg: '#b76e00' };
      if (l.includes('install')) return { bg: '#e6f7ee', fg: '#0b8b55' };
      return { bg: '#f5f6f8', fg: '#676879' };
    };
    const fromC = stageColor(fromLabel || 'to book');
    const toC = stageColor(toLabel);
    const badge = (label, c) =>
      `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${c.bg};color:${c.fg};font-weight:700;font-size:13px;white-space:nowrap">${esc(label)}</span>`;

    try {
      await sendHostingerMail({
        to: ['vignesh@goldsure.com.au'],
        displayName: 'Goldsure VIC Aircon Tracker',
        subject: `Job moved to ${toLabel}${subjectBits ? ' — ' + subjectBits : ''}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#323338;max-width:560px">
            <p style="margin:0 0 16px">
              <strong>${esc(customer)}</strong>${jobNo ? ` (#${esc(jobNo)})` : ''} was moved
              ${fromLabel ? `from ${badge(fromLabel, fromC)} ` : ''}to ${badge(toLabel, toC)}
              on the VIC Aircon Job Tracker.
            </p>
            <table style="border-collapse:collapse;width:100%">
              ${jobNo ? `<tr><td style="padding:4px 10px 4px 0;color:#676879;white-space:nowrap">Job No.</td><td style="padding:4px 0;font-weight:600">${esc(jobNo)}</td></tr>` : ''}
              <tr><td style="padding:4px 10px 4px 0;color:#676879;white-space:nowrap">Customer</td><td style="padding:4px 0">${esc(customer)}</td></tr>
              ${address ? `<tr><td style="padding:4px 10px 4px 0;color:#676879;white-space:nowrap">Address</td><td style="padding:4px 0">${esc(address)}</td></tr>` : ''}
              <tr><td style="padding:4px 10px 4px 0;color:#676879;white-space:nowrap">When</td><td style="padding:4px 0">${esc(when)}</td></tr>
            </table>
          </div>`,
        text: `${customer}${jobNo ? ` (#${jobNo})` : ''} was moved${fromLabel ? ` from ${fromLabel}` : ''} to ${toLabel} on the VIC Aircon Job Tracker.\n\n` +
          (jobNo ? `Job No.: ${jobNo}\n` : '') + `Customer: ${customer}\n` +
          (address ? `Address: ${address}\n` : '') + `When: ${when}`,
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[job-status-notify] send failed:', err.message);
      // Still 200: the move already saved fine, and the caller doesn't retry
      // or show an error for a notification email that didn't go out.
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=hws-quote: Hot Water System quote email + tracker row
  //
  // Fully self-contained and isolated. Returns early so it never touches the SMS
  // or battery-callback code below. Hosted here (rather than a new /api file) only
  // to stay within the Vercel Hobby 12-function limit — it does NOT share logic
  // with, and cannot affect, the Smoke Alarm quote system.
  //
  // Does: builds a Goldsure-branded quote email (products + Solar Victoria rebate
  // breakdown), attaches the tank-model brochure if one is uploaded, sends via
  // Resend, texts a confirmation, logs a GHL contact note, and inserts a row into
  // the `hotwater_quotes` Supabase table for the Hot Water tracker.
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'hws-quote') {
    const {
      quote_token, agent_name, customer_name, customer_email, customer_phone,
      customer_address, tank_model, line_items = [],
      notes = [],
      email_body = '', send_sms = true,
      subtotal_ex_gst = 0, gst = 0, total_inc_gst = 0,
      stc_qty = 0, stc_rate = 0, stc_total = 0,
      veec_qty = 0, veec_rate = 0, veec_total = 0,
      total_after_pos_rebates = 0, sv_delayed_rebate = 0, total_out_of_pocket = 0,
      is_reminder = false, reminder_count = 0,
    } = body;

    if (!customer_name || !customer_email || !String(customer_email).includes('@')) {
      return res.status(400).json({ error: 'Customer name and a valid email are required.' });
    }

    const token = quote_token || (globalThis.crypto?.randomUUID?.() || String(Date.now()));
    const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100)
      .toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const defaultEmailBody = 'Thank you for the opportunity to provide a quotation for your heat pump hot water system upgrade. The price shown below includes the applicable STC and Victorian Energy Upgrades discounts, with any Solar Victoria rebate shown separately. Eligibility, final system requirements and installation scope will be confirmed on site by a licensed installer.';
    const emailBodyHtml = esc(String(email_body || '').trim() || defaultEmailBody).replace(/\r?\n/g, '<br>');

    // ── Per-model brochure map. Add entries as brochure PDFs are uploaded to
    //    /assets/hotwater/. Only mapped + reachable files are attached, so a
    //    missing brochure can never fail the send. ──
    const SITE = 'https://portal.goldsure.com.au';
    const BROCHURES = {
      'ECON-300SV':       `${SITE}/assets/hotwater/ECON-300SV.pdf`,
      'EG290-FR':         `${SITE}/assets/hotwater/EG290-FR.pdf`,
      'ECON-300RVW':      `${SITE}/assets/hotwater/ECON-300RVW.pdf`,
      'ECON-300RVW-2.0E': `${SITE}/assets/hotwater/ECON-300RVW-2.0E.pdf`,
      'EG-330FRE-WR':     `${SITE}/assets/hotwater/EG-330FRE-WR.pdf`,
      // EG-300FRE-W reuses the EG-330FRE-WR datasheet; the attachment is named
      // "EG-300FRE-W Brochure.pdf" automatically (filename uses tank_model).
      'EG-300FRE-W':      `${SITE}/assets/hotwater/EG-330FRE-WR.pdf`,
    };

    // Build product line-item rows
    const itemRowsHtml = (Array.isArray(line_items) ? line_items : []).map((it) => {
      const qty = Number(it.qty) || 0, rate = Number(it.rate) || 0;
      const lineTot = Math.round((qty * rate + Number.EPSILON) * 100) / 100;
      return `<tr bgcolor="#ffffff">
        <td valign="top" style="padding:11px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;">${esc(it.name)}</td>
        <td valign="top" style="padding:11px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;">${qty}</td>
        <td valign="top" style="padding:11px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:right;">${money(rate)}</td>
        <td valign="top" style="padding:11px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#000000;text-align:right;">${money(lineTot)}</td>
      </tr>`;
    }).join('');

    const acceptUrl = `${SITE}/hotwater/accept.html?token=${encodeURIComponent(token)}`;
    const rejectUrl = `${SITE}/hotwater/reject.html?token=${encodeURIComponent(token)}`;
    const quoteDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
    const quoteNo = 'HW-' + String(token).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const preheader = `Your Goldsure hot water quote — ${money(total_out_of_pocket)} out of pocket after rebates.`;

    // Agent notes shown to the customer (optional)
    const notesList = (Array.isArray(notes) ? notes : [notes]).map(n => String(n == null ? '' : n).trim()).filter(Boolean);
    const notesHtml = notesList.length ? `
    <tr><td style="padding:18px 32px 0;font-family:${FONT};">
      <div style="border:1px solid #e3e7ef;border-radius:6px;padding:13px 16px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9aa2b1;margin-bottom:7px;">Notes</div>
        ${notesList.map(n => `<div style="font-size:13px;color:#3d4658;line-height:1.6;">• ${esc(n)}</div>`).join('')}
      </div>
    </td></tr>` : '';

    const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>Goldsure Hot Water Quotation</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#eef0f4;">${esc(preheader)}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:32px 14px 44px;">
  <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 6px 24px rgba(20,28,46,0.08);">

    <!-- Header -->
    <tr><td style="background:#000000;padding:22px 32px;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle"><img src="${SITE}/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="150" style="display:block;width:150px;height:auto;"></td>
        <td valign="middle" align="right">
          <div style="font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:5px;color:#c9a13b;">QUOTATION</div>
          <div style="font-family:${FONT};font-size:11px;color:#8b93a3;margin-top:5px;">${quoteNo} &nbsp;·&nbsp; ${quoteDate}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="height:3px;background:#b08d2e;font-size:0;line-height:0;">&nbsp;</td></tr>

    <!-- Parties -->
    <tr><td style="padding:26px 32px 8px;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" width="52%" style="font-family:${FONT};">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9aa2b1;margin-bottom:7px;">Prepared For</div>
          <div style="font-size:16px;font-weight:700;color:#141c2e;line-height:1.35;">${esc(customer_name)}</div>
          ${customer_address ? `<div style="font-size:12px;color:#5b6577;line-height:1.6;margin-top:4px;">${esc(customer_address)}</div>` : ''}
          ${customer_phone ? `<div style="font-size:12px;color:#5b6577;line-height:1.6;">${esc(customer_phone)}</div>` : ''}
          <div style="font-size:12px;color:#5b6577;line-height:1.6;">${esc(customer_email)}</div>
        </td>
        <td valign="top" width="48%" align="right" style="font-family:${FONT};">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9aa2b1;margin-bottom:7px;">From</div>
          <div style="font-size:14px;font-weight:700;color:#141c2e;">Goldsure Pty Ltd</div>
          <div style="font-size:12px;color:#5b6577;line-height:1.6;margin-top:4px;">ABN 66 683 305 106<br>Suite 4, Level 1, 293 High Street<br>Preston VIC 3072<br>info@goldsure.com.au</div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Intro -->
    <tr><td style="padding:14px 32px 4px;font-family:${FONT};">
      ${is_reminder ? `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:14px;background:#fbf6e9;border-left:3px solid #b08d2e;border-radius:0 4px 4px 0;"><tr><td style="padding:11px 14px;font-size:13px;color:#5a4a1e;line-height:1.55;"><strong style="color:#141c2e;">Just following up</strong> on the quote below — we'd be glad to help you make the switch.</td></tr></table>` : ''}
      <p style="margin:0;font-size:14px;color:#3d4658;line-height:1.65;">${emailBodyHtml}</p>
    </td></tr>

    <!-- Line items -->
    <tr><td style="padding:20px 32px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:${FONT};">
        <tr>
          <td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;">Item</td>
          <td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;text-align:center;">Qty</td>
          <td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;text-align:right;">Rate ex GST</td>
          <td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;text-align:right;">Total ex GST</td>
        </tr>
        ${itemRowsHtml}
        <tr><td colspan="3" style="padding:9px 12px;font-size:12px;color:#5b6577;text-align:right;border-bottom:1px solid #eef0f4;">Subtotal (ex GST)</td><td style="padding:9px 12px;font-size:12px;color:#141c2e;text-align:right;font-weight:600;border-bottom:1px solid #eef0f4;">${money(subtotal_ex_gst)}</td></tr>
        <tr><td colspan="3" style="padding:9px 12px;font-size:12px;color:#5b6577;text-align:right;border-bottom:1px solid #eef0f4;">GST (10%)</td><td style="padding:9px 12px;font-size:12px;color:#141c2e;text-align:right;font-weight:600;border-bottom:1px solid #eef0f4;">${money(gst)}</td></tr>
        <tr><td colspan="3" style="padding:11px 12px;font-size:12px;color:#141c2e;text-align:right;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #141c2e;">Total (inc GST)</td><td style="padding:11px 12px;font-size:14px;color:#141c2e;text-align:right;font-weight:700;border-bottom:2px solid #141c2e;">${money(total_inc_gst)}</td></tr>
      </table>
    </td></tr>

    <!-- Rebates -->
    <tr><td style="padding:18px 32px 0;font-family:${FONT};">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9aa2b1;margin-bottom:8px;padding-left:12px;">Less Rebates</div>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td style="padding:8px 12px;font-size:13px;color:#3d4658;">Small-scale Technology Certificate (STC) discount</td><td style="padding:8px 12px;font-size:13px;color:#18a96e;text-align:right;font-weight:600;">− ${money(stc_total)}</td></tr>
        <tr><td style="padding:8px 12px;font-size:13px;color:#3d4658;border-bottom:1px solid #eef0f4;">Victorian Energy Efficiency (VEEC) discount</td><td style="padding:8px 12px;font-size:13px;color:#18a96e;text-align:right;font-weight:600;border-bottom:1px solid #eef0f4;">− ${money(veec_total)}</td></tr>
        <tr><td style="padding:10px 12px;font-size:13px;color:#141c2e;font-weight:700;">Payable at point of sale</td><td style="padding:10px 12px;font-size:14px;color:#141c2e;text-align:right;font-weight:700;">${money(total_after_pos_rebates)}</td></tr>
        ${Number(sv_delayed_rebate) > 0 ? `<tr><td style="padding:8px 12px;font-size:13px;color:#3d4658;border-top:1px solid #eef0f4;">Solar Victoria rebate</td><td style="padding:8px 12px;font-size:13px;color:#18a96e;text-align:right;font-weight:600;border-top:1px solid #eef0f4;">− ${money(sv_delayed_rebate)}</td></tr>` : ''}
      </table>
    </td></tr>

    <!-- Out of pocket -->
    <tr><td style="padding:16px 32px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#000000;border-radius:6px;"><tr>
        <td style="padding:16px 20px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#c9a13b;">Your Total Out-of-Pocket</td>
        <td style="padding:16px 20px;font-family:${FONT};font-size:24px;font-weight:700;color:#ffffff;text-align:right;">${money(total_out_of_pocket)}</td>
      </tr></table>
    </td></tr>
${notesHtml}
    <!-- Accept CTA -->
    <tr><td align="center" style="padding:26px 32px 6px;font-family:${FONT};">
      <div style="font-size:13px;color:#3d4658;line-height:1.6;margin-bottom:16px;">Happy to go ahead? Accept your quote online and our team will call to book your installation.</div>
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${acceptUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="16%" stroke="f" fillcolor="#b08d2e"><w:anchorlock/><center style="color:#141c2e;font-family:${FONT};font-size:15px;font-weight:700;">Accept This Quote</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${acceptUrl}" style="display:inline-block;background:#b08d2e;color:#141c2e;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:15px 40px;border-radius:8px;">Accept This Quote</a><!--<![endif]-->
      <div style="font-size:11px;color:#9aa2b1;margin-top:14px;">This quote is valid for 21 days from ${quoteDate}.</div>
      ${is_reminder ? `<div style="font-size:13px;color:#3d4658;line-height:1.6;margin:20px 0 12px;">Not going ahead? Let us know so we can close it off.</div>
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${rejectUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="16%" strokecolor="#c9ccd3" fillcolor="#ffffff"><w:anchorlock/><center style="color:#5b6577;font-family:${FONT};font-size:15px;font-weight:700;">Reject This Quote</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${rejectUrl}" style="display:inline-block;background:#ffffff;color:#5b6577;border:1px solid #c9ccd3;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:8px;">Reject This Quote</a><!--<![endif]-->` : ''}
    </td></tr>

    <!-- Notes -->
    <tr><td style="padding:22px 32px 0;font-family:${FONT};">
      <p style="margin:0;font-size:10px;color:#aeb4c0;line-height:1.6;">This is not a tax invoice. This quotation is an estimate based on the information provided and is subject to on-site assessment. Rebate eligibility is subject to Solar Victoria and scheme approval. A tax invoice is issued once products are installed and services rendered. All products carry a minimum 1-year warranty.</p>
    </td></tr>

    <!-- Signature -->
    <tr><td style="padding:20px 32px 24px;font-family:${FONT};">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;"><tr>
        <td valign="middle" style="padding:16px 16px 0 0;width:118px;"><img src="${SITE}/assets/goldsure-logo.jpg" alt="Goldsure" width="108" style="display:block;width:108px;height:auto;"></td>
        <td valign="middle" style="padding:16px 0 0 16px;border-left:2px solid #b08d2e;">
          <div style="font-size:15px;font-weight:700;color:#141c2e;">${esc(agent_name || 'The Goldsure Team')}</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#b08d2e;margin-top:2px;">Goldsure Pty Ltd</div>
          <div style="font-size:12px;color:#5b6577;line-height:1.85;margin-top:6px;">e: <a href="mailto:info@goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:600;">info@goldsure.com.au</a><br>p: <a href="tel:0370502846" style="color:#5b6577;text-decoration:none;font-weight:600;">03 7050 2846</a><br>w: <a href="https://www.goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:600;">www.goldsure.com.au</a></div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Footer -->
    <tr><td align="center" style="background:#000000;padding:16px 20px;font-family:${FONT};">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#c9a13b;margin-bottom:3px;">Goldsure Pty Ltd</div>
      <div style="font-size:10px;color:#8b93a3;line-height:1.5;">ABN 66 683 305 106 &nbsp;·&nbsp; Suite 4, Level 1, 293 High Street, Preston VIC 3072</div>
    </td></tr>
  </table>
</td></tr></table></body></html>`;

    // ── Attach the tank-model brochure if uploaded + reachable (best-effort) ──
    const attachments = [];
    const brochureUrl = BROCHURES[tank_model];
    if (brochureUrl) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const bRes = await fetch(brochureUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (bRes.ok) {
          const buf = Buffer.from(await bRes.arrayBuffer());
          attachments.push({ filename: `${tank_model} Brochure.pdf`, content: buf.toString('base64'), contentType: 'application/pdf' });
        } else {
          console.warn('[HWS] brochure not reachable, sending without it:', brochureUrl, bRes.status);
        }
      } catch (e) {
        console.warn('[HWS] brochure fetch failed, sending without it:', e.message);
      }
    }

    // Reminders go only to the customer; new quotes BCC info@ only.
    const hwsBcc = ['info@goldsure.com.au'];
    const hwsSubject = is_reminder ? 'Reminder: Your Hot Water System Quote – Goldsure' : 'Your Hot Water System Quote – Goldsure';

    // ── Send via Hostinger (from info@goldsure.com.au); fall back to Resend so a
    //    provider hiccup never loses a quote. ──
    let emailSuccess = false;
    try {
      await sendHostingerMail({
        to: [customer_email],
        ...(is_reminder ? {} : { bcc: hwsBcc }),
        displayName: 'Goldsure Pty Ltd',
        subject: hwsSubject,
        html,
        ...(attachments.length ? { attachments } : {}),
      });
      emailSuccess = true;
    } catch (hostErr) {
      console.error('[HWS] Hostinger send failed, falling back to Resend:', hostErr.message);
    }
    if (!emailSuccess) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Goldsure Pty Ltd <info@goldsure.com.au>',
            to: [customer_email],
            ...(is_reminder ? {} : { bcc: hwsBcc }),
            subject: hwsSubject,
            html,
            ...(attachments.length ? { attachments } : {}),
          }),
        });
        if (!r.ok) {
          const detail = await r.text();
          console.error('[HWS] Resend failed:', r.status, detail);
          return res.status(500).json({ error: 'Failed to send email.', detail: detail.slice(0, 300) });
        }
        emailSuccess = true;
      } catch (e) {
        console.error('[HWS] Resend error:', e.message);
        return res.status(500).json({ error: 'Internal error sending email.' });
      }
    }

    // ── Confirmation SMS (best-effort, non-fatal) ──
    let smsSent = false;
    if (emailSuccess && send_sms !== false && customer_phone) {
      try {
        const smsPhone = normalizeAuPhone(customer_phone);
        const smsUser = process.env.SMSGATE_USERNAME, smsPass = process.env.SMSGATE_PASSWORD;
        if (smsUser && smsPass && !(await isOptedOut(smsPhone))) {
          const agentFirst = String(agent_name || 'Goldsure').trim().split(/\s+/)[0] || 'Goldsure';
          const custFirst = String(customer_name || 'there').trim().split(/\s+/)[0] || 'there';
          const customSms = (typeof body.sms_text === 'string' && body.sms_text.trim()) ? body.sms_text.trim() : null;
          const smsText = customSms
            ? customSms
            : is_reminder
            ? `Hi ${custFirst}, this is ${agentFirst} from Goldsure. We recently emailed your quote for the ${tank_model || 'heat pump hot water system'} to ${customer_email}. If you are happy to proceed, click Accept on your quote and we will give you a call to arrange the next steps. Otherwise, please reply YES or NO to let us know how you would like to proceed. Thank you.`
            : `Hi ${custFirst}, ${agentFirst} from Goldsure here. Your quote for the ${tank_model || 'heat pump hot water system'} has been emailed to ${customer_email}. Your out-of-pocket cost is ${money(total_out_of_pocket)}, provided you are eligible for the applicable rebates. Please check your inbox and spam/junk folder. Questions? Reply here or call 03 7050 2846. Thanks!`;
          const creds = Buffer.from(`${smsUser}:${smsPass}`).toString('base64');
          const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
            method: 'POST',
            headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumbers: [smsPhone], textMessage: { text: smsText }, ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}) }),
          });
          if (smsRes.ok) {
            smsSent = true;
            const smsData = await smsRes.json().catch(() => ({}));
            fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
              method: 'POST',
              headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ phone_number: smsPhone, message: smsText, direction: 'outbound', status: 'sent', sms_gate_id: smsData.id || null }),
            }).catch(() => {});
          }
        }
      } catch (e) { console.warn('[HWS] confirmation SMS failed (non-fatal):', e.message); }
    }

    // ── Log a note on the GHL contact (best-effort, non-fatal) ──
    if (emailSuccess) {
      try {
        const apiKey = process.env.GHL_API_KEY, locationId = process.env.GHL_LOCATION_ID;
        if (apiKey && locationId) {
          const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
          const cRes = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(customer_email)}&limit=5`, { headers: hdrs });
          const cData = await cRes.json().catch(() => ({}));
          const contacts = cData.contacts || [];
          const contact = contacts.find(c => (c.email || '').toLowerCase() === String(customer_email).toLowerCase()) || contacts[0];
          if (contact?.id) {
            let noteBody;
            if (is_reminder) {
              const reminderNo = (Number(reminder_count) || 0) + 1;
              const dateStr = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short', year: 'numeric' });
              noteBody = `Reminder sent\nReminder no: ${reminderNo}\nDate: ${dateStr}`;
            } else {
              const modelLabel = (Array.isArray(line_items) && line_items[0] && line_items[0].name) ? String(line_items[0].name) : '';
              noteBody = `Hot Water quote sent by ${agent_name || 'Goldsure'}\nTank model: ${tank_model || '—'}${modelLabel ? ` (${modelLabel})` : ''}\nCustomer type: ${Number(sv_delayed_rebate) > 0 ? 'Solar Victoria (SV) customer' : 'Non-SV customer'}\nOut-of-pocket: ${money(total_out_of_pocket)}`;
            }
            await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contact.id)}/notes`, {
              method: 'POST', headers: { ...hdrs, 'Content-Type': 'application/json' },
              body: JSON.stringify({ body: noteBody }),
            });
            // Move their opportunity to "Quote Sent" — first send only, never on a
            // reminder (a reminder must not drag a progressed deal backwards).
            if (!is_reminder) {
              const mv = await moveContactToStage({
                contactId: contact.id,
                stageNames: [process.env.HWS_QUOTE_SENT_STAGE_NAME || 'Quote Sent', 'Quote Sent', 'Quoted', 'Quote'],
                pipelineIdEnv: process.env.HWS_PIPELINE_ID || '',
                stageIdEnv: process.env.HWS_QUOTE_SENT_STAGE_ID || '',
              });
              if (!mv.moved) console.warn('[HWS] stage move skipped:', mv.reason);
            }
          }
        }
      } catch (e) { console.warn('[HWS] GHL note failed (non-fatal):', e.message); }
    }

    // ── Reminder: bump the existing row instead of inserting a new one ──
    if (emailSuccess && is_reminder) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/hotwater_quotes?quote_token=eq.${encodeURIComponent(token)}`, {
          method: 'PATCH',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ reminder_count: (Number(reminder_count) || 0) + 1, last_reminder_sent_at: new Date().toISOString() }),
        });
      } catch (e) { console.error('[HWS] reminder update error (non-fatal):', e.message); }
      return res.status(200).json({ success: true, sms_sent: smsSent, reminder_count: (Number(reminder_count) || 0) + 1, last_reminder_sent_at: new Date().toISOString() });
    }

    // ── Log the quote to the hotwater_quotes tracker table (non-fatal) ──
    if (emailSuccess) {
      try {
        const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/hotwater_quotes`, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            quote_token: token,
            agent_name: agent_name || null,
            customer_name: customer_name || null,
            customer_email: customer_email || null,
            customer_phone: customer_phone || null,
            customer_address: customer_address || null,
            tank_model: tank_model || null,
            line_items: Array.isArray(line_items) ? line_items : [],
            subtotal_ex_gst: Number(subtotal_ex_gst) || 0,
            gst: Number(gst) || 0,
            total_inc_gst: Number(total_inc_gst) || 0,
            stc_qty: Number(stc_qty) || 0, stc_rate: Number(stc_rate) || 0, stc_total: Number(stc_total) || 0,
            veec_qty: Number(veec_qty) || 0, veec_rate: Number(veec_rate) || 0, veec_total: Number(veec_total) || 0,
            total_after_pos_rebates: Number(total_after_pos_rebates) || 0,
            sv_delayed_rebate: Number(sv_delayed_rebate) || 0,
            total_out_of_pocket: Number(total_out_of_pocket) || 0,
            status: 'sent',
            accepted: false,
            reminder_count: 0,
            sent_at: new Date().toISOString(),
          }),
        });
        if (!supaRes.ok) console.error('[HWS] Supabase insert failed:', supaRes.status, (await supaRes.text()).slice(0, 300));
      } catch (e) { console.error('[HWS] Supabase insert error (non-fatal):', e.message); }
    }

    return res.status(200).json({ success: true, sms_sent: smsSent, brochure_attached: attachments.length > 0 });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=hws-accept: internal "quote accepted" notification email
  //
  // Fired by /hotwater/accept.html when a customer accepts their quote. Emails
  // info@goldsure.com.au so the team can follow up and book the installation.
  // Isolated + early-return; touches nothing else. (Smoke Alarms uses its own
  // /api/smoke-alarms/accept — this is the Hot Water equivalent, hosted here to
  // stay within the 12-function limit.)
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'hws-accept') {
    const {
      customer_name, customer_email, customer_phone, customer_address,
      agent_name, tank_model, total_inc_gst = 0, total_after_pos_rebates = 0,
      sv_delayed_rebate = 0, total_out_of_pocket = 0, accepted_at,
    } = body;
    if (!customer_name || !customer_email) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100)
      .toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const acceptedDisplay = accepted_at
      ? new Date(accepted_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' })
      : new Date().toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' });

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Hot Water Quote Accepted</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;font-family:${FONT};color:#141c2e;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:36px 16px 48px;">
  <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#000000;padding:20px 28px;border-radius:6px 6px 0 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle"><img src="https://portal.goldsure.com.au/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="130" style="display:block;width:130px;height:auto;"></td>
        <td align="right" valign="middle"><span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c9a13b;">Internal · Hot Water</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="height:3px;background:#18a96e;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;padding:28px 28px 32px;border-radius:0 0 6px 6px;border:1px solid #e3e7ef;border-top:none;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr>
        <td><p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#18a96e;">Quote Accepted</p>
          <p style="margin:0;font-size:22px;font-weight:700;color:#141c2e;line-height:1.2;">${esc(customer_name)}</p></td>
        <td align="right" valign="top"><p style="margin:0;font-size:11px;color:#6b7899;">${esc(acceptedDisplay)}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#6b7899;">Agent: <strong style="color:#141c2e;">${esc(agent_name || '—')}</strong></p></td>
      </tr></table>

      <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Customer Details</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;border:1px solid #e3e7ef;border-radius:4px;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;width:32%;background:#f7f8fa;font-size:11px;color:#6b7899;">Email</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;"><a href="mailto:${esc(customer_email)}" style="color:#b08d2e;text-decoration:none;font-weight:600;">${esc(customer_email)}</a></td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Phone</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${esc(customer_phone || '—')}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Address</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;">${esc(customer_address || '—')}</td></tr>
        <tr><td style="padding:10px 14px;background:#f7f8fa;font-size:11px;color:#6b7899;">Tank Model</td><td style="padding:10px 14px;font-size:13px;font-weight:600;">${esc(tank_model || '—')}</td></tr>
      </table>

      <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Quote Summary</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;border:1px solid #e3e7ef;border-radius:4px;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Total (inc GST)</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${money(total_inc_gst)}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Payable at point of sale</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${money(total_after_pos_rebates)}</td></tr>
        ${Number(sv_delayed_rebate) > 0 ? `<tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Solar Victoria rebate (delayed)</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;color:#18a96e;">− ${money(sv_delayed_rebate)}</td></tr>` : ''}
        <tr style="background:#000000;"><td style="padding:14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,0.6);">Out-of-Pocket</td><td align="right" style="padding:14px;font-size:18px;font-weight:700;color:#c9a13b;">${money(total_out_of_pocket)}</td></tr>
      </table>

      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 16px;background:#eaf7f2;border-left:3px solid #18a96e;border-radius:0 4px 4px 0;">
        <p style="margin:0;font-size:13px;color:#0d7a4f;line-height:1.6;"><strong style="color:#141c2e;">Next step:</strong> Call ${esc(customer_name.split(' ')[0])} to confirm the installation date and complete the booking.</p>
      </td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:20px 0 0;">
      <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6b7899;">Goldsure Pty Ltd</p>
      <p style="margin:0;font-size:11px;color:#9aa5b8;">ABN 66 683 305 106 &nbsp;·&nbsp; Preston VIC 3072</p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;

    const acceptSubject = `Hot Water Quote Accepted – ${customer_name} – ${money(total_out_of_pocket)}`;
    // Notify the team via Hostinger (from info@); fall back to Resend.
    let acceptSent = false;
    try {
      await sendHostingerMail({ to: ['info@goldsure.com.au'], displayName: 'Goldsure Quotes', subject: acceptSubject, html });
      acceptSent = true;
    } catch (hostErr) {
      console.error('[HWS accept] Hostinger failed, falling back to Resend:', hostErr.message);
    }
    if (!acceptSent) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Goldsure Quotes <info@goldsure.com.au>',
            to: ['info@goldsure.com.au'],
            subject: acceptSubject,
            html,
          }),
        });
        if (!r.ok) {
          const detail = await r.text();
          console.error('[HWS accept] Resend failed:', r.status, detail);
          return res.status(500).json({ error: 'Failed to send notification.', detail: detail.slice(0, 200) });
        }
      } catch (e) {
        console.error('[HWS accept] error:', e.message);
        return res.status(500).json({ error: 'Internal error.' });
      }
    }
    return res.status(200).json({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=hws-reject: internal "quote declined" notification email
  // Fired by /hotwater/reject.html when a customer declines their quote.
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'hws-reject') {
    const {
      customer_name, customer_email, customer_phone, customer_address,
      agent_name, tank_model, total_out_of_pocket = 0, rejected_at,
    } = body;
    if (!customer_name || !customer_email) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100)
      .toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const rejectedDisplay = new Date(rejected_at || Date.now())
      .toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' });

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Hot Water Quote Declined</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;font-family:${FONT};color:#141c2e;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:36px 16px 48px;">
  <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#000000;padding:20px 28px;border-radius:6px 6px 0 0;"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="https://portal.goldsure.com.au/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="130" style="display:block;width:130px;height:auto;"></td><td align="right" valign="middle"><span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c9a13b;">Internal · Hot Water</span></td></tr></table></td></tr>
    <tr><td style="height:3px;background:#e04f4f;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;padding:28px 28px 32px;border-radius:0 0 6px 6px;border:1px solid #e3e7ef;border-top:none;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr><td><p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#e04f4f;">Quote Declined</p><p style="margin:0;font-size:22px;font-weight:700;color:#141c2e;line-height:1.2;">${esc(customer_name)}</p></td><td align="right" valign="top"><p style="margin:0;font-size:11px;color:#6b7899;">${esc(rejectedDisplay)}</p><p style="margin:4px 0 0;font-size:11px;color:#6b7899;">Agent: <strong style="color:#141c2e;">${esc(agent_name || '—')}</strong></p></td></tr></table>
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Customer Details</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;border:1px solid #e3e7ef;border-radius:4px;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;width:32%;background:#f7f8fa;font-size:11px;color:#6b7899;">Email</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;"><a href="mailto:${esc(customer_email)}" style="color:#b08d2e;text-decoration:none;font-weight:600;">${esc(customer_email)}</a></td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Phone</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${esc(customer_phone || '—')}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Address</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;">${esc(customer_address || '—')}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Tank Model</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${esc(tank_model || '—')}</td></tr>
        <tr><td style="padding:10px 14px;background:#f7f8fa;font-size:11px;color:#6b7899;">Out-of-Pocket</td><td style="padding:10px 14px;font-size:13px;font-weight:600;">${money(total_out_of_pocket)}</td></tr>
      </table>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 16px;background:#fdecec;border-left:3px solid #e04f4f;border-radius:0 4px 4px 0;"><p style="margin:0;font-size:13px;color:#a03636;line-height:1.6;"><strong style="color:#141c2e;">Heads up:</strong> ${esc(String(customer_name).split(' ')[0])} declined this quote online. No further reminders will be sent.</p></td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:20px 0 0;"><p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6b7899;">Goldsure Pty Ltd</p><p style="margin:0;font-size:11px;color:#9aa5b8;">ABN 66 683 305 106 &nbsp;·&nbsp; Preston VIC 3072</p></td></tr>
  </table>
</td></tr></table></body></html>`;

    const rejectSubject = `Hot Water Quote Declined – ${customer_name}`;
    let rejectSent = false;
    try {
      await sendHostingerMail({ to: ['info@goldsure.com.au'], displayName: 'Goldsure Quotes', subject: rejectSubject, html });
      rejectSent = true;
    } catch (hostErr) {
      console.error('[HWS reject] Hostinger failed, falling back to Resend:', hostErr.message);
    }
    if (!rejectSent) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Goldsure Quotes <info@goldsure.com.au>',
            to: ['info@goldsure.com.au'],
            subject: rejectSubject,
            html,
          }),
        });
        if (!r.ok) {
          const detail = await r.text();
          console.error('[HWS reject] Resend failed:', r.status, detail);
          return res.status(500).json({ error: 'Failed to send notification.', detail: detail.slice(0, 200) });
        }
      } catch (e) {
        console.error('[HWS reject] error:', e.message);
        return res.status(500).json({ error: 'Internal error.' });
      }
    }
    return res.status(200).json({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=aircon-quote: Aircon (multi-split VRF) quote email + tracker row
  //
  // Same isolated, early-return pattern as the Hot Water branch. Builds a
  // Goldsure-branded Xero-style quote (line items, VEU/VEEC discount, GST,
  // out-of-pocket), attaches the brochure if one is uploaded, sends via Resend,
  // texts a confirmation, logs a GHL note, and inserts into `aircon_quotes`.
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'aircon-quote') {
    const {
      quote_token, agent_name, customer_name, customer_email, customer_phone, customer_address,
      line_items = [], veec_discount = 0,
      email_body = '', send_sms = true,
      products_ex_gst = 0, total_gst = 0, products_inc_gst = 0,
      subtotal = 0, total_out_of_pocket = 0,
      is_reminder = false, reminder_count = 0,
    } = body;

    if (!customer_name || !customer_email || !String(customer_email).includes('@')) {
      return res.status(400).json({ error: 'Customer name and a valid email are required.' });
    }

    const token = quote_token || (globalThis.crypto?.randomUUID?.() || String(Date.now()));
    const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100)
      .toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const defaultEmailBody = 'Thank you for the opportunity to provide a quotation for your air conditioning upgrade. The price shown below includes the applicable Victorian Energy Upgrades (VEU) discount. Eligibility, final system requirements and installation scope will be confirmed on site by a licensed installer.';
    const emailBodyHtml = esc(String(email_body || '').trim() || defaultEmailBody).replace(/\r?\n/g, '<br>');

    const SITE = 'https://portal.goldsure.com.au';
    const BROCHURES = {
      aux: `${SITE}/assets/aircons/Brochure.pdf`,
    };
    const acceptUrl = `${SITE}/aircons/accept.html?token=${encodeURIComponent(token)}`;
    const rejectUrl = `${SITE}/aircons/reject.html?token=${encodeURIComponent(token)}`;
    const quoteDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
    const quoteNo = 'AC-' + String(token).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

    const itemRowsHtml = (Array.isArray(line_items) ? line_items : []).map((it) => {
      const qty = Number(it.qty) || 0, unit = Number(it.unit) || 0, amount = Number(it.amount) || 0;
      return `<tr>
        <td style="padding:11px 12px;font-family:${FONT};font-size:13px;color:#141c2e;">${esc(it.name)}<br><span style="font-size:11px;color:#9aa2b1;">${qty} × ${money(unit)} ex GST</span></td>
        <td style="padding:11px 12px;font-family:${FONT};font-size:13px;color:#141c2e;text-align:right;font-weight:600;">${money(amount)}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Goldsure Aircon Quotation</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#eef0f4;">Your Goldsure air conditioning quote — ${money(total_out_of_pocket)} out of pocket after the VEU discount.</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:32px 14px 44px;">
  <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 6px 24px rgba(20,28,46,0.08);">
    <tr><td style="background:#000000;padding:22px 32px;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle"><img src="${SITE}/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="150" style="display:block;width:150px;height:auto;"></td>
        <td valign="middle" align="right"><div style="font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:5px;color:#c9a13b;">QUOTATION</div><div style="font-family:${FONT};font-size:11px;color:#8b93a3;margin-top:5px;">${quoteNo} &nbsp;·&nbsp; ${quoteDate}</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="height:3px;background:#b08d2e;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:26px 32px 8px;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" width="52%" style="font-family:${FONT};"><div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9aa2b1;margin-bottom:7px;">Prepared For</div><div style="font-size:16px;font-weight:700;color:#141c2e;line-height:1.35;">${esc(customer_name)}</div>${customer_address ? `<div style="font-size:12px;color:#5b6577;line-height:1.6;margin-top:4px;">${esc(customer_address)}</div>` : ''}${customer_phone ? `<div style="font-size:12px;color:#5b6577;line-height:1.6;">${esc(customer_phone)}</div>` : ''}<div style="font-size:12px;color:#5b6577;line-height:1.6;">${esc(customer_email)}</div></td>
        <td valign="top" width="48%" align="right" style="font-family:${FONT};"><div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9aa2b1;margin-bottom:7px;">From</div><div style="font-size:14px;font-weight:700;color:#141c2e;">Goldsure Pty Ltd</div><div style="font-size:12px;color:#5b6577;line-height:1.6;margin-top:4px;">ABN 66 683 305 106<br>Suite 4, 293 High St<br>Preston VIC 3072<br>info@goldsure.com.au</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:14px 32px 4px;font-family:${FONT};">
      ${is_reminder ? `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:14px;background:#fbf6e9;border-left:3px solid #b08d2e;border-radius:0 4px 4px 0;"><tr><td style="padding:11px 14px;font-size:13px;color:#5a4a1e;line-height:1.55;"><strong style="color:#141c2e;">Just following up</strong> on the quote below.</td></tr></table>` : ''}
      <p style="margin:0;font-size:14px;color:#3d4658;line-height:1.65;">${emailBodyHtml}</p>
    </td></tr>
    <tr><td style="padding:18px 32px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr><td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;">Description</td><td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;text-align:right;">Amount</td></tr>
        ${itemRowsHtml}
        <tr><td style="padding:9px 12px;font-family:${FONT};font-size:12px;color:#5b6577;text-align:right;">Subtotal before rebate (ex GST)</td><td style="padding:9px 12px;font-family:${FONT};font-size:12px;color:#141c2e;text-align:right;font-weight:600;">${money(products_ex_gst)}</td></tr>
        <tr><td style="padding:9px 12px;font-family:${FONT};font-size:12px;color:#5b6577;text-align:right;">GST 10%</td><td style="padding:9px 12px;font-family:${FONT};font-size:12px;color:#141c2e;text-align:right;font-weight:600;">${money(total_gst)}</td></tr>
        <tr><td style="padding:9px 12px;font-family:${FONT};font-size:12px;color:#141c2e;text-align:right;font-weight:700;border-top:1px solid #dfe3ea;">Total before rebate (inc GST)</td><td style="padding:9px 12px;font-family:${FONT};font-size:12px;color:#141c2e;text-align:right;font-weight:700;border-top:1px solid #dfe3ea;">${money(products_inc_gst)}</td></tr>
        <tr><td style="padding:10px 12px;font-family:${FONT};font-size:13px;color:#2f9e6b;border-bottom:2px solid #141c2e;">Victorian Energy Efficiency Target Discount<br><span style="font-size:11px;color:#9aa2b1;">Victorian Energy Upgrades (VEU)</span></td><td style="padding:10px 12px;font-family:${FONT};font-size:13px;color:#2f9e6b;text-align:right;font-weight:600;border-bottom:2px solid #141c2e;">− ${money(veec_discount)}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 32px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#000000;border-radius:6px;"><tr>
        <td style="padding:16px 20px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#c9a13b;">Total Out-of-Pocket (AUD)</td>
        <td style="padding:16px 20px;font-family:${FONT};font-size:24px;font-weight:700;color:#ffffff;text-align:right;">${money(total_out_of_pocket)}</td>
      </tr></table>
    </td></tr>
    <tr><td align="center" style="padding:26px 32px 6px;font-family:${FONT};">
      <div style="font-size:13px;color:#3d4658;line-height:1.6;margin-bottom:16px;">Happy to go ahead? Accept your quote online and our team will call to book your installation.</div>
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${acceptUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="16%" stroke="f" fillcolor="#b08d2e"><w:anchorlock/><center style="color:#141c2e;font-family:${FONT};font-size:15px;font-weight:700;">Accept This Quote</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${acceptUrl}" style="display:inline-block;background:#b08d2e;color:#141c2e;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:15px 40px;border-radius:8px;">Accept This Quote</a><!--<![endif]-->
      <div style="font-size:11px;color:#9aa2b1;margin-top:14px;">This quote is valid for 21 days from ${quoteDate}.</div>
      ${is_reminder ? `<div style="font-size:13px;color:#3d4658;line-height:1.6;margin:20px 0 12px;">Not going ahead? Let us know so we can close it off.</div>
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${rejectUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="16%" strokecolor="#c9ccd3" fillcolor="#ffffff"><w:anchorlock/><center style="color:#5b6577;font-family:${FONT};font-size:15px;font-weight:700;">Reject This Quote</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${rejectUrl}" style="display:inline-block;background:#ffffff;color:#5b6577;border:1px solid #c9ccd3;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:8px;">Reject This Quote</a><!--<![endif]-->` : ''}
    </td></tr>
    <tr><td style="padding:22px 32px 0;font-family:${FONT};">
      <p style="margin:0;font-size:10px;color:#aeb4c0;line-height:1.6;">This document is a quotation only. The value of the Victorian Energy Upgrades (VEU) discount may vary at the time of installation or certificate processing. However, the final out-of-pocket price of ${money(total_out_of_pocket)} is fixed for the equipment and scope quoted, subject to site conditions remaining as assessed and no additional works being required. This is not a tax invoice; a tax invoice is issued once installed.</p>
    </td></tr>
    <tr><td style="padding:20px 32px 24px;font-family:${FONT};">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;"><tr>
        <td valign="middle" style="padding:16px 16px 0 0;width:118px;"><img src="${SITE}/assets/goldsure-logo.jpg" alt="Goldsure" width="108" style="display:block;width:108px;height:auto;"></td>
        <td valign="middle" style="padding:16px 0 0 16px;border-left:2px solid #b08d2e;">
          <div style="font-size:15px;font-weight:700;color:#141c2e;">${esc(agent_name || 'The Goldsure Team')}</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#b08d2e;margin-top:2px;">Goldsure Pty Ltd</div>
          <div style="font-size:12px;color:#5b6577;line-height:1.85;margin-top:6px;">e: <a href="mailto:info@goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:600;">info@goldsure.com.au</a><br>p: <a href="tel:0370502846" style="color:#5b6577;text-decoration:none;font-weight:600;">03 7050 2846</a><br>w: <a href="https://www.goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:600;">www.goldsure.com.au</a></div>
        </td></tr></table>
    </td></tr>
    <tr><td align="center" style="background:#000000;padding:16px 20px;font-family:${FONT};"><div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#c9a13b;margin-bottom:3px;">Goldsure Pty Ltd</div><div style="font-size:10px;color:#8b93a3;line-height:1.5;">ABN 66 683 305 106 &nbsp;·&nbsp; Suite 4, 293 High St, Preston VIC 3072</div></td></tr>
  </table>
</td></tr></table></body></html>`;

    // Attach brochure if mapped + reachable (best-effort)
    const attachments = [];
    const brochureUrl = BROCHURES.aux;
    if (brochureUrl) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const bRes = await fetch(brochureUrl, { signal: ctrl.signal });
        clearTimeout(timer);
        if (bRes.ok) attachments.push({ filename: 'Aircon Brochure.pdf', content: Buffer.from(await bRes.arrayBuffer()).toString('base64'), contentType: 'application/pdf' });
      } catch (e) { console.warn('[Aircon] brochure fetch failed:', e.message); }
    }

    // Reminders go only to the customer; new quotes BCC info@ only.
    const acBcc = ['info@goldsure.com.au'];
    const acSubject = is_reminder ? 'Reminder: Your Air Conditioning Quote – Goldsure' : 'Your Air Conditioning Quote – Goldsure';

    // Send via Hostinger (from info@); fall back to Resend so a quote is never lost.
    let emailSuccess = false;
    try {
      await sendHostingerMail({
        to: [customer_email],
        ...(is_reminder ? {} : { bcc: acBcc }),
        displayName: 'Goldsure Pty Ltd',
        subject: acSubject,
        html,
        ...(attachments.length ? { attachments } : {}),
      });
      emailSuccess = true;
    } catch (hostErr) {
      console.error('[Aircon] Hostinger send failed, falling back to Resend:', hostErr.message);
    }
    if (!emailSuccess) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Goldsure Pty Ltd <info@goldsure.com.au>',
            to: [customer_email],
            ...(is_reminder ? {} : { bcc: acBcc }),
            subject: acSubject,
            html,
            ...(attachments.length ? { attachments } : {}),
          }),
        });
        if (!r.ok) { const detail = await r.text(); console.error('[Aircon] Resend failed:', r.status, detail); return res.status(500).json({ error: 'Failed to send email.', detail: detail.slice(0, 300) }); }
        emailSuccess = true;
      } catch (e) { console.error('[Aircon] Resend error:', e.message); return res.status(500).json({ error: 'Internal error sending email.' }); }
    }

    // Confirmation SMS (best-effort)
    let smsSent = false;
    if (emailSuccess && send_sms !== false && customer_phone) {
      try {
        const smsPhone = normalizeAuPhone(customer_phone);
        const smsUser = process.env.SMSGATE_USERNAME, smsPass = process.env.SMSGATE_PASSWORD;
        if (smsUser && smsPass && !(await isOptedOut(smsPhone))) {
          const agentFirst = String(agent_name || 'Goldsure').trim().split(/\s+/)[0] || 'Goldsure';
          const custFirst = String(customer_name || 'there').trim().split(/\s+/)[0] || 'there';
          const customSms = (typeof body.sms_text === 'string' && body.sms_text.trim()) ? body.sms_text.trim() : null;
          const smsText = customSms
            ? customSms
            : is_reminder
            ? `Hi ${custFirst}, this is ${agentFirst} from Goldsure. We recently emailed your air conditioning quote to ${customer_email}. If you are happy to proceed, click Accept on your quote and we will give you a call to arrange the next steps. Otherwise, please reply YES or NO to let us know how you would like to proceed. Thank you.`
            : `Hi ${custFirst}, ${agentFirst} from Goldsure here. Your air conditioning quote has been emailed to ${customer_email}. Your out-of-pocket cost is ${money(total_out_of_pocket)}, provided you are eligible for the applicable rebates. Please check your inbox and spam/junk folder. Questions? Reply here or call 03 7050 2846. Thanks!`;
          const creds = Buffer.from(`${smsUser}:${smsPass}`).toString('base64');
          const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
            method: 'POST', headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumbers: [smsPhone], textMessage: { text: smsText }, ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}) }),
          });
          if (smsRes.ok) {
            smsSent = true;
            const smsData = await smsRes.json().catch(() => ({}));
            fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ phone_number: smsPhone, message: smsText, direction: 'outbound', status: 'sent', sms_gate_id: smsData.id || null }) }).catch(() => {});
          }
        }
      } catch (e) { console.warn('[Aircon] confirmation SMS failed:', e.message); }
    }

    // GHL note (best-effort)
    if (emailSuccess) {
      try {
        const apiKey = process.env.GHL_API_KEY, locationId = process.env.GHL_LOCATION_ID;
        if (apiKey && locationId) {
          const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
          const cRes = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(customer_email)}&limit=5`, { headers: hdrs });
          const cData = await cRes.json().catch(() => ({}));
          const contacts = cData.contacts || [];
          const contact = contacts.find(c => (c.email || '').toLowerCase() === String(customer_email).toLowerCase()) || contacts[0];
          if (contact?.id) {
            let noteBody;
            if (is_reminder) {
              const reminderNo = (Number(reminder_count) || 0) + 1;
              const dateStr = new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short', year: 'numeric' });
              noteBody = `Reminder sent\nReminder no: ${reminderNo}\nDate: ${dateStr}`;
            } else {
              const items = Array.isArray(line_items) ? line_items : [];
              const unitCount = items.reduce((s, l) => s + (Number(l.qty) || 0), 0);
              const breakdown = items.map(l => `  • ${Number(l.qty) || 0} × ${l.name}`).join('\n') || '  • (no line items)';
              noteBody = `Aircon quote sent by ${agent_name || 'Goldsure'}\nSystem (${unitCount} unit${unitCount === 1 ? '' : 's'}):\n${breakdown}\nVEEC discount: ${money(veec_discount)}\nOut-of-pocket: ${money(total_out_of_pocket)}`;
            }
            await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contact.id)}/notes`, { method: 'POST', headers: { ...hdrs, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: noteBody }) });
            // Move their opportunity to "Quote Sent" — first send only, never on a
            // reminder (a reminder must not drag a progressed deal backwards).
            if (!is_reminder) {
              const mv = await moveContactToStage({
                contactId: contact.id,
                stageNames: [process.env.AIRCON_QUOTE_SENT_STAGE_NAME || 'Quote Sent', 'Quote Sent', 'Quoted', 'Quote'],
                pipelineIdEnv: process.env.AIRCON_PIPELINE_ID || '',
                stageIdEnv: process.env.AIRCON_QUOTE_SENT_STAGE_ID || '',
              });
              if (!mv.moved) console.warn('[Aircon] stage move skipped:', mv.reason);
            }
          }
        }
      } catch (e) { console.warn('[Aircon] GHL note failed:', e.message); }
    }

    // Reminder → bump existing row; else insert
    if (emailSuccess && is_reminder) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/aircon_quotes?quote_token=eq.${encodeURIComponent(token)}`, { method: 'PATCH', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ reminder_count: (Number(reminder_count) || 0) + 1, last_reminder_sent_at: new Date().toISOString() }) });
      } catch (e) { console.error('[Aircon] reminder update error:', e.message); }
      return res.status(200).json({ success: true, sms_sent: smsSent, reminder_count: (Number(reminder_count) || 0) + 1, last_reminder_sent_at: new Date().toISOString() });
    }
    if (emailSuccess) {
      try {
        const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/aircon_quotes`, {
          method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            quote_token: token, agent_name: agent_name || null,
            customer_name: customer_name || null, customer_email: customer_email || null, customer_phone: customer_phone || null, customer_address: customer_address || null,
            line_items: Array.isArray(line_items) ? line_items : [],
            veec_discount: Number(veec_discount) || 0,
            products_ex_gst: Number(products_ex_gst) || 0, total_gst: Number(total_gst) || 0, products_inc_gst: Number(products_inc_gst) || 0,
            subtotal: Number(subtotal) || 0, total_out_of_pocket: Number(total_out_of_pocket) || 0,
            status: 'sent', accepted: false, reminder_count: 0, sent_at: new Date().toISOString(),
          }),
        });
        if (!supaRes.ok) console.error('[Aircon] Supabase insert failed:', supaRes.status, (await supaRes.text()).slice(0, 300));
      } catch (e) { console.error('[Aircon] Supabase insert error:', e.message); }
    }
    return res.status(200).json({ success: true, sms_sent: smsSent, brochure_attached: attachments.length > 0 });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=aircon-accept: internal "quote accepted" notification email
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'aircon-accept') {
    const {
      customer_name, customer_email, customer_phone, customer_address, agent_name,
      total_out_of_pocket = 0, veec_discount = 0, products_inc_gst = 0, accepted_at, line_items = [],
    } = body;
    if (!customer_name || !customer_email) return res.status(400).json({ error: 'Missing required fields.' });
    const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const acceptedDisplay = new Date(accepted_at || Date.now()).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' });
    const unitList = (Array.isArray(line_items) ? line_items : []).map(l => `${Number(l.qty) || 0} × ${esc(l.name)}`).join('<br>') || '—';

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Aircon Quote Accepted</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;font-family:${FONT};color:#141c2e;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:36px 16px 48px;">
  <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#000000;padding:20px 28px;border-radius:6px 6px 0 0;"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="https://portal.goldsure.com.au/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="130" style="display:block;width:130px;height:auto;"></td><td align="right" valign="middle"><span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c9a13b;">Internal · Aircon</span></td></tr></table></td></tr>
    <tr><td style="height:3px;background:#18a96e;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;padding:28px 28px 32px;border-radius:0 0 6px 6px;border:1px solid #e3e7ef;border-top:none;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr><td><p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#18a96e;">Quote Accepted</p><p style="margin:0;font-size:22px;font-weight:700;color:#141c2e;line-height:1.2;">${esc(customer_name)}</p></td><td align="right" valign="top"><p style="margin:0;font-size:11px;color:#6b7899;">${esc(acceptedDisplay)}</p><p style="margin:4px 0 0;font-size:11px;color:#6b7899;">Agent: <strong style="color:#141c2e;">${esc(agent_name || '—')}</strong></p></td></tr></table>
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Customer Details</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;border:1px solid #e3e7ef;border-radius:4px;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;width:32%;background:#f7f8fa;font-size:11px;color:#6b7899;">Email</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;"><a href="mailto:${esc(customer_email)}" style="color:#b08d2e;text-decoration:none;font-weight:600;">${esc(customer_email)}</a></td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Phone</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${esc(customer_phone || '—')}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Address</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;">${esc(customer_address || '—')}</td></tr>
        <tr><td style="padding:10px 14px;background:#f7f8fa;font-size:11px;color:#6b7899;vertical-align:top;">Units</td><td style="padding:10px 14px;font-size:13px;">${unitList}</td></tr>
      </table>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;border:1px solid #e3e7ef;border-radius:4px;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Total (inc GST)</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${money(products_inc_gst)}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">VEEC discount</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;color:#18a96e;">− ${money(veec_discount)}</td></tr>
        <tr style="background:#000000;"><td style="padding:14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,0.6);">Out-of-Pocket</td><td align="right" style="padding:14px;font-size:18px;font-weight:700;color:#c9a13b;">${money(total_out_of_pocket)}</td></tr>
      </table>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 16px;background:#eaf7f2;border-left:3px solid #18a96e;border-radius:0 4px 4px 0;"><p style="margin:0;font-size:13px;color:#0d7a4f;line-height:1.6;"><strong style="color:#141c2e;">Next step:</strong> Call ${esc(String(customer_name).split(' ')[0])} to confirm the installation date and complete the booking.</p></td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:20px 0 0;"><p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6b7899;">Goldsure Pty Ltd</p><p style="margin:0;font-size:11px;color:#9aa5b8;">ABN 66 683 305 106 &nbsp;·&nbsp; Preston VIC 3072</p></td></tr>
  </table>
</td></tr></table></body></html>`;

    const acceptSubject = `Aircon Quote Accepted – ${customer_name} – ${money(total_out_of_pocket)}`;
    // Notify the team via Hostinger (from info@); fall back to Resend.
    let acceptSent = false;
    try {
      await sendHostingerMail({ to: ['info@goldsure.com.au'], displayName: 'Goldsure Quotes', subject: acceptSubject, html });
      acceptSent = true;
    } catch (hostErr) {
      console.error('[Aircon accept] Hostinger failed, falling back to Resend:', hostErr.message);
    }
    if (!acceptSent) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Goldsure Quotes <info@goldsure.com.au>', to: ['info@goldsure.com.au'], subject: acceptSubject, html }),
        });
        if (!r.ok) { const detail = await r.text(); console.error('[Aircon accept] Resend failed:', r.status, detail); return res.status(500).json({ error: 'Failed to send notification.', detail: detail.slice(0, 200) }); }
      } catch (e) { console.error('[Aircon accept] error:', e.message); return res.status(500).json({ error: 'Internal error.' }); }
    }
    return res.status(200).json({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=aircon-reject: internal "quote declined" notification email
  // Fired by /aircons/reject.html when a customer declines their quote.
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'aircon-reject') {
    const {
      customer_name, customer_email, customer_phone, customer_address, agent_name,
      total_out_of_pocket = 0, rejected_at, line_items = [],
    } = body;
    if (!customer_name || !customer_email) return res.status(400).json({ error: 'Missing required fields.' });
    const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const rejectedDisplay = new Date(rejected_at || Date.now()).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' });
    const unitList = (Array.isArray(line_items) ? line_items : []).map(l => `${Number(l.qty) || 0} × ${esc(l.name)}`).join('<br>') || '—';

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Aircon Quote Declined</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;font-family:${FONT};color:#141c2e;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:36px 16px 48px;">
  <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#000000;padding:20px 28px;border-radius:6px 6px 0 0;"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="https://portal.goldsure.com.au/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="130" style="display:block;width:130px;height:auto;"></td><td align="right" valign="middle"><span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c9a13b;">Internal · Aircon</span></td></tr></table></td></tr>
    <tr><td style="height:3px;background:#e04f4f;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;padding:28px 28px 32px;border-radius:0 0 6px 6px;border:1px solid #e3e7ef;border-top:none;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr><td><p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#e04f4f;">Quote Declined</p><p style="margin:0;font-size:22px;font-weight:700;color:#141c2e;line-height:1.2;">${esc(customer_name)}</p></td><td align="right" valign="top"><p style="margin:0;font-size:11px;color:#6b7899;">${esc(rejectedDisplay)}</p><p style="margin:4px 0 0;font-size:11px;color:#6b7899;">Agent: <strong style="color:#141c2e;">${esc(agent_name || '—')}</strong></p></td></tr></table>
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Customer Details</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;border:1px solid #e3e7ef;border-radius:4px;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;width:32%;background:#f7f8fa;font-size:11px;color:#6b7899;">Email</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;"><a href="mailto:${esc(customer_email)}" style="color:#b08d2e;text-decoration:none;font-weight:600;">${esc(customer_email)}</a></td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Phone</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${esc(customer_phone || '—')}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;">Address</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;">${esc(customer_address || '—')}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f7f8fa;font-size:11px;color:#6b7899;vertical-align:top;">Units</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;">${unitList}</td></tr>
        <tr><td style="padding:10px 14px;background:#f7f8fa;font-size:11px;color:#6b7899;">Out-of-Pocket</td><td style="padding:10px 14px;font-size:13px;font-weight:600;">${money(total_out_of_pocket)}</td></tr>
      </table>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 16px;background:#fdecec;border-left:3px solid #e04f4f;border-radius:0 4px 4px 0;"><p style="margin:0;font-size:13px;color:#a03636;line-height:1.6;"><strong style="color:#141c2e;">Heads up:</strong> ${esc(String(customer_name).split(' ')[0])} declined this quote online. No further reminders will be sent.</p></td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:20px 0 0;"><p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6b7899;">Goldsure Pty Ltd</p><p style="margin:0;font-size:11px;color:#9aa5b8;">ABN 66 683 305 106 &nbsp;·&nbsp; Preston VIC 3072</p></td></tr>
  </table>
</td></tr></table></body></html>`;

    const rejectSubject = `Aircon Quote Declined – ${customer_name}`;
    let rejectSent = false;
    try {
      await sendHostingerMail({ to: ['info@goldsure.com.au'], displayName: 'Goldsure Quotes', subject: rejectSubject, html });
      rejectSent = true;
    } catch (hostErr) { console.error('[Aircon reject] Hostinger failed, falling back to Resend:', hostErr.message); }
    if (!rejectSent) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Goldsure Quotes <info@goldsure.com.au>', to: ['info@goldsure.com.au'], subject: rejectSubject, html }),
        });
        if (!r.ok) { const detail = await r.text(); console.error('[Aircon reject] Resend failed:', r.status, detail); return res.status(500).json({ error: 'Failed to send notification.', detail: detail.slice(0, 200) }); }
      } catch (e) { console.error('[Aircon reject] error:', e.message); return res.status(500).json({ error: 'Internal error.' }); }
    }
    return res.status(200).json({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST action=sa-reject: internal smoke-alarm "quote declined" notification
  // Fired by /reject-quote.html when a smoke-alarm customer declines. Lives here
  // (rather than a dedicated api/smoke-alarms/reject.js) to stay within the
  // Vercel Hobby 12-function limit — mirrors hws-reject / aircon-reject.
  // ════════════════════════════════════════════════════════════════════════════
  if (body.action === 'sa-reject') {
    const {
      customer_name, customer_email, customer_phone, customer_address,
      agent_name, service_type, grand_total, rejected_at,
    } = body;
    if (!customer_name || !customer_email) return res.status(400).json({ error: 'Missing required fields.' });
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Smoke Alarm Quote Declined</title></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:${FONT};color:#141c2e;">
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f0f2f5"><tr><td align="center" style="padding:36px 16px 48px;">
  <table width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#000000;padding:20px 28px;border-radius:4px 4px 0 0;"><table width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699a73ab3a2afd85cbdb392f.jpg" alt="Goldsure" width="130" style="display:block;width:130px;height:auto;" /></td><td align="right" valign="middle"><span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Internal Notification</span></td></tr></table></td></tr>
    <tr><td style="height:3px;background:#e04f4f;font-size:1px;line-height:1px;">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;padding:28px 28px 32px;border-radius:0 0 4px 4px;border:1px solid #e3e7ef;border-top:none;">
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td><p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#e04f4f;">Quote Declined</p><p style="margin:0;font-size:22px;font-weight:700;color:#141c2e;line-height:1.2;">${esc(customer_name)}</p></td><td align="right" valign="top"><p style="margin:0;font-size:11px;color:#6b7899;">${esc(rejected_at || '')}</p><p style="margin:4px 0 0;font-size:11px;color:#6b7899;">Agent: <strong style="color:#141c2e;">${esc(agent_name || '—')}</strong></p></td></tr></table>
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Customer Details</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #e3e7ef;border-radius:4px;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;width:30%;background:#f0f2f5;font-size:11px;color:#6b7899;">Email</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;"><a href="mailto:${esc(customer_email)}" style="color:#b08d2e;text-decoration:none;font-weight:600;">${esc(customer_email)}</a></td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f0f2f5;font-size:11px;color:#6b7899;">Phone</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${esc(customer_phone || '—')}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f0f2f5;font-size:11px;color:#6b7899;">Address</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;">${esc(customer_address || '—')}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f0f2f5;font-size:11px;color:#6b7899;">Service</td><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${esc(service_type || '—')}</td></tr>
        <tr><td style="padding:10px 14px;background:#f0f2f5;font-size:11px;color:#6b7899;">Quote Total</td><td style="padding:10px 14px;font-size:13px;font-weight:600;">${esc(grand_total || '—')}</td></tr>
      </table>
      <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 16px;background:#fdecec;border-left:3px solid #e04f4f;border-radius:0 4px 4px 0;"><p style="margin:0;font-size:13px;color:#a03636;line-height:1.6;"><strong style="color:#141c2e;">Heads up:</strong> ${esc(customer_name)} declined this quote online. No further reminders will be sent.</p></td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:20px 0 0;"><p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6b7899;">Goldsure Pty Ltd</p><p style="margin:0;font-size:11px;color:#9aa5b8;">ABN: 66 683 305 106 &nbsp;·&nbsp; Queensland, Australia</p></td></tr>
  </table>
</td></tr></table></body></html>`;

    const rejectSubject = `Smoke Alarm Quote Declined – ${customer_name}`;
    let rejectSent = false;
    try {
      await sendHostingerMail({ to: ['info@goldsure.com.au'], displayName: 'Goldsure Quotes', subject: rejectSubject, html });
      rejectSent = true;
    } catch (hostErr) { console.error('[SA reject] Hostinger failed, falling back to Resend:', hostErr.message); }
    if (!rejectSent) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Goldsure Quotes <info@goldsure.com.au>', to: ['info@goldsure.com.au'], subject: rejectSubject, html }),
        });
        if (!r.ok) { const detail = await r.text(); console.error('[SA reject] Resend failed:', r.status, detail); return res.status(500).json({ error: 'Failed to send notification.', detail: detail.slice(0, 200) }); }
      } catch (e) { console.error('[SA reject] error:', e.message); return res.status(500).json({ error: 'Internal error.' }); }
    }
    return res.status(200).json({ success: true });
  }

  // ── POST action=sync: trigger SMS Gate inbox export ─────────────────────────
  // SMS Gate has no pull endpoint for received messages — the documented method
  // is POST /messages/inbox/export, which makes the device re-fire sms:received
  // webhooks for the given window. Those land back on this same endpoint (below)
  // and get written to Supabase. So: trigger export → wait a few seconds in the
  // UI → reload.
  if (body.action === 'sync') {
    const user = process.env.SMSGATE_USERNAME;
    const pass = process.env.SMSGATE_PASSWORD;
    if (!user || !pass) {
      return res.status(503).json({ error: 'SMS Gateway credentials not configured.' });
    }

    const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
    // Window to re-export. The scheduled safety-net cron passes a short `minutes`
    // window (e.g. 30) so each run only re-fires the last few minutes of messages;
    // the manual "Sync inbox" button keeps the wider day-based default. Re-fired
    // messages are de-duplicated by sms_gate_id in the webhook branch below, so a
    // short overlapping window never produces duplicate rows or duplicate emails.
    let sinceMs;
    if (body.minutes != null) {
      sinceMs = Math.min(Math.max(parseInt(body.minutes, 10) || 0, 1), 1440) * 60 * 1000;
    } else {
      const days = Math.min(parseInt(body.days, 10) || 3, 30);
      sinceMs = days * 24 * 60 * 60 * 1000;
    }
    const since = new Date(Date.now() - sinceMs).toISOString();
    const until = new Date().toISOString();

    const exportBody = { since, until };
    if (process.env.SMSGATE_DEVICE_ID) exportBody.deviceId = process.env.SMSGATE_DEVICE_ID;

    const exportRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages/inbox/export', {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(exportBody),
    });

    const detail = await exportRes.text();
    console.log('[Sync] inbox/export status', exportRes.status, detail);

    if (!exportRes.ok) {
      return res.status(502).json({ error: 'Inbox export failed', status: exportRes.status, detail });
    }

    return res.status(200).json({
      success: true,
      triggered: true,
      since,
      note: 'Export requested. Received messages arrive via webhook within a few seconds.',
    });
  }

  // ── POST action=note: save internal note + post to GHL ─────────────────────
  if (body.action === 'note') {
    const { phone, message } = body;
    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });

    // Save to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ phone_number: phone, message, direction: 'outbound', status: 'note' }),
    });

    // Post to GHL contact notes (best-effort)
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    if (apiKey && locationId) {
      try {
        const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);
        const target = last9(phone);
        const variants = [...new Set([phone, phone.replace(/^\+/, ''), '0' + target, target])];
        let contactId = null;
        const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
        for (const q of variants) {
          const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`, { headers: hdrs });
          if (!r.ok) continue;
          const d = await r.json();
          const match = (d.contacts || []).find(c => last9(c.phone) === target);
          if (match) { contactId = match.id; break; }
        }
        if (contactId) {
          await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
            method: 'POST',
            headers: { ...hdrs, 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: `[SMS Portal Note]\n${message}` }),
          });
        }
      } catch (e) { console.error('[GHL note]', e.message); }
    }

    return res.status(200).json({ success: true });
  }

  // ── POST action=schedule: save a scheduled outbound SMS ─────────────────────
  if (body.action === 'schedule') {
    const { phone, message, sendAt } = body;
    if (!phone || !message || !sendAt) return res.status(400).json({ error: 'phone, message and sendAt required' });
    if (await isOptedOut(phone)) {
      return res.status(403).json({
        error: 'This customer has opted out (replied STOP). Scheduling is blocked.',
        optedOut: true,
      });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ phone_number: phone, message, direction: 'outbound', status: 'scheduled', sms_gate_id: `sched:${sendAt}` }),
    });
    return res.status(200).json({ success: true });
  }

  // ── POST action=bulk-send: schedule N messages with staggered fire times ──────
  if (body.action === 'bulk-send') {
    const phones  = (Array.isArray(body.phones) ? body.phones : []).slice(0, 500);
    const msgTpl  = String(body.message || '').trim();
    const names   = (body.names && typeof body.names === 'object') ? body.names : {};
    const intervalMs = Math.max(5000, Math.min(3600000, (parseInt(body.intervalSeconds) || 60) * 1000));
    const campaign = String(body.campaign || '').trim().slice(0, 120) || null;

    if (!phones.length || !msgTpl) return res.status(400).json({ error: 'phones and message required' });

    const ah = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

    // Tag rows as bulk (so the sidebar can collapse them) and with the campaign
    // name (so each campaign gets its own group). Each tag is only written if its
    // column exists (ALTER TABLE in sms/README.md) — otherwise degrade gracefully.
    let hasBulkCol = false, hasCampaignCol = false;
    try {
      const probe = await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?select=is_bulk&limit=1`, { headers: ah });
      hasBulkCol = probe.ok;
    } catch {}
    try {
      const probe = await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?select=campaign&limit=1`, { headers: ah });
      hasCampaignCol = probe.ok;
    } catch {}

    const results = [];
    let slot = 0; // counts only the messages actually scheduled (skips don't consume a slot)

    for (const rawPhone of phones) {
      const phone = normalizeAuPhone(rawPhone);
      if (await isOptedOut(phone)) { results.push({ phone, status: 'skipped', reason: 'opted-out' }); continue; }
      const firstName = names[rawPhone] || names[phone] || '';
      const text = msgTpl.replace(/\{\{contact\.first_name\}\}/g, firstName);
      const fireAt = new Date(Date.now() + slot * intervalMs).toISOString();
      const r = await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
        method: 'POST',
        headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          phone_number: phone, message: text, direction: 'outbound', status: 'scheduled', sms_gate_id: 'sched:' + fireAt,
          ...(hasBulkCol ? { is_bulk: true } : {}),
          ...(hasCampaignCol && campaign ? { campaign } : {}),
        }),
      });
      let id = null;
      if (r.ok) { const ins = await r.json().catch(() => []); id = Array.isArray(ins) && ins[0] ? ins[0].id : null; }
      results.push({ phone, status: r.ok ? 'scheduled' : 'error', fireAt, id });
      if (r.ok) slot++;
    }
    const warnings = [];
    if (!hasBulkCol) warnings.push('is_bulk column missing — run the ALTER TABLE in sms/README.md so bulk sends collapse in the sidebar');
    else if (!hasCampaignCol && campaign) warnings.push('campaign column missing — run "ALTER TABLE sms_messages ADD COLUMN campaign text;" so campaigns get their own named group');
    return res.status(200).json({ results, ...(warnings.length ? { warning: warnings.join(' · ') } : {}) });
  }

  // ── POST action=cancel-bulk: cancel all future scheduled messages for a set of phones
  if (body.action === 'cancel-bulk') {
    const phones = (Array.isArray(body.phones) ? body.phones : []).map(p => normalizeAuPhone(p));
    if (!phones.length) return res.status(400).json({ error: 'phones required' });
    const ah = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
    // Cancel scheduled rows for these phones (future ones only — those still 'scheduled')
    const inList = phones.map(p => `"${p.replace(/"/g, '')}"`).join(',');
    await fetch(
      `${SUPABASE_URL}/rest/v1/sms_messages?status=eq.scheduled&phone_number=in.(${encodeURIComponent(inList)})`,
      { method: 'PATCH', headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'cancelled' }) }
    );
    return res.status(200).json({ success: true });
  }

  // ── POST action=cancel-schedule: mark a scheduled message as cancelled ───────
  if (body.action === 'cancel-schedule') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    return res.status(200).json({ success: true });
  }

  // ── POST action=quote-ghl-stages: pipeline stages + email→stage map ─────────
  // Powers the "GHL Stage" column on the Aircon / Hot Water quote trackers.
  // Body: { pipeline:'aircon'|'hotwater', emails:[...] }. Picks the product's
  // pipeline (env id override, else name match), returns its ordered stages plus,
  // for each email, that contact's current opportunity stage. Best-effort: a GHL
  // hiccup returns empty data rather than failing the tracker.
  if (body.action === 'quote-ghl-stages') {
    const apiKey = process.env.GHL_API_KEY, locationId = process.env.GHL_LOCATION_ID;
    if (!apiKey || !locationId) return res.status(200).json({ stages: [], pipelineId: '', map: {} });
    const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
    const GHL = 'https://services.leadconnectorhq.com';
    const product = String(body.pipeline || '').toLowerCase();
    const emails = [...new Set((Array.isArray(body.emails) ? body.emails : []).map(e => String(e || '').toLowerCase().trim()).filter(Boolean))].slice(0, 400);
    const pipeIdEnv = product === 'aircon' ? (process.env.AIRCON_PIPELINE_ID || '') : (process.env.HWS_PIPELINE_ID || '');
    const nameHints = product === 'aircon'
      ? ['air con', 'aircon', 'air-con', 'air conditioning', 'hvac']
      : ['hot water', 'hotwater', 'heat pump', 'hws', 'water'];

    let stages = [], pipelineId = '';
    try {
      const pRes = await fetch(`${GHL}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers: hdrs });
      const pipes = pRes.ok ? ((await pRes.json()).pipelines || []) : [];
      let pipe = pipeIdEnv ? pipes.find(p => p.id === pipeIdEnv) : null;
      if (!pipe) pipe = pipes.find(p => nameHints.some(h => String(p.name || '').toLowerCase().includes(h)));
      if (!pipe) pipe = pipes[0];
      if (pipe) {
        pipelineId = pipe.id;
        stages = (pipe.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position ?? 0 })).sort((a, b) => a.position - b.position);
      }
    } catch (e) { console.warn('[quote-ghl-stages] pipelines failed:', e.message); }

    const stageNameById = Object.fromEntries(stages.map(s => [s.id, s.name]));
    const map = {};
    const BATCH = 5;
    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      await Promise.all(batch.map(async (email) => {
        try {
          const cRes = await fetch(`${GHL}/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(email)}&limit=5`, { headers: hdrs });
          if (!cRes.ok) return;
          const contacts = (await cRes.json()).contacts || [];
          const contact = contacts.find(c => (c.email || '').toLowerCase() === email) || contacts[0];
          if (!contact?.id) return;
          const oRes = await fetch(`${GHL}/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contact.id)}&limit=20`, { headers: hdrs });
          if (!oRes.ok) return;
          const opps = (await oRes.json()).opportunities || [];
          if (!opps.length) return;
          const inPipe = pipelineId ? opps.filter(o => o.pipelineId === pipelineId) : [];
          const opp = (inPipe.length ? inPipe : opps).sort((a, b) => new Date(b.updatedAt || b.dateUpdated || 0) - new Date(a.updatedAt || a.dateUpdated || 0))[0];
          map[email] = {
            stage: opp.pipelineStageName || stageNameById[opp.pipelineStageId] || opp.pipelineStage?.name || null,
            stageId: opp.pipelineStageId || null,
            opportunityId: opp.id || null,
            pipelineId: opp.pipelineId || null,
          };
        } catch { /* skip this email */ }
      }));
    }
    return res.status(200).json({ stages, pipelineId, map });
  }

  // ── POST action=update-stage: move a GHL opportunity to another stage ───────
  if (body.action === 'update-stage') {
    const { opportunityId, pipelineId, stageId } = body;
    if (!opportunityId || !stageId) return res.status(400).json({ error: 'opportunityId and stageId required' });
    const apiKey = process.env.GHL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GHL not configured' });
    // GHL throttles bursts with HTTP 429. Retry with backoff (honouring
    // Retry-After) so a busy moment doesn't fail the stage change outright.
    let r;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await fetch(`https://services.leadconnectorhq.com/opportunities/${encodeURIComponent(opportunityId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId, pipelineStageId: stageId }),
      });
      if (r.status !== 429 && r.status < 500) break;
      if (attempt === 3) break;
      const retryAfter = parseInt(r.headers.get('retry-after') || '', 10);
      const waitMs = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5000) : 500 * Math.pow(2, attempt);
      await new Promise(res2 => setTimeout(res2, waitMs));
    }
    if (!r.ok) {
      const detail = await r.text();
      console.error('[GHL update-stage]', r.status, detail);
      return res.status(502).json({ error: 'GHL rejected the stage update', ghlStatus: r.status, detail: detail.slice(0, 400) });
    }

    // ── One-way sync: moving a contact to a "lost" stage marks their quote(s)
    // Rejected in the tracker and notes it on the GHL contact. Matches on email
    // (phone formats vary: +61 vs 0). Best-effort — never fails the stage update.
    let rejected = 0;
    try {
      const stageLc = String(body.stageName || '').toLowerCase();
      const isLost = ['quote not accepted', 'unserviceable', 'not interested', 'spam'].some(t => stageLc.includes(t));
      if (isLost && body.contactId && SUPABASE_URL) {
        // Resolve the customer email from the GHL contact (robust regardless of
        // what the portal had cached).
        let email = String(body.email || '').trim();
        if (!email) {
          try {
            const cRes = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(body.contactId)}`, {
              headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' },
            });
            if (cRes.ok) email = String((await cRes.json()).contact?.email || '').trim();
          } catch (e) { console.error('[update-stage contact lookup]', e.message); }
        }
        if (email) {
          const emailLc = email.toLowerCase();
          const sbHdrs = { apikey: SUPABASE_ADMIN_KEY, Authorization: `Bearer ${SUPABASE_ADMIN_KEY}`, 'Content-Type': 'application/json' };
          for (const tbl of ['hotwater_quotes', 'aircon_quotes', 'quote_emails']) {
            try {
              // Coarse case-insensitive filter, then verify exact match in JS so a
              // literal "_" in an email can't act as an ilike wildcard.
              const gRes = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?status=eq.sent&customer_email=ilike.${encodeURIComponent(email)}&select=id,customer_email`, { headers: sbHdrs });
              if (!gRes.ok) continue;
              const ids = ((await gRes.json()) || []).filter(row => String(row.customer_email || '').toLowerCase() === emailLc).map(row => row.id);
              if (!ids.length) continue;
              const pRes = await fetch(`${SUPABASE_URL}/rest/v1/${tbl}?id=in.(${ids.map(encodeURIComponent).join(',')})`, {
                method: 'PATCH', headers: { ...sbHdrs, Prefer: 'return=minimal' },
                body: JSON.stringify({ status: 'rejected', accepted: false }),
              });
              if (pRes.ok) rejected += ids.length;
            } catch (e) { console.error('[update-stage reject]', tbl, e.message); }
          }
          if (rejected > 0) {
            try {
              await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(body.contactId)}/notes`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ body: `[Quote Tracker] ${rejected} quote(s) marked Rejected — contact moved to "${body.stageName}".` }),
              });
            } catch (e) { console.error('[update-stage note]', e.message); }
          }
        }
      }
    } catch (e) { console.error('[update-stage auto-reject]', e.message); }

    return res.status(200).json({ success: true, rejected });
  }

  // ── POST action=delete-quotes: password-gated hard delete of quote rows ──────
  // Used by the quote trackers' "Delete Selected". Runs server-side with the
  // service-role key so it bypasses RLS (the anon key the browser holds cannot
  // delete). Password matches SMS_DELETE_PIN (defaults to 4321).
  if (body.action === 'delete-quotes') {
    const { table, ids, pin } = body;
    const ALLOWED = { hotwater_quotes: 1, aircon_quotes: 1, quote_emails: 1 };
    if (!ALLOWED[table]) return res.status(400).json({ error: 'Invalid table.' });
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No quote ids provided.' });
    const expected = process.env.SMS_DELETE_PIN || '4321';
    if (String(pin || '') !== String(expected)) return res.status(403).json({ error: 'Incorrect password.' });
    if (!SUPABASE_URL) return res.status(503).json({ error: 'Supabase not configured.' });
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: 'Delete needs SUPABASE_SERVICE_ROLE_KEY set in the environment.' });
    }
    try {
      const inList = ids.map(encodeURIComponent).join(',');
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${inList})`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_ADMIN_KEY, Authorization: `Bearer ${SUPABASE_ADMIN_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      });
      const rows = await r.json().catch(() => []);
      if (!r.ok) { console.error('[delete-quotes]', table, r.status, rows); return res.status(502).json({ error: 'Delete failed.', detail: rows }); }
      const deletedIds = Array.isArray(rows) ? rows.map(x => x.id) : [];
      return res.status(200).json({ success: true, deleted: deletedIds.length, ids: deletedIds });
    } catch (e) {
      console.error('[delete-quotes] error:', e.message);
      return res.status(500).json({ error: 'Internal error.' });
    }
  }

  // ── POST action=delete-thread: PIN-gated hard delete of a whole conversation ─
  // Requires a 4-digit PIN that matches SMS_DELETE_PIN (defaults to 4321 if the
  // env var isn't set). Removes every row for that phone number from Supabase.
  if (body.action === 'delete-thread') {
    const { phone, pin } = body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const expected = process.env.SMS_DELETE_PIN || '4321';
    if (String(pin || '') !== String(expected)) {
      return res.status(403).json({ error: 'Incorrect PIN' });
    }
    // SOFT delete: mark rows status='deleted' rather than removing them. A hard
    // delete didn't stick — the gateway phone still holds the inbound SMS, so the
    // next inbox Sync re-fired the webhook, the de-dup check found no existing row,
    // and the message was re-inserted AND re-emailed. Keeping the row (hidden
    // everywhere in the portal) lets the de-dup recognise it and skip the
    // re-import/re-email. optout/optin markers are preserved so deleting a thread
    // can never lose a customer's STOP.
    const adminHeaders = { apikey: SUPABASE_ADMIN_KEY, Authorization: `Bearer ${SUPABASE_ADMIN_KEY}` };
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}&status=not.in.(optout,optin,deleted)&select=id`,
      { method: 'PATCH', headers: { ...adminHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'deleted' }) }
    );
    if (!patchRes.ok) {
      const detail = await patchRes.text();
      console.error('[Delete thread] soft-delete failed', patchRes.status, detail);
      return res.status(502).json({ error: 'Delete failed', detail });
    }
    const rows = await patchRes.json().catch(() => []);
    const deleted = Array.isArray(rows) ? rows.length : 0;
    // Tidy up the shared read-state row for this number too (best-effort).
    fetch(`${SUPABASE_URL}/rest/v1/sms_read_state?phone_number=eq.${encodeURIComponent(phone)}`,
      { method: 'DELETE', headers: { ...adminHeaders, Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ success: true, deleted });
  }

  // ── POST action=delete-threads: PIN-gated bulk (soft) delete of conversations ─
  // Same soft-delete approach as delete-thread, for the sidebar's bulk select.
  // Runs in chunks so a long phone list can't overflow the request URL.
  if (body.action === 'delete-threads') {
    const phones = [...new Set((Array.isArray(body.phones) ? body.phones : [])
      .map(p => String(p || '').trim()).filter(Boolean))].slice(0, 1000);
    const { pin } = body;
    if (!phones.length) return res.status(400).json({ error: 'phones required' });
    const expected = process.env.SMS_DELETE_PIN || '4321';
    if (String(pin || '') !== String(expected)) {
      return res.status(403).json({ error: 'Incorrect PIN' });
    }
    const adminHeaders = { apikey: SUPABASE_ADMIN_KEY, Authorization: `Bearer ${SUPABASE_ADMIN_KEY}` };
    let deleted = 0;
    const threadsDeleted = new Set();
    for (let i = 0; i < phones.length; i += 50) {
      const chunk = phones.slice(i, i + 50);
      const inList = chunk.map(p => `"${p.replace(/"/g, '')}"`).join(',');
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=in.(${encodeURIComponent(inList)})&status=not.in.(optout,optin,deleted)&select=phone_number`,
        { method: 'PATCH', headers: { ...adminHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ status: 'deleted' }) }
      );
      if (!patchRes.ok) {
        const detail = await patchRes.text();
        console.error('[Delete threads] chunk failed', patchRes.status, detail);
        return res.status(502).json({ error: 'Delete failed', detail, deletedSoFar: deleted });
      }
      const rows = await patchRes.json().catch(() => []);
      for (const r of (Array.isArray(rows) ? rows : [])) { deleted++; threadsDeleted.add(r.phone_number); }
      // Tidy shared read-state for this chunk (best-effort).
      fetch(`${SUPABASE_URL}/rest/v1/sms_read_state?phone_number=in.(${encodeURIComponent(inList)})`,
        { method: 'DELETE', headers: { ...adminHeaders, Prefer: 'return=minimal' } }).catch(() => {});
    }
    return res.status(200).json({ success: true, deleted, threads: threadsDeleted.size });
  }

  // ── POST action=mark-read: mark one thread read in the shared read-state ─────
  // Fire-and-forget from the UI when a conversation is opened, so reading it on
  // one browser clears its unread badge on every other browser/device too. Upsert
  // is keyed on phone_number (primary key). No PIN — normal staff action.
  if (body.action === 'mark-read') {
    const { phone } = body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sms_read_state`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ phone_number: phone, last_seen_at: new Date().toISOString() }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[mark-read] upsert failed', r.status, detail);
      // Don't fail the UI — read-state simply stays local until the table exists.
      return res.status(200).json({ success: false, warning: 'read-state not persisted' });
    }
    return res.status(200).json({ success: true });
  }

  // ── POST action=mark-all-read: PIN-gated "mark everything read" (shared) ─────
  // Sets the global read marker (row '__ALL__') so every conversation counts as
  // read for everyone, on every device. Same PIN as delete-thread (SMS_DELETE_PIN,
  // defaults to 4321), verified here on the server so it never ships in the page.
  if (body.action === 'mark-all-read') {
    const expected = process.env.SMS_DELETE_PIN || '4321';
    if (String(body.pin || '') !== String(expected)) {
      return res.status(403).json({ error: 'Incorrect PIN' });
    }
    const nowIso = new Date().toISOString();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sms_read_state`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ phone_number: '__ALL__', last_seen_at: nowIso }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[mark-all-read] failed', r.status, detail);
      return res.status(502).json({ error: 'Could not save — has the sms_read_state table been created?', detail });
    }
    return res.status(200).json({ success: true, allReadAt: nowIso });
  }

  // ── POST action=send: outbound SMS ──────────────────────────────────────────
  if (body.action === 'send') {
    const { phone, message } = body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone and message are required' });
    }

    if (await isOptedOut(phone)) {
      return res.status(403).json({
        error: 'This customer has opted out (replied STOP). Sending is blocked. They can reply START to re-subscribe.',
        optedOut: true,
      });
    }

    const user = process.env.SMSGATE_USERNAME;
    const pass = process.env.SMSGATE_PASSWORD;
    if (!user || !pass) {
      return res.status(503).json({
        error: 'SMS Gateway credentials not configured.',
        help: 'Add SMSGATE_USERNAME and SMSGATE_PASSWORD to Vercel environment variables.',
      });
    }

    const credentials = Buffer.from(`${user}:${pass}`).toString('base64');

    const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumbers: [phone],
        textMessage: { text: message },
        ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}),
      }),
    });

    if (!smsRes.ok) {
      const detail = await smsRes.text();
      console.error('[SMSGate] send failed', smsRes.status, detail);
      return res.status(502).json({ error: 'SMS Gateway rejected the request', detail });
    }

    const smsData = await smsRes.json().catch(() => ({}));
    const smsGateId = smsData.id || null;

    // Log to Supabase (non-fatal)
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          phone_number: phone,
          message,
          direction: 'outbound',
          status: 'sent',
          sms_gate_id: smsGateId,
        }),
      });
    } catch (err) {
      console.error('[Supabase] outbound log failed (non-fatal):', err.message);
    }

    return res.status(200).json({ success: true, messageId: smsGateId });
  }

  // ── POST action=webhook: inbound SMS from SMS Gate ──────────────────────────
  // Webhook URL (no query params needed):
  //   https://portal.goldsure.com.au/api/battery/request-callback
  //
  // Real SMS Gate webhooks are NESTED under `payload`:
  //   { "event": "sms:received",
  //     "payload": { "messageId", "message", "phoneNumber", "receivedAt" } }
  // We read from body.payload first, then fall back to the flat body so manual
  // tests and older formats still work.
  const p = body.payload && typeof body.payload === 'object' ? body.payload : body;

  const isSmsGateWebhook =
    body.action === 'webhook' ||
    req.query.action === 'webhook' ||
    (typeof body.event === 'string' && body.event.toLowerCase().includes('received')) ||
    (!body.action && !body.fullName && (p.phoneNumber || p.from || p.sender) && (p.message || p.text || p.content));

  if (isSmsGateWebhook) {
    console.log('[Webhook] inbound payload:', JSON.stringify(body));

    // SMS Gate may use different field names across versions — handle all variants
    const phoneRaw  = p.phoneNumber || p.from || p.sender || p.source || p.phone;
    let   message   = p.message     || p.text || p.content || p.body;
    const messageId = p.messageId   || p.id   || p.msgId   || null;

    // Media/MMS messages can arrive with no text body — keep a placeholder
    // rather than dropping them with a 400.
    if (!message && phoneRaw) {
      message = '[Media message received — view on the gateway phone]';
    }

    if (!phoneRaw || !message) {
      console.error('[Webhook] missing fields. Body was:', JSON.stringify(body));
      return res.status(400).json({ error: 'phoneNumber and message are required', received: body });
    }

    const phoneNumber = normalizeAuPhone(phoneRaw);

    // Sanitise the timestamp — an unparseable value would make the insert fail
    const rawTs = p.receivedAt || p.timestamp || p.date;
    let receivedAt = rawTs;
    if (!receivedAt || isNaN(new Date(receivedAt).getTime())) {
      receivedAt = new Date().toISOString();
    }

    // Diagnostic: how stale is this message when the webhook reaches us? A large
    // value points upstream — the gateway phone / SMS Gate cloud delivered the
    // webhook late (usually Android battery optimisation / Doze on the phone),
    // NOT the portal, which shows messages within ~5s of them hitting Supabase.
    if (rawTs && !isNaN(new Date(rawTs).getTime())) {
      const ageMin = Math.round((Date.now() - new Date(rawTs).getTime()) / 60000);
      console.log(`[Webhook] message age at receipt: ${ageMin} min (sent ${rawTs})`);
    } else {
      console.log('[Webhook] no usable timestamp in payload — cannot measure delivery delay');
    }

    // STOP / opt-out detection (SPAM Act). Single-word commands or explicit
    // phrases only, so "please stop by anytime" doesn't trigger it.
    let inboundStatus = 'received';
    const trimmed = String(message).trim();
    if (/^(stop|unsubscribe|opt[ -]?out)[\s.!]*$/i.test(trimmed) ||
        /\bunsubscribe\b/i.test(trimmed) ||
        /\b(do not (contact|text|message)( me)?|remove me from)\b/i.test(trimmed)) {
      inboundStatus = 'optout';
    } else if (/^(start|unstop|resubscribe|opt[ -]?in)[\s.!]*$/i.test(trimmed)) {
      inboundStatus = 'optin';
    }

    const supaHeaders = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    };

    // De-dup: Sync (inbox/export) re-fires webhooks for messages we already
    // have. Skip the insert if this SMS Gate message id is already stored.
    if (messageId) {
      try {
        const dupRes = await fetch(
          `${SUPABASE_URL}/rest/v1/sms_messages?sms_gate_id=eq.${encodeURIComponent(messageId)}&direction=eq.inbound&select=id&limit=1`,
          { headers: supaHeaders }
        );
        const dups = await dupRes.json().catch(() => []);
        if (Array.isArray(dups) && dups.length) {
          return res.status(200).json({ success: true, duplicate: true });
        }
      } catch (e) { console.error('[Webhook] dup-check failed (continuing):', e.message); }
    }

    // The insert MUST be verified — returning 200 on a failed insert tells
    // SMS Gate the message was delivered and it is silently lost forever.
    // A non-2xx response makes SMS Gate retry the webhook.
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { ...supaHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        phone_number: phoneNumber,
        message,
        direction: 'inbound',
        status: inboundStatus,
        sms_gate_id: messageId,
        created_at: receivedAt,
      }),
    });

    if (!insRes.ok) {
      const detail = await insRes.text();
      console.error('[Webhook] Supabase insert FAILED', insRes.status, detail);
      return res.status(500).json({ error: 'Database insert failed', status: insRes.status, detail });
    }

    // Email the team a copy of every new inbound SMS (best-effort). This runs only
    // for genuinely new messages — duplicates from Sync/inbox-export return above,
    // so it never re-emails. An email failure must NOT fail the webhook, or SMS
    // Gate would retry and we'd double-save, so it's fully wrapped in try/catch.
    try {
      const hostingerMailboxResourceId = process.env.HOSTINGER_MAILBOX_RESOURCE_ID;
      const hostingerMailApiToken = process.env.HOSTINGER_MAIL_API_TOKEN;
      if (hostingerMailboxResourceId && hostingerMailApiToken) {
        const htmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const receivedLocal = new Date(receivedAt).toLocaleString('en-AU', {
          timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short',
        });
        const portalUrl = 'https://portal.goldsure.com.au/sms/';
        const isOut = inboundStatus === 'optout';
        const isIn  = inboundStatus === 'optin';
        const accent = isOut ? '#ea5455' : isIn ? '#28c76f' : '#7367f0';
        const statusNote = isOut ? 'Replied STOP — sending to this number is now blocked.'
                         : isIn  ? 'Replied START — this number has re-subscribed.'
                         : '';
        // Best-effort customer name from GHL (bounded; falls back to the number).
        const customerName = await ghlNameForPhone(phoneNumber);
        const who = customerName || phoneNumber;
        const subject = isOut ? `SMS opt-out (STOP) from ${who}`
                      : isIn  ? `SMS opt-in (START) from ${who}`
                      :         `New SMS from ${who}`;
        const receivedTime = new Date(receivedAt).toLocaleString('en-AU', {
          timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit', hour12: true,
        });
        const preheader = String(message).replace(/\s+/g, ' ').trim().slice(0, 110);
        const messageHtml = htmlEsc(message).replace(/\n/g, '<br>');
        const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
        const html = `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}img{-ms-interpolation-mode:bicubic;border:0;}</style>
</head>
<body style="margin:0;padding:0;background-color:#eceef3;" bgcolor="#eceef3">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;font-size:1px;line-height:1px;color:#eceef3;">${htmlEsc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eceef3" style="background-color:#eceef3;"><tr><td align="center" style="padding:40px 16px;">
    <!--[if mso]><table role="presentation" align="center" width="480" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;">

      <tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e4e6ee;border-radius:18px;box-shadow:0 12px 30px rgba(60,55,110,.14);padding:18px 20px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="32" valign="middle" style="vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td width="30" height="30" align="center" valign="middle" bgcolor="${accent}" style="width:30px;height:30px;background-color:${accent};border-radius:9px;text-align:center;vertical-align:middle;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td width="14" height="11" bgcolor="#ffffff" style="width:14px;height:11px;background-color:#ffffff;border-radius:4px 4px 4px 0;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>
              </td>
            </tr></table>
          </td>
          <td valign="middle" style="vertical-align:middle;padding-left:10px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:.5px;text-transform:uppercase;color:#9094a3;">Goldsure SMS</td>
          <td valign="middle" align="right" style="vertical-align:middle;text-align:right;font-family:${FONT};font-size:11px;color:#b4b8c4;">${htmlEsc(receivedTime)}</td>
        </tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-top:14px;font-family:${FONT};">
          <div style="font-size:16px;line-height:20px;font-weight:bold;color:#1c1c2b;padding-bottom:${customerName ? '1px' : '4px'};">${htmlEsc(who)}</div>
          ${customerName ? `<div style="font-size:12px;line-height:15px;color:#9094a3;padding-bottom:6px;">${htmlEsc(phoneNumber)}</div>` : ''}
          <div style="font-size:15px;line-height:22px;color:#4a4d5e;word-break:break-word;">${messageHtml}</div>
          ${statusNote ? `<div style="font-size:12px;line-height:17px;font-weight:bold;color:${accent};padding-top:12px;">${htmlEsc(statusNote)}</div>` : ''}
        </td></tr></table>
      </td></tr>

      <tr><td height="22" style="height:22px;line-height:22px;font-size:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>

      <tr><td align="center">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${portalUrl}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="26%" stroke="f" fillcolor="${accent}">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:${FONT};font-size:14px;font-weight:bold;">Open SMS Portal &#8594;</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="${portalUrl}" style="display:inline-block;background-color:${accent};border-radius:12px;padding:13px 32px;font-family:${FONT};font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">Open SMS Portal &#8594;</a>
        <!--<![endif]-->
      </td></tr>

      <tr><td height="14" style="height:14px;line-height:14px;font-size:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>

      <tr><td align="center" style="font-family:${FONT};font-size:11px;line-height:16px;color:#a3a7b5;">Received ${htmlEsc(receivedLocal)} &middot; Melbourne time</td></tr>

    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`;
        const text = `New SMS from ${who}${customerName ? ' (' + phoneNumber + ')' : ''}\n${receivedLocal} (Melbourne time)\n\n${message}\n${statusNote ? '\n' + statusNote + '\n' : ''}\nReply in the portal: ${portalUrl}`;
        // Bound the email so it can never delay the webhook's 200 ACK to SMS Gate
        // (the message is already saved above; email is best-effort).
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        let mailRes;
        try {
          mailRes = await fetch(
            `https://api.mail.hostinger.com/api/v1/mailboxes/${encodeURIComponent(hostingerMailboxResourceId)}/send`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${hostingerMailApiToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: ['vignesh@goldsure.com.au', 'david@goldsure.com.au'],
                displayName: 'Goldsure SMS',
                subject,
                html,
                text,
              }),
              signal: ctrl.signal,
            }
          );
        } finally {
          clearTimeout(timer);
        }
        if (!mailRes.ok) console.error('[Webhook] notify email failed:', mailRes.status, await mailRes.text());
      } else {
        console.warn('[Webhook] Hostinger Mail API credentials not set — inbound email notification skipped');
      }
    } catch (e) {
      console.error('[Webhook] notify email error (continuing):', e.message);
    }

    return res.status(200).json({ success: true });
  }

  // ── POST legacy: battery callback form ─────────────────────────────────────
  // Detected by fullName field – same contract as before, no changes to the form.
  if (body.fullName !== undefined) {
    const { fullName, phone, email, address } = body;
    if (!fullName || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const submittedAt = new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const htmlMessage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Call Back Request</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f6f8;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">
        <tr><td style="background-color:#ffffff;padding:20px 32px;border-bottom:3px solid #b08d2e;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg" alt="Goldsure" height="34" style="display:block;height:34px;" /></td>
            <td align="right" style="font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#6b7899;">Solar Battery</td>
          </tr></table>
        </td></tr>
        <tr><td style="background-color:#ffffff;padding:32px 32px 0;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;">
          <p style="margin:0 0 6px;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">New Lead - Solar Battery</p>
          <h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#141c2e;line-height:1.3;">Call back request from ${fullName.split(' ')[0]}</h1>
          <p style="margin:0 0 24px;font-size:13px;color:#6b7899;line-height:1.6;">Submitted via the Goldsure Solar Battery form. Please follow up as soon as possible.</p>
        </td></tr>
        <tr><td style="background-color:#ffffff;padding:0 32px 8px;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;width:36%;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Full Name</p></td>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;"><p style="margin:0;font-size:14px;font-weight:700;color:#141c2e;">${fullName}</p></td>
            </tr>
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Phone</p></td>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;"><p style="margin:0;font-size:14px;font-weight:700;color:#141c2e;"><a href="tel:${phone}" style="color:#141c2e;text-decoration:none;">${phone}</a></p></td>
            </tr>
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Email</p></td>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;"><p style="margin:0;font-size:14px;color:#141c2e;">${email ? `<a href="mailto:${email}" style="color:#b08d2e;text-decoration:none;">${email}</a>` : '<span style="color:#aaaaaa;">Not provided</span>'}</p></td>
            </tr>
            <tr>
              <td style="padding:14px 18px;background-color:#f5f6f8;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Property Address</p></td>
              <td style="padding:14px 18px;background-color:#ffffff;"><p style="margin:0;font-size:14px;color:#141c2e;">${address || '<span style="color:#aaaaaa;">Not provided</span>'}</p></td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="background-color:#ffffff;padding:24px 32px 32px;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;border-bottom:1px solid #e3e7ef;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background-color:#141c2e;border-radius:8px;">
              <a href="tel:${phone}" style="display:inline-block;padding:14px 32px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;">&#128222;&nbsp;Call ${fullName.split(' ')[0]} Now</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:14px 32px;background-color:#f5f6f8;border:1px solid #e3e7ef;border-top:none;"><p style="margin:0;font-size:11px;color:#aaaaaa;">Submitted: ${submittedAt}</p></td></tr>
        <tr><td style="padding:20px 32px;text-align:center;"><p style="margin:0;font-size:11px;color:#aaaaaa;">Goldsure Pty Ltd &nbsp;&middot;&nbsp; info@goldsure.com.au &nbsp;&middot;&nbsp; 03 7050 2846</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      await sendHostingerMail({
        displayName: 'Goldsure Leads',
        to: ['info@goldsure.com.au'],
        subject: `New Call Back Request - ${fullName}`,
        html: htmlMessage,
        text: `New Callback: ${fullName} | ${phone} | ${email || 'no email'} | ${address || 'no address'} | ${submittedAt}`,
      });
    } catch (error) {
      console.error('[Hostinger] callback email failed:', error.message);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({
    error: 'Unknown request.',
    help: 'Use action=send, action=webhook, or POST {fullName,phone} for battery callback.',
  });
}
