import { writeFileSync } from 'node:fs';

const TIERS = {
  bronze: { hi: '#EDB889', lo: '#8C5327', text: '#F4CFAE' },
  silver: { hi: '#F4F6F8', lo: '#86919D', text: '#E6EAEE' },
  gold: { hi: '#FFE07A', lo: '#B07F08', text: '#FFE39A' },
  ruby: { hi: '#FF8FA6', lo: '#8E0E2C', text: '#FFC4CF' },
};
const INK = '#16191D', GREEN = '#2E7D32', GREY = '#BDBDBD';

const shapes = {
  circle: (r) => `<circle cx="60" cy="60" r="${r}"/>`.replace('/>', ' FILL/>'),
  hex: (r) => {
    const pts = [...Array(6)].map((_, k) => {
      const a = ((-90 + 60 * k) * Math.PI) / 180;
      return `${(60 + r * Math.cos(a)).toFixed(1)},${(60 + r * Math.sin(a)).toFixed(1)}`;
    });
    return `<polygon points="${pts.join(' ')}" FILL/>`;
  },
  shield: (r) => {
    const s = r / 56, t = (x, y) => `${(60 + (x - 60) * s).toFixed(1)} ${(60 + (y - 60) * s).toFixed(1)}`;
    return `<path d="M${t(60, 4)} L${t(108, 17)} L${t(108, 57)} C${t(108, 88)} ${t(86, 106)} ${t(60, 116)} C${t(34, 106)} ${t(12, 88)} ${t(12, 57)} L${t(12, 17)} Z" FILL/>`;
  },
};

function badge({ id, shape, tier, label, icon, title, pips, tag }) {
  const T = TIERS[tier], g = `g-${id}`;
  const outer = shapes[shape](57).replace('FILL', `fill="url(#${g})"`);
  const inner = shapes[shape](48).replace('FILL', `fill="${INK}"`);
  const rim = shapes[shape](44.5).replace('FILL', `fill="none" stroke="${T.text}" stroke-opacity=".35" stroke-width="1"`);
  const pipRow = pips
    ? [...Array(4)].map((_, i) => `<circle cx="${48 + i * 8}" cy="72" r="2.4" fill="${i < pips ? T.text : 'none'}" stroke="${T.text}" stroke-width="1"/>`).join('')
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${title}">
<title>${title}</title>
<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.hi}"/><stop offset="1" stop-color="${T.lo}"/></linearGradient></defs>
${outer}${inner}${rim}
<g font-family="Rubik, system-ui, sans-serif" font-weight="700" text-anchor="middle">
${tag ? `<text x="60" y="${shape === 'shield' ? 31 : 34}" font-size="7.5" letter-spacing="1" fill="${T.text}">${tag}</text>` : ''}
${icon(T)}
${pipRow}
<text x="60" y="${shape === 'shield' ? 90 : shape === 'hex' ? 85 : 93}" font-size="${label.length > 8 ? 7.5 : 9.5}" letter-spacing="1.2" fill="${T.text}">${label}</text>
</g></svg>`;
}

// Difficulty icons echo each difficulty's own history line.
const bubble = (x, fill, extra = '') => `<circle cx="${x}" cy="52" r="7.5" fill="${fill}" ${extra}/>`;
const score = (n) => `<text x="91" y="56.5" font-size="13" fill="#fff">– ${n}</text>`;
const diff = {
  medium: () => bubble(29, GREEN) + bubble(47, GREY) + bubble(65, INK, 'stroke="#fff" stroke-width="1.5"') + score(2),
  hard: () => [29, 47, 65].map((x) => bubble(x, INK, 'stroke="#fff" stroke-width="1.5"')).join('') + score(2),
  extreme: () => [29, 47, 65].map((x) => bubble(x, 'none', 'stroke="#fff" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="3 2.6"')).join('') + score(3),
};

const stopwatch = (T) => `<g transform="translate(0 -5)" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round">
<circle cx="60" cy="52" r="15"/><path d="M60 52 L60 43"/><path d="M60 52 L66 56"/><path d="M55 33 H65"/><path d="M60 33 V37"/><path d="M72 39 L75 36"/></g>`;

const list = [];
const MODES = [['solo', 'SOLO', 'Solve a single-player word'], ['cpu', 'VS CPU', 'Beat the computer']];
for (const [m, tag, verb] of MODES) {
  for (const [key, tier, name] of [['medium', 'bronze', 'MEDIUM'], ['hard', 'silver', 'HARD'], ['extreme', 'gold', 'EXTREME']]) {
    list.push({ group: `Difficulty · ${tag === 'SOLO' ? 'single player' : 'vs. computer'}`, id: `${m}-${key}`, shape: 'circle', tier, tag, label: name, icon: diff[key], title: `${verb} at ${name[0] + name.slice(1).toLowerCase()}` });
  }
}
for (const [key, tier, name, pips] of [['casual', 'bronze', 'CASUAL', 1], ['skilled', 'silver', 'SKILLED', 2], ['expert', 'gold', 'EXPERT', 3], ['mastermind', 'ruby', 'MASTERMIND', 4]]) {
  list.push({ group: 'Finish a Rush at each level', id: `rush-${key}`, shape: 'hex', tier, label: name, icon: stopwatch, pips, title: `Finish a Rush at ${name[0] + name.slice(1).toLowerCase()} level` });
}
for (const [m, tag, verb] of MODES) {
  for (const [n, tier] of [[20, 'bronze'], [15, 'silver'], [10, 'gold']]) {
    list.push({ group: `Few guesses · ${tag === 'SOLO' ? 'single player' : 'vs. computer'}`, id: `${m}-guesses-${n}`, shape: 'shield', tier, tag, label: 'GUESSES', title: `${verb} in ${n} guesses or fewer`,
      icon: () => `<text x="60" y="66" font-size="28" fill="#fff" letter-spacing="-1">≤${n}</text>` });
  }
}

let sections = '', lastGroup = '';
for (const b of list) {
  const svg = badge(b);
  writeFileSync(`${b.id}.svg`, svg + '\n');
  if (b.group !== lastGroup) { sections += `${lastGroup ? '</div></section>' : ''}<section><h2>${b.group}</h2><div class="row">`; lastGroup = b.group; }
  sections += `<figure>${svg}<figcaption>${b.title}</figcaption></figure>`;
}
sections += '</div></section>';
const locked = badge(list[2]).replace(/g-solo-extreme/g, 'g-locked');
sections += `<section><h2>Locked vs. earned</h2><div class="row"><figure class="locked">${locked}<figcaption>Not yet earned (greyed out)</figcaption></figure><figure>${badge({ ...list[2], id: 'solo-extreme-2' })}<figcaption>Earned · 28 Sep 2026</figcaption></figure></div></section>`;

writeFileSync('preview.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Achievement Badges</title><style>
:root{--bg:#EDF0F3;--surface:#fff;--ink:#16191D;--muted:#5B6570;--line:#C9D0D7}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121417;--surface:#1B1F24;--ink:#E8ECF0;--muted:#98A2AD;--line:#343B43}}
:root[data-theme="dark"]{--bg:#121417;--surface:#1B1F24;--ink:#E8ECF0;--muted:#98A2AD;--line:#343B43}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 Rubik,system-ui,sans-serif;padding:24px 16px}
main{max-width:760px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}p{color:var(--muted);margin:0 0 20px}
section{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:16px}
h2{font-size:15px;margin:0 0 12px}.row{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0;width:120px;text-align:center}figure svg{width:96px;height:96px;display:block;margin:0 auto 6px}
figcaption{font-size:12px;color:var(--muted)}.locked svg{filter:grayscale(1);opacity:.35}
</style></head><body><main><h1>Achievement badges (draft)</h1>
<p>Shape shows the family: circle for difficulty, hexagon for Rush, shield for guess count. Metal shows the tier (bronze, silver, gold, ruby); the tag at the top says single player or vs. computer. Every badge also carries its tier in words or pips, so it never relies on colour alone.</p>
${sections}</main></body></html>`);
