// Shared vocabulary (server + inventory page): brands, materials, field suggestions, search synonyms. Add entries freely.

// Brands: [name as shown, spellings sellers use (regex), family]. A family groups names of the same maker, so a search
// for any of them finds all (e.g. "Rios" → Rios of Mercedes, Rios of Raymondville, Armando's).
export const BRANDS = [
  ['Rios of Mercedes', 'rios (of|de) mercedes', 'Rios'], ['Rios of Raymondville', 'rios (of|de) raymondville', 'Rios'], ["Armando's", "armando['’]?s?", 'Rios'],
  ['Tres Outlaws', 'tres outlaws', 'Tres Outlaws'], ['Falconhead', 'falcon ?head', 'Tres Outlaws'],
  ['Lucchese', 'lucchese'], ['Tony Lama', 'tony lama'], ['Justin', 'justin'], ['Black Jack', 'black ?jack'], ['El Dorado', 'el dorado'],
  ['Montana', 'montana'], ['Ariat', 'ariat'], ['Dan Post', 'dan post'], ['Boulet', 'boulet'], ['Old Gringo', 'old gringo'], ['Corral', 'corral'],
  ['Durango', 'durango'], ['Nocona', 'nocona'], ['Laredo', 'laredo'], ['Abilene', 'abilene'], ['Anderson Bean', 'anderson bean'],
  ['Twisted X', 'twisted x'], ['Frye', 'frye'], ['Laramie', 'laramie'], ['T.O. Stanley', 't\\.? ?o\\.? stanley'], ['Stetson', 'stetson'],
  ['Larry Mahan', 'larry mahan'], ['Tecovas', 'tecovas'], ['Rocketbuster', 'rocketbuster'], ['Carlos Lujan', 'carlos lujan'], ['Olathe', 'olathe'],
  ['Hyer', 'hyer'], ['Ferrini', 'ferrini'], ['Los Altos', 'los altos'], ['Cuadra', 'cuadra'], ['Caborca', 'caborca'], ['Chisos', 'chisos'],
  ['Charlie 1 Horse', 'charlie (1|one) horse'], ['Paul Bond', 'paul bond'], ['M.L. Leddy', 'leddy'], ['J.B. Hill', 'j\\.? ?b\\.? hill'],
  ['Stallion', 'stallion'], ['Liberty', 'liberty boots?'], ['Sanders', 'sanders'], ['Mercedes', 'mercedes'], ['Cowtown', 'cowtown'], ['Dingo', 'dingo'],
  ['Sendra', 'sendra'], ['Acme', 'acme'], ['Texas Boot Co.', 'texas boot( co\\.?| company)?'],
  // custom and small western bootmakers
  ['El Malcreado', 'el malcreado'], ['Fenoglio', 'fenoglio'], ['Kimmel', 'kimmel'], ['Olsen-Stelzer', 'olsen[- ]?stelzer'],
  ["Little's", "little['’]?s( boot(s| co\\.?| company)?)"], ['Willie Lusk', 'willie lusk'], ['Carl Chappell', 'carl chappell'],
  ['Rusty Franklin', 'rusty franklin'], ['Charlie Dunn', 'charlie dunn'], ['Tex Robbins', 'tex robbins'], ['Rodney Ammons', '(rodney )?ammons'],
  ['Carlos Hernandez', 'carlos hernandez'], ['Ray Jones', 'ray jones'], ['Back at the Ranch', 'back at the ranch'],
  ['Lone Star', 'lone star boots?'], ['Hondo', 'hondo boots?'], ['Johnny Ringo', 'johnny ringo'], ['Double H', 'double[- ]?h boots?'],
  ['Old West', 'old west boots?'], ['Smoky Mountain', 'smoky mountain'],
].map(([name, alias, family]) => ({ name, re: new RegExp(`\\b(${alias})\\b`, 'i'), family: family ?? name }));

// Materials: [name as shown, names sellers use, exotic?, family]. Longer names win, so "caiman lizard" is never read as
// "caiman" or "lizard", and "hornback lizard"/"HBL" read as Caiman Lizard. A family groups the kinds of one skin for
// search ("ostrich" finds Full Quill Ostrich too) — Caiman Lizard is its own family, not caiman and not lizard.
export const MATERIALS = [
  ['Caiman Lizard', ['caiman lizard', 'hornback lizard', 'hbl'], true], ['Caiman Belly', ['caiman belly'], true, 'Caiman'],
  ['Hornback Caiman', ['hornback caiman', 'caiman hornback'], true, 'Caiman'], ['Caiman', ['caiman'], true],
  ['Full Quill Ostrich', ['full quill ostrich', 'full-quill ostrich', 'fq ostrich', 'full quill'], true, 'Ostrich'],
  ['Smooth Ostrich', ['smooth ostrich'], true, 'Ostrich'], ['Ostrich Leg', ['ostrich leg'], true, 'Ostrich'], ['Ostrich', ['ostrich'], true], ['Alligator', ['alligator', 'gator'], true], ['Crocodile', ['crocodile', 'croc'], true],
  ['Teju Lizard', ['teju lizard', 'tegu lizard', 'teju', 'tegu'], true, 'Lizard'], ['Ring Lizard', ['ring lizard'], true, 'Lizard'], ['Lizard', ['lizard'], true],
  ['Python', ['python'], true], ['Snake', ['rattlesnake', 'sea snake', 'snake'], true], ['Eel', ['eel'], true], ['Stingray', ['stingray', 'shagreen'], true],
  ['Shark', ['shark'], true], ['Hippo', ['hippopotamus', 'hippo'], true], ['Elephant', ['elephant'], true], ['Sea Turtle', ['sea turtle', 'turtle'], true],
  ['Anteater', ['anteater'], true], ['Bullfrog', ['bullfrog', 'frog'], true], ['Toad', ['toad'], true], ['Bison', ['bison', 'buffalo'], true],
  ['Kangaroo', ['kangaroo'], true], ['Peccary', ['peccary'], true],
  ['Goat', ['goat'], false], ['Calf', ['calfskin', 'calf'], false], ['Cowhide', ['cowhide'], false], ['Suede', ['suede'], false],
  ['Roughout', ['roughout', 'rough out'], false], ['Leather', ['leather'], false],
].map(([name, aliases, exotic, family]) => ({ name, aliases, exotic, family: family ?? name }));

const aliasRe = list => new RegExp(`\\b(${list.flatMap(m => m.aliases).sort((a, b) => b.length - a.length).map(a => a.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|')})\\b`, 'i');
const EXOTIC_RE = aliasRe(MATERIALS.filter(m => m.exotic)), PLAIN_RE = aliasRe(MATERIALS.filter(m => !m.exotic));
const byAlias = a => MATERIALS.find(m => m.aliases.includes(a.toLowerCase()));
// The material named in a text (exotics first), or undefined.
export const findMaterial = text => byAlias(text.match(EXOTIC_RE)?.[1] ?? text.match(PLAIN_RE)?.[1] ?? '__');
export const findBrand = text => BRANDS.find(b => b.re.test(text));
// A brand as a source wrote it → known maker's standard name, "Unbranded", "Custom", or as written.
export const brandName = b => findBrand(b)?.name
  ?? (/^\s*(un-?branded|no ?brand|none|unknown|other|n\/a)\s*$/i.test(b) ? 'Unbranded' : /custom|unknown (boot)?maker/i.test(b) ? 'Custom' : b.trim());

// Suggestions for the edit form. Every field still accepts anything typed.
export const CHOICES = {
  brand: [...BRANDS.map(b => b.name), 'Unbranded', 'Custom'], material: MATERIALS.map(m => m.name),
  material_type: ['Exotic', 'Leather', 'Synthetic', 'Fabric'], sized_for: ['Men', 'Women', 'Kids'],
  width: ['M', 'A', 'B', 'C', 'D', 'E', 'EE', 'EEE', 'W'], condition: ['New', 'Broken In'], size: ['Estimated'],
  toe: ['Snip toe', 'Square toe', 'Round toe', 'Medium round toe', 'Broad square toe', 'J toe', 'R toe', 'Cutter toe', 'Roper toe', 'Needle toe', 'Pointed toe', '7 toe', '5 toe', '3 toe'],
  heel: ['Riding heel', 'Walking heel', 'Roper heel', 'Cuban heel', 'Stockman heel', 'Underslung heel', 'Block heel', 'Dogger heel'],
  sole: ['Leather', 'Leather, pegged', 'Rubber', 'Crepe', 'Lug', 'Vibram', 'Composite'],
};

// Search: a term matching a brand family or a material's names also finds the related names.
export function searchMatch(item, q) {
  q = q.trim().toLowerCase();
  if (!q) return true;
  const text = [item.title, item.brand, item.material, item.description].join(' \n').toLowerCase();
  const fam = BRANDS.find(b => b.re.test(q) || b.family.toLowerCase() === q)?.family;
  if (fam) return BRANDS.some(b => b.family === fam && (item.brand === b.name || b.re.test(text)));
  // A material: a family name ("ostrich") finds every kind; a specific kind ("full quill ostrich", "hbl") finds just that.
  // Items without a recognised material fall back to the listing text.
  const mat = byAlias(q), has = MATERIALS.find(m => m.name === item.material);
  if (mat && has) return mat.name === mat.family ? has.family === mat.family : has.name === mat.name;
  return text.includes(q);
}
