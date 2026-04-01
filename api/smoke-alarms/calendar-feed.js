export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { electrician } = req.query;
  if (!electrician) {
    return res.status(400).send('Missing electrician parameter.');
  }

  const slug = String(electrician).toLowerCase().trim();

  try {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://yxgdixwneprhjxzdlaqw.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_94nQfItNfgNZZc2P1Slb1Q_ECjCmu47';

    const response = await fetch(`${supabaseUrl}/rest/v1/electrician_calendar?select=*`, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch from Database');
    }

    const data = await response.json();
    
    // Filter events for the requested electrician
    const events = data.filter(e => {
        const raw = (e.electrician || '').toLowerCase();
        // Ignore general availability entries
        if (raw.startsWith('avail:') || raw.startsWith('unavail:')) return false;
        
        const bookingSlug = raw.replace(/^\[\d+(?:\|\d+)?\]\s*/, '').trim().split(' ')[0];
        return bookingSlug === slug;
    });

    let icsContent = 'BEGIN:VCALENDAR\r\n';
    icsContent += 'VERSION:2.0\r\n';
    icsContent += 'PRODID:-//Goldsure//Electrician Calendar//EN\r\n';
    icsContent += `X-WR-CALNAME:Goldsure - ${slug}\r\n`;

    const now = new Date();
    const dtstamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    events.forEach(ev => {
      // Create a unique deterministic UID per assignment
      const uidDate = String(ev.work_date).replace(/-/g, '');
      const uid = `${uidDate}-${slug}@goldsure.com.au`;

      // Event is ALL-DAY
      const dtstart = uidDate;
      const dttime = new Date(ev.work_date);
      dttime.setDate(dttime.getDate() + 1);
      const dtend = dttime.toISOString().split('T')[0].replace(/-/g, '');

      icsContent += 'BEGIN:VEVENT\r\n';
      icsContent += `UID:${uid}\r\n`;
      icsContent += `DTSTAMP:${dtstamp}\r\n`;
      icsContent += `DTSTART;VALUE=DATE:${dtstart}\r\n`;
      icsContent += `DTEND;VALUE=DATE:${dtend}\r\n`;
      icsContent += `SUMMARY:Goldsure Bookings\r\n`;
      icsContent += `DESCRIPTION:You have bookings assigned for this date via Goldsure.\r\n`;
      icsContent += 'END:VEVENT\r\n';
    });

    icsContent += 'END:VCALENDAR\r\n';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goldsure-${slug}.ics"`);
    res.setHeader('Cache-Control', 'max-age=0, s-maxage=3600, stale-while-revalidate');
    res.status(200).send(icsContent);

  } catch (err) {
    console.error('ICS Feed Error:', err);
    res.status(500).send('Internal Server Error generating Calendar feed.');
  }
}
