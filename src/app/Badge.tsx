import type { OpenProfile } from './profilePages';
import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import { BADGE_BY_ID, BADGES, suggestVoidedFewGuesses, UNLOCKS, type Badge, type BadgeFamily, type EarnedBadge, type Metal } from '../game';

/*
 * The achievement badges as inline SVG (README "Achievements"), drawn as in
 * docs/badges/gen.mjs, so the bundled font applies and nothing loads from
 * outside. The shape shows the family and the metal the tier.
 */

const METALS: Record<Metal, { hi: string; lo: string; text: string }> = {
  jade: { hi: '#9FE0B5', lo: '#1F6B3F', text: '#C8F0D6' },
  bronze: { hi: '#EDB889', lo: '#8C5327', text: '#F4CFAE' },
  silver: { hi: '#F4F6F8', lo: '#86919D', text: '#E6EAEE' },
  gold: { hi: '#FFE07A', lo: '#B07F08', text: '#FFE39A' },
  ruby: { hi: '#FF8FA6', lo: '#8E0E2C', text: '#FFC4CF' },
};
const INK = '#16191D';
const GREEN = '#2E7D32';
const GREY = '#BDBDBD';

/** Fill and stroke attributes, spread onto a shape. */
type Paint = Record<string, string | number>;

const at = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(60 + r * Math.cos(a)).toFixed(1)},${(60 + r * Math.sin(a)).toFixed(1)}`;
};

/** Each family's outline at radius `r`, centred in a 120 × 120 box. */
const SHAPES: Record<BadgeFamily, (r: number, paint: Paint) => JSX.Element> = {
  difficulty: (r, paint) => <circle cx="60" cy="60" r={r} {...paint} />,
  rush: (r, paint) => <polygon points={[...Array(6)].map((_, k) => at(r, -90 + 60 * k)).join(' ')} {...paint} />,
  guesses: (r, paint) => {
    const s = r / 56;
    const t = (x: number, y: number) => `${(60 + (x - 60) * s).toFixed(1)} ${(60 + (y - 60) * s).toFixed(1)}`;
    return (
      <path d={`M${t(60, 4)} L${t(108, 17)} L${t(108, 57)} C${t(108, 88)} ${t(86, 106)} ${t(60, 116)} `
        + `C${t(34, 106)} ${t(12, 88)} ${t(12, 57)} L${t(12, 17)} Z`} {...paint} />
    );
  },
  // Streaks: a rounded square.
  streak: (r, paint) => {
    const half = r * 0.9;
    return <rect x={60 - half} y={60 - half} width={half * 2} height={half * 2} rx={r * 0.28} {...paint} />;
  },
  // One-off feats: a scalloped seal.
  feat: (r, paint) => (
    <polygon points={[...Array(24)].map((_, k) => at(k % 2 ? r * 0.9 : r, -90 + 15 * k)).join(' ')} {...paint} />
  ),
};

const LABEL_Y: Record<BadgeFamily, number> = { difficulty: 93, rush: 85, guesses: 90, streak: 92, feat: 90 };
const TAG_Y: Record<BadgeFamily, number> = { difficulty: 34, rush: 34, guesses: 31, streak: 33, feat: 34 };

const bubble = (x: number, fill: string, extra: Paint = {}) => <circle cx={x} cy="52" r="7.5" fill={fill} {...extra} />;
const score = (n: number) => <text x="91" y="56.5" font-size="13" fill="#fff">– {n}</text>;
const ring = { stroke: '#fff', 'stroke-width': 1.5 };

/** Four pips, the first `filled` of them filled: a Rush level, or the computer beaten. */
const pips = (filled: number, text: string, y: number) => [...Array(4)].map((_, i) => (
  <circle cx={48 + i * 8} cy={y} r="2.4" fill={i < filled ? text : 'none'} stroke={text} stroke-width="1" />
));

/** The middle of the badge. Difficulty icons echo each difficulty's own history line. */
function Icon({ badge, text }: { badge: Badge; text: string }) {
  switch (badge.family) {
    case 'difficulty':
      // VS CPU: the difficulty's icon, with the computer's strength as pips below it.
      if (badge.pips) {
        return (
          <>
            <g transform="translate(0 -4)"><Icon badge={{ ...badge, pips: undefined }} text={text} /></g>
            {pips(badge.pips, text, 70)}
          </>
        );
      }
      if (badge.difficulty === 'easy') return <>{bubble(29, GREEN)}{bubble(47, GREY)}{bubble(65, GREEN)}{score(2)}</>;
      if (badge.difficulty === 'medium') return <>{bubble(29, GREEN)}{bubble(47, GREY)}{bubble(65, INK, ring)}{score(2)}</>;
      if (badge.difficulty === 'hard') return <>{[29, 47, 65].map((x) => bubble(x, INK, ring))}{score(2)}</>;
      return (
        <>
          {[29, 47, 65].map((x) => bubble(x, 'none', {
            stroke: '#fff', 'stroke-opacity': 0.6, 'stroke-width': 1.5, 'stroke-dasharray': '3 2.6',
          }))}
          {score(3)}
        </>
      );
    case 'rush':
      return (
        <>
          <g transform="translate(0 -5)" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round">
            <circle cx="60" cy="52" r="15" /><path d="M60 52 L60 43" /><path d="M60 52 L66 56" />
            <path d="M55 33 H65" /><path d="M60 33 V37" /><path d="M72 39 L75 36" />
          </g>
          {pips(badge.pips ?? 0, text, 72)}
        </>
      );
    case 'guesses':
      return <text x="60" y="66" font-size="28" fill="#fff" letter-spacing="-1">≤{badge.count}</text>;
    case 'streak':
      return <text x="60" y={badge.count! >= 100 ? 70 : 72} font-size={badge.count! >= 100 ? 30 : 36} fill="#fff" letter-spacing="-1">{badge.count}</text>;
    case 'feat':
      if (badge.id.startsWith('daily-top-')) {
        // The place it takes: 10, or 10%.
        const percent = badge.id.endsWith('percent');
        return <text x="60" y="68" font-size={percent ? 24 : 30} fill="#fff" letter-spacing="-1">{percent ? '10%' : '10'}</text>;
      }
      if (badge.id.startsWith('unlock-')) {
        // An open padlock, between the tag and the label: never over either (issue #110).
        return (
          <g fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round">
            <path d="M52 55 V50 a8 8 0 0 1 16 0" />
            <rect x="46" y="55" width="28" height="19" rx="3.5" fill="#fff" stroke="none" />
          </g>
        );
      }
      if (badge.id.startsWith('hunter-')) {
        // The share of the other badges: 25% to 100%.
        return <text x="60" y="67" font-size={badge.count === 100 ? 22 : 26} fill="#fff" letter-spacing="-1">{badge.count}%</text>;
      }
      if (badge.id === 'lobby-win' || badge.id === 'competitive-win') {
        return <text x="60" y="68" font-size="28" fill="#fff" letter-spacing="-1">1st</text>;
      }
      if (badge.id === 'friend-win') {
        // You and your friend: two players, yours found.
        return (
          <>
            {bubble(42, GREEN, { cy: 57, r: 10 })}{bubble(78, INK, { ...ring, cy: 57, r: 10 })}
            <text x="60" y="61" font-size="10" fill="#fff">VS</text>
          </>
        );
      }
      if (badge.id.startsWith('friend-harder')) {
        // Levels above your friend's: an arrow up, then +1 or +2.
        return (
          <>
            <path d="M60 37 L67 45 H53 Z" fill="#fff" />
            <text x="60" y="70" font-size="24" fill="#fff" letter-spacing="-1">+{badge.count}</text>
          </>
        );
      }
      if (badge.id === 'clairvoyant') {
        // An eye: seeing the word before the first guess.
        return (
          <>
            <path d="M36 57 Q60 34 84 57 Q60 80 36 57 Z" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" />
            {bubble(60, GREEN, { cy: 57, r: 8 })}
          </>
        );
      }
      if (badge.id === 'clutch') {
        // Two found words, level: a tie on the last guess.
        return (
          <>
            {bubble(40, GREEN, { cy: 57, r: 9 })}{bubble(80, GREEN, { cy: 57, r: 9 })}
            <text x="60" y="63" font-size="18" fill="#fff">=</text>
          </>
        );
      }
      return null;
  }
}

const STREAK_TAG: Record<string, string> = { WINS: 'STREAK', DAYS: 'DAILY' };

/** One badge. Unearned ones are greyed out by the `locked` class. */
export function BadgeArt({ badge, locked = false, size = 96 }: { badge: Badge; locked?: boolean; size?: number }) {
  const gradient = `badge-${useId()}`;
  const metal = METALS[badge.metal];
  const shape = SHAPES[badge.family];
  const tag = badge.tag ?? (badge.family === 'streak' ? STREAK_TAG[badge.label] : null);
  return (
    <svg class={locked ? 'badge-art locked' : 'badge-art'} viewBox="0 0 120 120" width={size} height={size}
      aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color={metal.hi} /><stop offset="1" stop-color={metal.lo} />
        </linearGradient>
      </defs>
      {shape(57, { fill: `url(#${gradient})` })}
      {shape(48, { fill: INK })}
      {shape(44.5, { fill: 'none', stroke: metal.text, 'stroke-opacity': 0.35, 'stroke-width': 1 })}
      <g font-family="Rubik, system-ui, sans-serif" font-weight="700" text-anchor="middle">
        {tag && <text x="60" y={TAG_Y[badge.family]} font-size="7.5" letter-spacing="1" fill={metal.text}>{tag}</text>}
        <Icon badge={badge} text={metal.text} />
        <text x="60" y={LABEL_Y[badge.family]} font-size={badge.label.length > 8 ? 7.5 : 9.5}
          letter-spacing={badge.label.length > 10 ? 0.3 : 1.2}
          fill={metal.text}>{badge.label}</text>
      </g>
    </svg>
  );
}

/** On the result screen, when Suggest kept you from a few-guesses badge (README "Achievements"). */
export function SuggestNote({ found, guesses, suggested }: { found: boolean; guesses: number; suggested: number }) {
  return suggestVoidedFewGuesses(found, guesses, suggested)
    ? <p class="tally">Suggest used: no few-guesses badge</p> : null;
}

/**
 * On the result screen: the badges this game just earned, read out as it
 * appears. Tapping it opens the profile, where they're listed.
 */
export function BadgeToast({ badges, onOpen }: { badges: readonly Badge[]; onOpen: OpenProfile }) {
  if (badges.length === 0) return null;
  // Unlocking a mode says so first: it's on the home screen now.
  const unlocked = UNLOCKS.find((u) => badges.some((b) => b.id === `unlock-${u.step}`));
  if (unlocked) {
    return (
      <div class="badge-toast-wrap" role="status">
        <button type="button" class="badge-toast" onClick={() => onOpen('achievements')}>
          <span class="badge-toast-art"><BadgeArt badge={BADGE_BY_ID.get(`unlock-${unlocked.step}`)!} size={44} /></span>
          <span class="badge-toast-text">
            <b>{unlocked.title} unlocked!</b>
            <span>Find it on the home screen.{badges.length > 1 && ` And ${badges.length - 1} more badge${badges.length > 2 ? 's' : ''}.`} Tap to see.</span>
          </span>
        </button>
      </div>
    );
  }
  return (
    <div class="badge-toast-wrap" role="status">
      <button type="button" class="badge-toast" onClick={() => onOpen('achievements')}>
        <span class="badge-toast-art">
          {badges.slice(0, 3).map((b) => <BadgeArt key={b.id} badge={b} size={44} />)}
        </span>
        <span class="badge-toast-text">
          <b>{badges.length === 1 ? 'Badge earned' : `${badges.length} badges earned`}</b>
          <span>{badges[0].title}{badges.length > 1 && `, and ${badges.length - 1} more`}. Tap to see.</span>
        </span>
      </button>
    </div>
  );
}

const FAMILY_TITLE: Record<BadgeFamily, string> = {
  difficulty: 'Difficulty',
  rush: 'Rush level',
  guesses: 'Few guesses',
  streak: 'Streaks',
  feat: 'Feats',
};
const FAMILIES: readonly BadgeFamily[] = ['difficulty', 'guesses', 'rush', 'streak', 'feat'];

const formatDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/**
 * The profile's achievements: every badge, grouped by family, earned ones
 * with their date and unearned ones greyed out. `earned` is null while the
 * games load; `fresh` are the ones new since you last looked.
 */
export function Achievements({ earned, fresh }: {
  earned: readonly EarnedBadge[] | null;
  fresh: ReadonlySet<string>;
}) {
  const byId = new Map((earned ?? []).map((e) => [e.id, e]));
  return (
    <section class="profile-section achievements" aria-label="Achievements">
      <div class="section-head">
        {earned && <span class="field-note">{earned.length} of {BADGES.length}</span>}
      </div>
      {!earned ? <p class="field-note">Loading…</p> : FAMILIES.map((family) => (
        <div class="badge-group" key={family}>
          <h4>{FAMILY_TITLE[family]}</h4>
          <ul class="badge-grid">
            {BADGES.filter((b) => b.family === family).map((b) => {
              const got = byId.get(b.id);
              // New since you last looked (issue #94): a green, bold name and a New tag, so it stands out.
              const isNew = got && fresh.has(b.id);
              return (
                <li key={b.id} class={got ? isNew ? 'badge-item new' : 'badge-item' : 'badge-item locked'}>
                  <BadgeArt badge={b} locked={!got} size={72} />
                  {isNew && <span class="tag badge-new">New</span>}
                  <span class="badge-title">{b.title}</span>
                  <span class="badge-date">{got ? formatDay(got.at) : 'Not yet earned'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
