/**
 * Every article under /learn, in one list.
 *
 * WHY A MANIFEST RATHER THAN JUST FILES. Three places need to agree about what
 * exists: the index page, the sitemap, and the article's own metadata. When the
 * sitemap holds its own hardcoded copy — which it did after the first article —
 * writing a second one and forgetting to add it there publishes a page no
 * search engine is told about. Silent, and exactly the sort of thing nobody
 * checks.
 *
 * So the list lives here, the index maps over it, the sitemap maps over it, and
 * each page reads its own title and description from it. Adding an article
 * means adding one entry and one file.
 *
 * `published` is a real date because an index without dates makes a reader
 * guess whether anything has been written this year, and the answer is part of
 * whether they trust it. `minutes` is honest reading time at roughly 200 words
 * a minute — it sets an expectation, and understating it to seem approachable
 * just annoys whoever budgeted three minutes.
 */

export const ARTICLES = [
  {
    slug: "what-is-an-r-multiple",
    title: "What is an R multiple, and why rupees mislead you",
    description:
      "R is your profit or loss divided by what you risked. It is what makes a " +
      "₹8,000 win and a ₹40,000 win comparable — and usually shows the smaller " +
      "one was the better trade. With worked examples for Indian equity.",
    // What the index shows. Shorter than the meta description, because a card
    // is read at a glance and a paragraph on it is skipped entirely.
    blurb:
      "Two winning trades, ₹8,000 and ₹40,000. One of them is twice the trade — " +
      "and it is not the one you think.",
    published: "2026-08-14",
    minutes: 5,
    keywords: [
      "R multiple", "what is R multiple trading", "risk multiple",
      "expectancy trading", "position sizing India", "1R",
    ],
  },
];

export const articleBySlug = (slug) => ARTICLES.find((a) => a.slug === slug) || null;

/** Newest first — an index that opens with something from last year reads as
 *  abandoned, whatever the rest of it says. */
export const articlesNewestFirst = () =>
  [...ARTICLES].sort((a, b) => String(b.published).localeCompare(String(a.published)));
