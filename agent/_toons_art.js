// Owl Toons art kit: turns an AI-written script into a hand-drawn 4-panel comic (SVG).
// Every character, scene and prop is drawn here in the HOODL style; the AI only picks them.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const INK = '#141010';
const PW = 580, PH = 400, GAP = 16, PAD = 24, TOP = 96, BOT = 70;
const W = PAD * 2 + PW * 2 + GAP, H = TOP + PH * 2 + GAP + BOT;

/* ---------- characters (drawn around 0,0 = feet center, ~200px tall) ---------- */
function eyes(pose, lx, ly, rx, ry, r) {
  if (pose === 'sleep') return `<path d="M${lx - r},${ly} q${r},${r * .8} ${r * 2},0 M${rx - r},${ry} q${r},${r * .8} ${r * 2},0" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  if (pose === 'happy') return `<path d="M${lx - r},${ly + 2} q${r},${-r * 1.1} ${r * 2},0 M${rx - r},${ry + 2} q${r},${-r * 1.1} ${r * 2},0" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  const pr = pose === 'shock' ? r * .25 : r * .42;
  return `<circle cx="${lx}" cy="${ly}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="${rx}" cy="${ry}" r="${r * .92}" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="${lx + 2}" cy="${ly - 1}" r="${pr}" fill="${INK}"/><circle cx="${rx + 2}" cy="${ry - 1}" r="${pr * .92}" fill="${INK}"/>`;
}
function owl(pose) {
  const wing = pose === 'fly' ? `<path d="M-60,-120 C-120,-170 -150,-110 -110,-80 C-90,-70 -70,-80 -58,-90Z M60,-120 C120,-170 150,-110 110,-80 C90,-70 70,-80 58,-90Z" fill="#2a2626" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`
    : pose === 'point' ? `<path d="M58,-110 C90,-130 120,-150 140,-170" fill="none" stroke="#2a2626" stroke-width="16" stroke-linecap="round"/><path d="M58,-110 C90,-130 120,-150 140,-170" fill="none" stroke="${INK}" stroke-width="22" stroke-linecap="round" opacity=".25"/>` : '';
  return `<g>${wing}
   <path d="M-40,-178 L-56,-214 L-28,-192Z M40,-178 L56,-214 L28,-192Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
   <path d="M-62,0 L-62,-120 C-62,-168 -34,-190 0,-190 C34,-190 62,-168 62,-120 L62,0Z" fill="#2a2626" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
   <ellipse cx="0" cy="-132" rx="45" ry="40" fill="#fff" stroke="${INK}" stroke-width="6"/>
   ${eyes(pose, -17, -136, 18, -137, 14)}
   <path d="M-6,-116 L6,-116 L0,-105Z" fill="#ff5f0a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
   ${pose === 'shock' ? `<ellipse cx="0" cy="-96" rx="7" ry="9" fill="${INK}"/>` : ''}
   <path d="M-58,-78 C-36,-66 36,-66 58,-78" fill="none" stroke="${INK}" stroke-width="5"/>
   <circle cx="0" cy="-48" r="24" fill="#ff5f0a" stroke="${INK}" stroke-width="5"/><circle cx="-7" cy="-52" r="4.5" fill="#fff"/><circle cx="7" cy="-52" r="4.5" fill="#fff"/>
   <path d="M-32,-50 C-36,-58 -22,-62 -20,-52Z M32,-50 C36,-58 22,-62 20,-52Z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  </g>`;
}
function fox(pose) {
  return `<g>
   <path d="M-40,-150 L-50,-205 L-14,-172Z M40,-150 L50,-205 L14,-172Z" fill="#e07a2e" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
   <path d="M-52,0 L-46,-90 C-44,-160 44,-160 46,-90 L52,0Z" fill="#e07a2e" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
   <path d="M-30,0 L-24,-60 L0,-40 L24,-60 L30,0Z" fill="#3b3b52" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
   <path d="M-46,-120 C-34,-84 -12,-80 0,-72 C12,-80 34,-84 46,-120 C22,-106 -22,-106 -46,-120Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
   ${pose === 'shock' ? eyes('shock', -16, -118, 16, -118, 9) : `<path d="M-26,-126 L-10,-120 M26,-126 L10,-120" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><circle cx="-16" cy="-112" r="4.5" fill="${INK}"/><circle cx="16" cy="-112" r="4.5" fill="${INK}"/>`}
   <circle cx="0" cy="-88" r="7" fill="${INK}"/>
   <path d="M-10,-78 C-4,-70 4,-70 10,-78" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
   ${pose === 'point' ? `<path d="M46,-60 C76,-76 96,-92 116,-104" stroke="#e07a2e" stroke-width="14" stroke-linecap="round" fill="none"/>` : ''}
  </g>`;
}
function whale(pose) {
  return `<g>
   <path d="M-110,0 C-118,-90 -40,-140 40,-128 C100,-120 120,-70 112,-30 C150,-60 170,-50 160,-20 C150,10 120,0 110,-8 C100,0 -100,8 -110,0Z" fill="#4a78c8" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
   <path d="M-100,-20 C-60,-6 60,-6 96,-24 C80,-2 -80,4 -100,-20Z" fill="#dbe8ff" stroke="${INK}" stroke-width="4"/>
   ${eyes(pose, -40, -76, -6, -78, 9)}
   <path d="M-70,-48 C-56,-38 -40,-38 -28,-48" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
   <path d="M10,-132 C4,-160 -10,-170 -20,-176 M10,-132 C16,-160 30,-170 40,-176" fill="none" stroke="#7fb2ff" stroke-width="6" stroke-linecap="round"/>
  </g>`;
}
function frog(pose) {
  return `<g>
   <path d="M-60,0 C-70,-60 -50,-110 0,-110 C50,-110 70,-60 60,0Z" fill="#6cc46a" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>
   <circle cx="-26" cy="-112" r="20" fill="#6cc46a" stroke="${INK}" stroke-width="6"/><circle cx="26" cy="-112" r="20" fill="#6cc46a" stroke="${INK}" stroke-width="6"/>
   ${eyes(pose, -26, -112, 26, -112, 11)}
   <path d="M-30,-66 C-12,-52 12,-52 30,-66" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
   <path d="M-40,-30 C-20,-20 20,-20 40,-30" fill="none" stroke="${INK}" stroke-width="4" opacity=".4"/>
   ${pose !== 'sleep' ? `<path d="M48,-140 C52,-130 54,-124 50,-118" stroke="#7fd3ff" stroke-width="5" fill="none" stroke-linecap="round"/>` : ''}
  </g>`;
}
const DRAW = { owl, fox, whale, frog };

/* ---------- scenes ---------- */
function scene(name) {
  const ground = (fill) => `<path d="M-10,${PH - 70} C120,${PH - 92} 300,${PH - 58} ${PW + 10},${PH - 80} L${PW + 10},${PH + 10} L-10,${PH + 10}Z" fill="${fill}" stroke="${INK}" stroke-width="6"/>`;
  const tufts = `<path d="M60,${PH - 30} c2,-12 0,-22 -4,-30 m14,30 c0,-14 4,-26 10,-34 m14,34 c2,-10 8,-18 18,-22 M${PW - 120},${PH - 26} c2,-12 0,-22 -4,-30 m14,30 c0,-14 4,-26 10,-34" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  switch (name) {
    case 'night': return `<rect width="${PW}" height="${PH}" fill="#2e2763"/><g fill="#fff6d8">${[[60, 50], [140, 90], [420, 40], [500, 110], [300, 70], [230, 30]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join('')}</g><circle cx="470" cy="80" r="40" fill="#fff6d8" stroke="${INK}" stroke-width="5"/><circle cx="455" cy="70" r="8" fill="#efd98a"/>${ground('#3a2f5e')}${tufts}`;
    case 'chart': return `<rect width="${PW}" height="${PH}" fill="#1d2433"/><g stroke="#2c3850" stroke-width="2">${[60, 120, 180, 240].map(y => `<path d="M0,${y} H${PW}"/>`).join('')}</g><path d="M20,230 L90,200 L140,215 L200,140 L250,170 L310,90 L360,130 L420,60 L470,110 L560,40" fill="none" stroke="#1fd17a" stroke-width="7" stroke-linejoin="round"/>${ground('#2a3242')}`;
    case 'moon': return `<rect width="${PW}" height="${PH}" fill="#14112b"/><circle cx="470" cy="70" r="34" fill="#4a78c8" stroke="${INK}" stroke-width="5"/><g fill="#fff">${[[40, 40], [120, 120], [260, 60], [380, 140], [520, 180]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5"/>`).join('')}</g><path d="M-10,${PH - 80} C150,${PH - 110} 400,${PH - 70} ${PW + 10},${PH - 95} L${PW + 10},${PH + 10} L-10,${PH + 10}Z" fill="#d9d3c4" stroke="${INK}" stroke-width="6"/><ellipse cx="160" cy="${PH - 40}" rx="40" ry="10" fill="#bfb8a6" stroke="${INK}" stroke-width="4"/><ellipse cx="420" cy="${PH - 30}" rx="30" ry="8" fill="#bfb8a6" stroke="${INK}" stroke-width="4"/>`;
    case 'beach': return `<rect width="${PW}" height="${PH}" fill="#bfe3ff"/><circle cx="90" cy="70" r="36" fill="#ffd36e" stroke="${INK}" stroke-width="5"/><path d="M-10,${PH - 140} C140,${PH - 160} 300,${PH - 120} ${PW + 10},${PH - 150} L${PW + 10},${PH - 80} L-10,${PH - 80}Z" fill="#4aa3e8" stroke="${INK}" stroke-width="5"/>${ground('#f5d79a')}`;
    case 'market': return `<rect width="${PW}" height="${PH}" fill="#ffe0c2"/><g stroke="${INK}" stroke-width="5"><path d="M30,190 L30,${PH - 70} M170,190 L170,${PH - 70}" /><path d="M10,190 L190,190 L170,140 L30,140Z" fill="#ff5f0a"/><path d="M390,200 L390,${PH - 70} M540,200 L540,${PH - 70}"/><path d="M370,200 L560,200 L540,150 L390,150Z" fill="#1f9d57"/></g>${ground('#ffb07a')}`;
    default: return `<rect width="${PW}" height="${PH}" fill="#ffe0c2"/><circle cx="480" cy="70" r="32" fill="#fff6d8" stroke="${INK}" stroke-width="5"/><path d="M-20,250 C150,232 330,262 ${PW + 20},236" fill="none" stroke="#7a4b2a" stroke-width="22" stroke-linecap="round"/><path d="M-20,250 C150,232 330,262 ${PW + 20},236" fill="none" stroke="${INK}" stroke-width="30" stroke-linecap="round" opacity=".15"/>${ground('#ffb07a')}${tufts}`;
  }
}
/* ---------- props ---------- */
function prop(name, x, y) {
  const g = s => `<g transform="translate(${x},${y})">${s}</g>`;
  switch (name) {
    case 'coin': return g(`<circle r="26" fill="#ff5f0a" stroke="${INK}" stroke-width="5"/><circle cx="-7" cy="-3" r="5" fill="#fff"/><circle cx="7" cy="-3" r="5" fill="#fff"/>`);
    case 'laptop': return g(`<rect x="-46" y="-60" width="92" height="60" rx="6" fill="#e9e3dc" stroke="${INK}" stroke-width="5"/><circle cx="0" cy="-30" r="12" fill="#ff5f0a" stroke="${INK}" stroke-width="4"/><path d="M-56,0 H56 L60,10 H-60Z" fill="#cfc7bd" stroke="${INK}" stroke-width="5"/>`);
    case 'rug': return g(`<path d="M-70,0 C-30,-12 20,10 70,-4 L76,18 C20,30 -30,10 -64,22Z" fill="#c43b3b" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M-60,10 H60" stroke="#ffd36e" stroke-width="3" stroke-dasharray="6 6"/>`);
    case 'rocket': return g(`<path d="M0,-90 C24,-60 26,-20 18,0 L-18,0 C-26,-20 -24,-60 0,-90Z" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="0" cy="-48" r="10" fill="#4a78c8" stroke="${INK}" stroke-width="4"/><path d="M-18,-10 L-34,8 L-16,4Z M18,-10 L34,8 L16,4Z" fill="#ff5f0a" stroke="${INK}" stroke-width="4"/><path d="M-10,4 C-6,26 6,26 10,4" fill="#ffd36e" stroke="${INK}" stroke-width="4"/>`);
    case 'airdrop': return g(`<g transform="rotate(-8)"><rect x="-32" y="-44" width="64" height="84" rx="6" fill="#fff" stroke="${INK}" stroke-width="5"/><path d="M-20,-26 H20 M-20,-12 H20 M-20,2 H10" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M-20,24 C-8,14 4,34 20,22" stroke="#e23a12" stroke-width="4" fill="none" stroke-linecap="round"/></g>`);
    default: return '';
  }
}
/* ---------- speech bubbles ---------- */
function wrap(text, max) {
  const words = String(text || '').split(' ').filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur); return lines.slice(0, 3);
}
function bubble(x, y, text, tailX, tailY, width) {
  const lines = wrap(text, Math.floor(width / 13)), lh = 26, h = lines.length * lh + 22, w = width;
  const left = Math.max(10, Math.min(PW - w - 10, x - w / 2));
  const tx = Math.max(left + 24, Math.min(left + w - 24, tailX));
  return `<path d="M${left + 16},${y} H${left + w - 16} Q${left + w},${y} ${left + w},${y + 16} V${y + h - 16} Q${left + w},${y + h} ${left + w - 16},${y + h} H${tx + 12} L${tailX},${tailY} L${tx - 8},${y + h} H${left + 16} Q${left},${y + h} ${left},${y + h - 16} V${y + 16} Q${left},${y} ${left + 16},${y}Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    lines.map((l, i) => `<text x="${left + w / 2}" y="${y + 30 + i * lh}" text-anchor="middle" font-family="'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', Gaegu, cursive" font-weight="700" font-size="23" fill="${INK}">${esc(l)}</text>`).join('');
}
/* ---------- one panel ---------- */
function panel(p, i) {
  const cast = (p.cast || []).filter(c => DRAW[c.who]).slice(0, 2);
  if (!cast.length) cast.push({ who: 'owl', pose: 'normal' });
  const slots = cast.length === 1 ? [PW / 2] : [PW * 0.3, PW * 0.72], scale = cast.length === 1 ? 1.05 : 0.92, feetY = PH - 34;
  const pos = {};
  let body = '';
  cast.forEach((c, k) => {
    const x = slots[k], flip = cast.length === 2 && k === 1 && c.who !== 'whale' ? -1 : 1;
    const lift = c.pose === 'fly' ? -70 : 0, rot = c.pose === 'fly' ? (k ? 10 : -10) : 0;
    pos[c.who] = { x, top: feetY + lift - 210 * scale };
    body += `<g transform="translate(${x},${feetY + lift}) rotate(${rot}) scale(${scale * flip},${scale})">${DRAW[c.who](c.pose || 'normal')}</g>`;
    if (c.pose === 'sleep') body += `<text x="${x + 50}" y="${pos[c.who].top + 20}" font-family="'Comic Sans MS',cursive" font-weight="700" font-size="26" fill="${INK}">z z Z</text>`;
    if (c.pose === 'shock') body += `<text x="${x + 46}" y="${pos[c.who].top + 30}" font-family="Impact,'Arial Black',sans-serif" font-size="40" fill="#ff5f0a" stroke="${INK}" stroke-width="1.5">!!</text>`;
  });
  const pr = p.prop && p.prop !== 'none' ? prop(p.prop, cast.length === 1 ? PW * 0.8 : PW * 0.51, feetY - 30) : '';
  const lines = (p.lines || []).slice(0, 2);
  let bubbles = '', by = 14;
  lines.forEach((l, k) => {
    const who = pos[l.who] || pos[cast[Math.min(k, cast.length - 1)].who];
    const width = cast.length === 2 ? 236 : 300, bx = cast.length === 2 ? (k === 0 ? PW * 0.25 : PW * 0.75) : PW / 2;
    bubbles += bubble(bx, by, l.say, who.x, Math.max(by + 60, who.top - 6), width);
    by += cast.length === 2 ? 0 : 92;
  });
  const ox = PAD + (i % 2) * (PW + GAP), oy = TOP + Math.floor(i / 2) * (PH + GAP);
  return `<g transform="translate(${ox},${oy})"><clipPath id="c${i}"><rect width="${PW}" height="${PH}" rx="10"/></clipPath><g clip-path="url(#c${i})" filter="url(#boil)">${scene(p.scene)}${pr}${body}</g><g>${bubbles}</g><rect width="${PW}" height="${PH}" rx="10" fill="none" stroke="${INK}" stroke-width="7"/><text x="16" y="34" font-family="Impact,'Arial Black',sans-serif" font-size="28" fill="#fff" stroke="${INK}" stroke-width="2" paint-order="stroke">${i + 1}</text></g>`;
}
function render(ep) {
  const s = ep.script || {}, panels = (s.panels || []).slice(0, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><filter id="boil" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="2" seed="${(ep.n || 1) * 7}"/><feDisplacementMap in="SourceGraphic" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
<rect width="${W}" height="${H}" fill="#fff4e6"/>
<text x="${PAD}" y="62" font-family="Impact,'Arial Black',sans-serif" font-size="44" fill="#ff5f0a" stroke="${INK}" stroke-width="2" paint-order="stroke">OWL TOONS #${esc(ep.n)}</text>
<text x="${W - PAD}" y="60" text-anchor="end" font-family="'Comic Sans MS','Comic Neue','Chalkboard SE',cursive" font-weight="700" font-size="30" fill="${INK}">${esc(s.title || '')}</text>
${panels.map(panel).join(String.fromCharCode(10))}
<text x="${W / 2}" y="${H - 30}" text-anchor="middle" font-family="'Comic Sans MS','Comic Neue','Chalkboard SE',cursive" font-weight="700" font-size="26" fill="${INK}">${esc(s.caption || '')}</text>
<text x="${W - PAD}" y="${H - 8}" text-anchor="end" font-family="Arial,sans-serif" font-size="14" fill="#6f6157">plot: ${esc(String(ep.plot || '').slice(0, 90))} · written &amp; drawn by the Owl Toons agent on NEAR</text>
</svg>`;
}
module.exports = { render, W, H };
