// Multi-purpose handler: SMS Gateway (send/receive/history) + legacy battery callback email
// Stays within the Vercel Hobby 12-function limit by reusing this file.
//
// Routes:
//   GET  ?phone=+61...                  → conversation history for that number
//   GET  (no phone)                     → contacts list (last message per number)
//   POST { action:'send', phone, message }  → send SMS via SMS Gate cloud API
//   POST { action:'webhook', ... }      → receive inbound SMS (webhook from SMS Gate)
//   POST { fullName, phone, ... }       → legacy battery callback email (unchanged)

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

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
    const s = String(raw || '').replace(/[\s\-().]/g, '');
    if (/^04\d{8}$/.test(s)) return '+61' + s.slice(1);
    if (/^614\d{8}$/.test(s)) return '+' + s;
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
            await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?sms_gate_id=eq.${encodeURIComponent(id)}&direction=eq.outbound&status=neq.${newStatus}`, {
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
        if (st === 'note' || st === 'cancelled' || st === 'scheduled' || st === 'sending') continue;
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

    // Fire all past-due scheduled messages across every phone (used by the bulk
    // send poller in the UI so messages fire even without opening each conversation).
    if (req.query.action === 'fire-scheduled') {
      const ah = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
      const schedRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?status=eq.scheduled&select=id,phone_number,message,sms_gate_id&order=created_at.asc&limit=10`,
        { headers: ah }
      );
      const all = await schedRes.json().catch(() => []);
      const pastDue = (Array.isArray(all) ? all : []).filter(m => {
        if (!m.sms_gate_id || !m.sms_gate_id.startsWith('sched:')) return false;
        const ts = new Date(m.sms_gate_id.slice(6, 32));
        return !isNaN(ts) && ts <= new Date();
      });

      const user = process.env.SMSGATE_USERNAME;
      const pass = process.env.SMSGATE_PASSWORD;
      let fired = 0;
      if (user && pass) {
        const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
        for (const m of pastDue) {
          if (await isOptedOut(m.phone_number)) {
            await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}`, {
              method: 'PATCH',
              headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
              body: JSON.stringify({ status: 'cancelled' }),
            });
            continue;
          }
          const claimRes = await fetch(
            `${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}&status=eq.scheduled`,
            { method: 'PATCH', headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify({ status: 'sending' }) }
          );
          const claimed = await claimRes.json().catch(() => []);
          if (!Array.isArray(claimed) || !claimed.length) continue;
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
            if (smsRes.ok) fired++;
          } catch {}
        }
      }

      // Total remaining scheduled (so the UI knows when it's done)
      const remRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?status=eq.scheduled&select=id&limit=1000`,
        { headers: ah }
      );
      const remRows = await remRes.json().catch(() => []);
      return res.status(200).json({ fired, remaining: Array.isArray(remRows) ? remRows.length : 0 });
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
      const pipelineId = String(req.query.pipelineId || '').trim();
      const apiKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (!stageId) return res.status(200).json({ error: 'stageId required' });
      if (!apiKey || !locationId) return res.status(200).json({ error: 'GHL not configured on server — set GHL_API_KEY and GHL_LOCATION_ID in Vercel' });
      const ghlHeaders = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
      try {
        const r = await fetch(
          `https://services.leadconnectorhq.com/opportunities/search?location_id=${encodeURIComponent(locationId)}${pipelineId ? '&pipeline_id=' + encodeURIComponent(pipelineId) : ''}&pipeline_stage_id=${encodeURIComponent(stageId)}&status=open&limit=100`,
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
        const opportunities = ((data && data.opportunities) || [])
          .filter(opp => {
            if (!pipelineId) return true;
            const oppPipelineId = opp.pipelineId || opp.pipeline_id || (opp.pipeline && opp.pipeline.id) || '';
            return oppPipelineId === pipelineId;
          });
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
      // Conversation thread for one number
      const supaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}&order=created_at.asc&limit=300`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await supaRes.json();
      const messages = Array.isArray(rows) ? rows : [];

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
    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,message,direction,created_at,status&order=created_at.desc&limit=500`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await supaRes.json();
    const seen = new Set();
    const contacts = (Array.isArray(rows) ? rows : []).filter(r => {
      if (r.status === 'note' || r.status === 'cancelled') return false;
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
    const days  = Math.min(parseInt(body.days, 10) || 3, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
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

    if (!phones.length || !msgTpl) return res.status(400).json({ error: 'phones and message required' });

    const ah = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
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
        headers: { ...ah, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ phone_number: phone, message: text, direction: 'outbound', status: 'scheduled', sms_gate_id: 'sched:' + fireAt }),
      });
      results.push({ phone, status: r.ok ? 'scheduled' : 'error', fireAt });
      if (r.ok) slot++;
    }
    return res.status(200).json({ results });
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

  // ── POST action=update-stage: move a GHL opportunity to another stage ───────
  if (body.action === 'update-stage') {
    const { opportunityId, pipelineId, stageId } = body;
    if (!opportunityId || !stageId) return res.status(400).json({ error: 'opportunityId and stageId required' });
    const apiKey = process.env.GHL_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GHL not configured' });
    const r = await fetch(`https://services.leadconnectorhq.com/opportunities/${encodeURIComponent(opportunityId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineId, pipelineStageId: stageId }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[GHL update-stage]', r.status, detail);
      return res.status(502).json({ error: 'GHL rejected the stage update', detail });
    }
    return res.status(200).json({ success: true });
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
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}`,
      { method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' } }
    );
    if (!delRes.ok && delRes.status !== 204) {
      const detail = await delRes.text();
      console.error('[Delete thread] failed', delRes.status, detail);
      return res.status(502).json({ error: 'Delete failed', detail });
    }
    return res.status(200).json({ success: true });
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
    let receivedAt = p.receivedAt || p.timestamp || p.date;
    if (!receivedAt || isNaN(new Date(receivedAt).getTime())) {
      receivedAt = new Date().toISOString();
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

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Goldsure Leads <vignesh@goldsure.com.au>',
        to: ['info@goldsure.com.au'],
        subject: `New Call Back Request - ${fullName}`,
        html: htmlMessage,
        text: `New Callback: ${fullName} | ${phone} | ${email || 'no email'} | ${address || 'no address'} | ${submittedAt}`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Resend] callback email failed:', errorText);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({
    error: 'Unknown request.',
    help: 'Use action=send, action=webhook, or POST {fullName,phone} for battery callback.',
  });
}
