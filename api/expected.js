// Vercel serverless function: fetches a bustimes.org stop page server-side
// and reads off the Scheduled/Expected time for the nearest upcoming X20
// (or X21) departure — the exact same number already shown on their page,
// nothing computed or guessed here.
//
// Important honesty note: this was built against a markdown-rendered proxy
// of bustimes.org's page (fetched via a research tool), not the actual raw
// HTML source — I could not directly inspect bustimes.org's real markup
// while building this. The parsing below is a reasonable structural guess
// (look for a table row starting with "X20"/"X21", then take the first two
// HH:MM-shaped values in that row as scheduled/expected) rather than
// something verified against their real page. It's designed to fail safely:
// if bustimes.org's actual structure doesn't match, this returns
// found:false rather than a wrong number — but it may well need a real
// adjustment once tried against the live site.

const { load } = require("cheerio");

export default async function handler(req, res) {
  const { stop } = req.query;
  if (!stop) {
    res.status(400).json({ error: "stop query param is required" });
    return;
  }

  const url = `https://bustimes.org/stops/${encodeURIComponent(stop)}`;

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "x20-launcher/1.0 (personal use, single stop lookup)" },
    });
    if (!upstream.ok) {
      res.status(200).json({ found: false, reason: `upstream HTTP ${upstream.status}` });
      return;
    }
    const html = await upstream.text();
    const $ = load(html);

    let scheduled = null;
    let expected = null;
    let found = false;

    $("table tr").each((_, row) => {
      if (found) return;
      const $row = $(row);
      const firstCellText = $row.find("td").first().text().trim();
      if (!/^X2[01]$/i.test(firstCellText)) return;

      const timeTexts = [];
      $row.find("td").each((__, cell) => {
        const t = $(cell).text().trim();
        if (/^\d{1,2}:\d{2}$/.test(t)) timeTexts.push(t);
      });

      if (timeTexts.length >= 1) {
        scheduled = timeTexts[0];
        expected = timeTexts.length >= 2 ? timeTexts[1] : null;
        found = true;
      }
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      found,
      scheduled,
      // Only worth showing if it's a genuine, different prediction —
      // the caller decides whether to display it.
      expected: expected && expected !== scheduled ? expected : null,
    });
  } catch (err) {
    res.status(200).json({ found: false, reason: err.message });
  }
}
