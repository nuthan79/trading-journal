/**
 * The sample book a new account sees until it has one of its own.
 *
 * WHY IT EXISTS. Everything this journal is for needs history. Expectancy, the
 * R distribution, drawdown, where the edge is — all of them say "come back
 * when you have twenty closed trades", so on the day somebody signs up most of
 * the app is a set of empty rooms. This fills them with a book that behaves
 * like a real one.
 *
 * NEVER WRITTEN TO THE DATABASE. Held in memory and injected where the journal
 * reads its trades. Rows carrying an is_sample flag would have to be excluded
 * from every statistic, every export and every product event, and one missed
 * filter would have the app blending invented trades into real figures — which
 * is the single thing a journal cannot do. See 028.
 *
 * DETERMINISTIC. Seeded from the user's id, so the same account sees the same
 * book on every visit. A sample that reshuffles on each render would have
 * people watching their "results" change while they read them.
 *
 * SIZED TO THEIR OWN ACCOUNT. The quantities come from the account size and
 * default risk just entered during first run, so the position sizes and risk
 * percentages read like their book rather than somebody else's.
 *
 * AND DELIBERATELY UNREMARKABLE. It would be easy to generate a 70% win rate
 * and call it a demo; the first thing anyone would learn is that this app
 * makes you look good. The distribution below is an ordinary edge — it loses
 * more often than it wins, carries a real drawdown, and includes two trades
 * that were plainly mistakes — because the product is a mirror and the sample
 * should behave like one.
 */

/** Small, fast, seeded. Stable across reloads for a given user. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedFrom = (s) => {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Real NSE names with plausible price bands, so nothing reads as invented. */
const UNIVERSE = [
  ["TITAN", 3200, 3900], ["KTKBANK", 190, 300], ["CMPDI", 240, 300],
  ["GOLDIAM", 300, 420], ["DIVISLAB", 5800, 7200], ["ELECON", 480, 620],
  ["PTC", 180, 230], ["KAYNES", 2900, 3800], ["SHRIRAMFIN", 950, 1200],
  ["SOLARINDS", 14000, 19000], ["VIJAYA", 900, 1150], ["CPPLUS", 480, 620],
  ["LLOYDSME", 1200, 1800], ["PARACABLES", 60, 90], ["MANIPALHOS", 520, 700],
  ["AYE", 260, 340], ["CENTUM", 1400, 1900], ["ONGC", 240, 300],
];

const PATTERNS = ["VCP", "Flat Base", "Cup & Handle", "Pullback Entry",
                  "High Tight Flag", "Breakout Entry", "Ascending Base"];

const EXIT_REASONS = ["Trailing stop", "Sold into strength", "Stop hit",
                      "Breached 20 SMA", "Time stop", "Target reached"];

/**
 * The shape of the outcomes.
 *
 * Losses are the commonest single result and cluster at -1R, because a stop
 * that works is a stop that gets hit. The right tail is thin and does the
 * lifting — which is the whole argument the R distribution screen exists to
 * make, and it cannot make it against a sample that wins evenly.
 */
function drawR(r, cold) {
  // Shifted during a cold patch rather than switching to a different shape:
  // a bad market does not invent new kinds of loss, it just serves more of
  // them and cuts the winners short.
  const p = r() * (cold ? 0.62 : 1);

  if (p < 0.46) return -(0.85 + r() * 0.2);        // full stop, near -1R
  if (p < 0.58) return -(0.25 + r() * 0.45);       // cut early, small loss
  if (p < 0.62) return -0.05 + r() * 0.1;          // scratch
  if (p < 0.86) return 0.5 + r() * 1.3;            // ordinary winner
  if (p < 0.96) return 1.9 + r() * 1.6;            // good one
  return 3.6 + r() * 3.0;                          // the ones that pay for it all
}

/**
 * Every book has a bad stretch, and a sample without one is the least honest
 * thing in it — the drawdown reading, the losing-run counter and half of what
 * the review page says all need a patch where nothing worked. This is a market
 * that stopped cooperating for about seven weeks.
 */
const COLD_FROM = 0.28, COLD_TO = 0.44;

const round2 = (v) => Math.round(v * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Build the book.
 *
 * `accountSize` and `riskPct` come from the profile, so quantities are sized
 * the way the position sizer would have sized them.
 */
export function buildDemo({ userId = "demo", accountSize = 1000000, riskPct = 0.75 } = {}) {
  const r = rng(seedFrom(userId));
  const riskRupees = Math.max(1000, (accountSize * riskPct) / 100);

  const trades = [];
  const today = new Date();
  const start = new Date(today);
  start.setMonth(start.getMonth() - 8);

  // 40 closed, then 5 still open. Forty because edge.js calls a slice under
  // fifteen thin, so a smaller book would light up the dashboard and leave the
  // page that explains where your edge is saying there isn't enough data.
  const CLOSED = 40;
  const OPEN = 5;

  for (let i = 0; i < CLOSED + OPEN; i++) {
    const [symbol, lo, hi] = UNIVERSE[Math.floor(r() * UNIVERSE.length)];
    const entryPrice = round2(lo + r() * (hi - lo));

    // 2%–7% stops. Tighter than that on a swing entry is usually noise.
    const slPct = 2 + r() * 5;
    const stop = round2(entryPrice * (1 - slPct / 100));
    const perShare = Math.max(0.05, entryPrice - stop);
    const quantity = Math.max(1, Math.round(riskRupees / perShare));

    const dayOffset = Math.floor((i / (CLOSED + OPEN)) * 230 + r() * 6);
    const entryDate = new Date(start);
    entryDate.setDate(entryDate.getDate() + dayOffset);

    const open = i >= CLOSED;
    const through = i / CLOSED;
    const cold = through >= COLD_FROM && through < COLD_TO;
    const rMult = open ? null : drawR(r, cold);
    // Losers get cut faster than winners get ridden — which is the behaviour,
    // not a rule, and the holding-period breakdown should show it.
    const held = rMult != null && rMult < 0
      ? 2 + Math.floor(r() * 14)
      : 6 + Math.floor(r() * 46);

    const base = {
      id: `demo-${i}`,
      demo: true,                       // the only marker anything needs
      symbol,
      exchange: "NSE",
      side: "long",
      acquisition: "purchase",
      entry_date: iso(entryDate),
      entry_price: entryPrice,
      quantity,
      stop_loss: stop,
      initial_stop_loss: stop,
      stop_source: "entered",
      // Column names from schema.sql, not from what they ought to be called:
      // the first pass wrote base_pattern and volume_pct, and edge.js reads
      // `pattern` and `vol_pct_avg` — so "Where the edge is" reported all
      // forty trades under "Not recorded", which is the one screen the sample
      // exists to fill.
      pattern: PATTERNS[Math.floor(r() * PATTERNS.length)],
      vol_pct_avg: Math.round(80 + r() * 180),
      weinstein_stage: r() < 0.75 ? 2 : 1,
      rs_rank: Math.round(55 + r() * 44),
      pivot_price: round2(entryPrice * (0.985 + r() * 0.02)),
      charges: 0,
      charges_auto: true,
      imported: false,
      mistakes: [],
      notes: "",
      exits: [],
    };

    if (open) {
      // Marked so Holdings has something to value, and so the open-risk
      // reading on the dashboard is not zero.
      trades.push({
        ...base,
        status: "open",
        exit_date: null, exit_price: null, exit_reason: null,
        last_price: round2(entryPrice * (0.97 + r() * 0.12)),
        last_price_at: new Date().toISOString(),
      });
      continue;
    }

    const exitPrice = round2(entryPrice + rMult * perShare);
    const exitDate = new Date(entryDate);
    exitDate.setDate(exitDate.getDate() + held);

    // Two of them were errors rather than bad luck, so the review page has
    // something true to say instead of a clean sheet nobody believes.
    const mistakes =
      rMult < -0.8 && r() < 0.28 ? ["Chased extended"]
      : rMult < -0.8 && r() < 0.4 ? ["Not a real base"]
      : rMult > 0 && rMult < 0.6 && r() < 0.25 ? ["Sold too early"]
      : [];

    trades.push({
      ...base,
      status: "closed",
      exit_date: iso(exitDate),
      exit_price: exitPrice,
      exit_reason: EXIT_REASONS[Math.floor(r() * EXIT_REASONS.length)],
      mistakes,
      exits: [{
        id: `demo-x-${i}`,
        trade_id: `demo-${i}`,
        exit_date: iso(exitDate),
        quantity,
        price: exitPrice,
        reason: null,
        charges: 0,
      }],
    });
  }

  // Newest first, matching listTrades so nothing downstream has to re-sort.
  trades.sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));

  const diary = [
    {
      id: "demo-d-1", demo: true,
      entry_date: trades[0]?.entry_date || iso(today),
      emotions: ["Confident", "Patient"],
      body: "Waited for the base to tighten instead of buying the first push. " +
            "Volume came in on the breakout day, which is the part I keep skipping.",
      trade_id: trades[0]?.id || null,
      image_path: null, created_at: new Date().toISOString(),
    },
    {
      id: "demo-d-2", demo: true,
      entry_date: trades[3]?.entry_date || iso(today),
      emotions: ["FOMO", "Impatient"],
      body: "Bought this extended because it was moving without me. Stopped out " +
            "in four days. Nothing wrong with the stock — I was late.",
      trade_id: trades[3]?.id || null,
      image_path: null, created_at: new Date().toISOString(),
    },
  ];

  return { trades, diary };
}

/** Everything in the sample carries this, so a write path can refuse it. */
export const isDemoRow = (row) => !!row?.demo;
