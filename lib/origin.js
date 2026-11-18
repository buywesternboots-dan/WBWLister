// Where the listing says the boot was made. The place is kept as written.
// A brand name is not a place. Shipping and the seller's own location are not origin.
const MADE = /\b(?:hand[\s-]?made|hecho|manufactured|crafted|produced|built|made)\s+(?:en|in)(?:\s+the)?\s+(.+?)(?=[.!?](?:\s|$)|$)/i;
const STOP = /\b(?:size|price|colou?r|cowboy|boots?|men(?:'s)?|women(?:'s)?|kids)\b|\$|\b(?:19|20)\d{2}\b/i;
const COMMA = /(?:^|[\s(])([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2}),\s*([A-Za-z][A-Za-z.' ]{1,40})/;

function scrub(line) {
  return line
    .replace(/\b(?:ships?|shipping|shipped)\s+from\s+[^.,;\n]+/gi, ' ')
    .replace(/\b(?:located|based)\s+in\s+[^.,;\n]+/gi, ' ')
    .replace(/\bseller(?:'s)?\s+(?:location|is\s+in|in)\s*[:\-]?\s*[^.,;\n]+/gi, ' ');
}

function tidy(s) {
  return String(s ?? '').replace(/\s+/g, ' ').replace(/[,\s;:]+$/g, '').trim();
}

// made: a "made in / hecho en" phrase. commas: "City, Place" phrases, unchecked until
// the caller keeps one whose second part is a real place.
export function readOrigin(text) {
  const made = [];
  const commas = [];
  for (const raw of String(text ?? '').split(/\n/)) {
    const line = scrub(raw);
    const hit = line.match(MADE);
    if (hit) {
      let rest = tidy(hit[1]);
      const stop = rest.search(STOP);
      if (stop > 0) rest = tidy(rest.slice(0, stop));
      if (rest && !/^(?:19|20)\d{2}$/.test(rest) && !/^\d/.test(rest)) made.push(rest);
    }
    if (/\b(?:ship|located|based|seller)\b/i.test(raw)) continue;
    const comma = line.match(COMMA);
    if (comma && !/\d/.test(comma[1]) && comma[1].trim().split(/\s+/).length <= 3)
      commas.push(`${comma[1].trim()}, ${tidy(comma[2])}`);
  }
  return { made: made[0] || null, commas };
}
