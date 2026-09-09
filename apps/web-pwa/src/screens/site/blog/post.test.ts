/**
 * THE BLOG ENGINE, AND THE GATE THAT DECIDES WHAT MAY BE PUBLISHED.
 *
 * The blog is the origin every syndicated copy points back at (docs/GROWTH-DESK.md §3), so the
 * rules that make a page worth having are not editorial preferences here: they are conditions of
 * publication, checked at build time by `compile.ts` and proved here. Google's own line is that
 * generating pages "without adding value for users" is spam (docs/GROWTH-SEARCH.md §3), and the
 * only defence against becoming that is a floor a thin page cannot clear.
 *
 * What the gate refuses, and every one of these is a rule this file pins in both directions:
 *
 *  · a post under the word floor, or with no outline, or with no opening line that answers on its
 *    own;
 *  · a post whose summary is too short to be a search result or too long to survive one;
 *  · a post with no author, no publication date, or no explicit statement of whether a machine
 *    helped write it;
 *  · a tag page with fewer posts than it takes to be a page rather than a duplicate of one post,
 *    or with no words of its own;
 *  · an em dash, anywhere a reader can see it (docs/copy/voice.md §10a).
 */

import { describe, expect, it } from 'bun:test';
import {
  type BlogAuthor,
  type BlogDoc,
  type BlogPost,
  type BlogTag,
  blogViolations,
  byline,
  feedXml,
  findPost,
  findTag,
  formatDate,
  jsonLd,
  POST_WORD_FLOOR,
  parseBlogIndex,
  parsePost,
  postJsonLd,
  postPath,
  postSlug,
  postsWithTag,
  postViolations,
  readingMinutes,
  SUMMARY_MAX,
  SUMMARY_MIN,
  splitFrontMatter,
  TAG_POST_FLOOR,
  tagPath,
  tagViolations,
} from './post';

// --- fixtures ------------------------------------------------------------------------------------

const AUTHORS: BlogAuthor[] = [
  { key: 'syllabus-desk', name: null, role: 'syllabus desk', about: 'Reads the board documents.' },
  { key: 'named', name: 'A Person', role: 'teaching desk', about: 'Writes about teaching.' },
];

const TAGS: BlogTag[] = [
  {
    slug: 'syllabus',
    title: 'Syllabus',
    blurb:
      'What a board actually publishes, where it publishes it, and how to tell a current document from last year.',
  },
  {
    slug: 'thin',
    title: 'Thin',
    blurb: 'A tag with only one post under it, which is a duplicate of that post and not a page.',
  },
];

/** A body long enough to clear the floor, with the outline and the opening line the gate wants. */
function body(words = POST_WORD_FLOOR + 40): string {
  const filler = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
  return [
    '**The opening line answers the question on its own, in one sentence a reader can stop at.**',
    '',
    '## The first heading',
    '',
    filler,
    '',
    '## The second heading',
    '',
    'A short paragraph under the second heading.',
    '',
    '## The third heading',
    '',
    'A short paragraph under the third heading.',
    '',
  ].join('\n');
}

function md(overrides: Record<string, string> = {}, text = body()): string {
  const fields: Record<string, string> = {
    title: 'How to read a syllabus document',
    summary:
      'A board publishes one document that decides the year, and four checks tell you whether you are holding it.',
    published: '2026-09-09',
    author: 'syllabus-desk',
    tags: 'syllabus',
    'ai-assisted': 'true',
    ...overrides,
  };
  const front = Object.entries(fields)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `---\n${front}\n---\n\n${text}`;
}

function post(overrides: Record<string, string> = {}, text = body()): BlogPost {
  return parsePost('01-a-post.md', md(overrides, text));
}

/** A second post that is genuinely a second post: its own address, title and summary. */
function other(overrides: Record<string, string> = {}): BlogPost {
  return {
    ...post({
      title: 'What changed in the syllabus',
      summary:
        'The one document that decides the year changed in three places, and each change is cited to its page.',
      ...overrides,
    }),
    slug: 'another-post',
  };
}

const CTX = { authors: AUTHORS, tags: TAGS };

function doc(posts: BlogPost[]): BlogDoc {
  return {
    title: 'The Wobo blog',
    blurb: 'What we learn while building a tutor, written down.',
    note: 'Written with AI help, checked by a person before it was published.',
    authors: AUTHORS,
    tags: TAGS,
    posts,
  };
}

// --- front matter --------------------------------------------------------------------------------

describe('front matter', () => {
  it('splits the fields from the body and leaves the body untouched', () => {
    const { fields, body: rest } = splitFrontMatter(md());
    expect(fields.title).toBe('How to read a syllabus document');
    expect(fields['ai-assisted']).toBe('true');
    expect(rest.trimStart().startsWith('**The opening line')).toBe(true);
  });

  it('refuses a file with no front matter at all, rather than publishing a nameless page', () => {
    expect(() => splitFrontMatter('# Just a heading\n\nSome words.\n')).toThrow(/front matter/i);
  });

  it('refuses a front matter block that is never closed', () => {
    expect(() => splitFrontMatter('---\ntitle: Half a post\n\nwords\n')).toThrow(/front matter/i);
  });
});

describe('a parsed post', () => {
  it('takes its address from the filename, with the ordering prefix dropped', () => {
    expect(postSlug('01-reading-a-syllabus.md')).toBe('reading-a-syllabus');
    expect(postSlug('reading-a-syllabus.md')).toBe('reading-a-syllabus');
  });

  it('keeps the opening line as the lead and the rest as the body', () => {
    const parsed = post();
    expect(parsed.lead.length).toBeGreaterThan(0);
    expect(parsed.blocks.some((block) => block.k === 'h')).toBe(true);
  });

  it('counts its own words and turns them into a reading time', () => {
    const parsed = post();
    expect(parsed.words).toBeGreaterThan(POST_WORD_FLOOR);
    expect(parsed.minutes).toBe(readingMinutes(parsed.words));
  });

  it('reads the tags as a list and the assistance note as a decision, not a default', () => {
    expect(post().tags).toEqual(['syllabus']);
    expect(post({ 'ai-assisted': 'false' }).aiAssisted).toBe(false);
    expect(() => post({ 'ai-assisted': '' })).toThrow(/ai-assisted/i);
    expect(() => post({ 'ai-assisted': 'maybe' })).toThrow(/ai-assisted/i);
  });

  it('never rounds a reading time down to nothing', () => {
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(1000)).toBe(5);
  });
});

// --- the gate ------------------------------------------------------------------------------------

describe('the quality gate on one post', () => {
  it('passes a post that is actually worth reading', () => {
    expect(postViolations(post(), CTX)).toEqual([]);
  });

  it('refuses a post under the word floor', () => {
    const thin = post(
      {},
      '**An opening line that answers on its own, plainly.**\n\n## One\n\nToo few words here.\n',
    );
    expect(postViolations(thin, CTX).join(' ')).toMatch(/word/i);
  });

  it('refuses a post with no outline a reader can jump through', () => {
    const flat = `**An opening line that answers on its own, plainly.**\n\n${Array.from(
      { length: POST_WORD_FLOOR + 40 },
      (_, i) => `word${i}`,
    ).join(' ')}\n`;
    expect(postViolations(post({}, flat), CTX).join(' ')).toMatch(/heading/i);
  });

  it('refuses a post whose opening line is not an answer on its own', () => {
    const short = `**Too short.**\n\n## One\n\n${'word '.repeat(POST_WORD_FLOOR + 40)}\n\n## Two\n\na\n\n## Three\n\nb\n`;
    expect(postViolations(post({}, short), CTX).join(' ')).toMatch(/opening line/i);
  });

  it('refuses a summary a search result cannot show, and one it would cut off', () => {
    expect(postViolations(post({ summary: 'Too short to say anything.' }), CTX).join(' ')).toMatch(
      new RegExp(String(SUMMARY_MIN)),
    );
    expect(postViolations(post({ summary: 'x'.repeat(SUMMARY_MAX + 1) }), CTX).join(' ')).toMatch(
      new RegExp(String(SUMMARY_MAX)),
    );
  });

  it('refuses an author nobody has declared, and a tag nobody has declared', () => {
    expect(postViolations(post({ author: 'ghost' }), CTX).join(' ')).toMatch(/author/i);
    expect(postViolations(post({ tags: 'not-a-tag' }), CTX).join(' ')).toMatch(/tag/i);
  });

  it('refuses a post with no tag at all', () => {
    expect(postViolations({ ...post(), tags: [] }, CTX).join(' ')).toMatch(/tag/i);
  });

  it('refuses a date that is not a date, and an update that predates the post', () => {
    expect(postViolations(post({ published: 'September' }), CTX).join(' ')).toMatch(/date/i);
    expect(
      postViolations(post({ published: '2026-09-09', updated: '2026-09-01' }), CTX).join(' '),
    ).toMatch(/updated/i);
  });

  it('refuses an em dash anywhere a reader can see one', () => {
    const dashed = post({ title: 'A title with an em dash — like this' });
    expect(postViolations(dashed, CTX).join(' ')).toMatch(/em dash/i);
    const inBody = post(
      {},
      body().replace('A short paragraph under the second heading.', 'A line — with a dash.'),
    );
    expect(postViolations(inBody, CTX).join(' ')).toMatch(/em dash/i);
  });

  it('refuses an address that would collide with the tag pages or the feed', () => {
    expect(postViolations({ ...post(), slug: 'tag' }, CTX).join(' ')).toMatch(/address/i);
    expect(postViolations({ ...post(), slug: 'feed.xml' }, CTX).join(' ')).toMatch(/address/i);
    expect(postViolations({ ...post(), slug: 'Not A Slug' }, CTX).join(' ')).toMatch(/address/i);
  });
});

describe('the quality gate on a tag page', () => {
  it('publishes a tag that has enough posts to be a page of its own', () => {
    const posts = [post(), other()];
    expect(posts.length).toBeGreaterThanOrEqual(TAG_POST_FLOOR);
    expect(tagViolations(TAGS[0] as BlogTag, posts)).toEqual([]);
  });

  it('refuses a tag with one post under it, which is a copy of that post', () => {
    expect(tagViolations(TAGS[1] as BlogTag, [post()]).join(' ')).toMatch(/posts?/i);
  });

  it('refuses a tag with no words of its own', () => {
    const bare: BlogTag = { slug: 'bare', title: 'Bare', blurb: 'Too short.' };
    expect(tagViolations(bare, [post(), post()]).join(' ')).toMatch(/blurb|words/i);
  });
});

describe('the quality gate on the blog as a whole', () => {
  it('passes a blog with posts under it', () => {
    expect(blogViolations(doc([post(), other()]))).toEqual([]);
  });

  it('refuses a blog with nothing on it', () => {
    expect(blogViolations(doc([])).join(' ')).toMatch(/no posts/i);
  });

  it('refuses two posts at one address, or with one title, or with one summary', () => {
    const twin = post({ title: 'Another title entirely' });
    expect(blogViolations(doc([post(), twin])).join(' ')).toMatch(/summary/i);
    expect(blogViolations(doc([post(), post()])).join(' ')).toMatch(/address/i);
    expect(blogViolations(doc([post(), { ...other(), title: post().title }])).join(' ')).toMatch(
      /title/i,
    );
  });
});

// --- what the pages read -------------------------------------------------------------------------

describe('what the pages read', () => {
  it('addresses the blog, a post and a tag under one root', () => {
    expect(postPath('a-post')).toBe('/blog/a-post');
    expect(tagPath('syllabus')).toBe('/blog/tag/syllabus');
  });

  it('finds a post and a tag by address, and nothing for an address it does not hold', () => {
    const d = doc([post()]);
    expect(findPost(d, 'a-post')?.title).toBe('How to read a syllabus document');
    expect(findPost(d, 'nothing-here')).toBeNull();
    expect(findTag(d, 'syllabus')?.title).toBe('Syllabus');
    expect(findTag(d, 'nothing-here')).toBeNull();
  });

  it('lists a tag newest first, and lists nothing for a tag nobody used', () => {
    const older = other({ published: '2026-01-01', title: 'Older' });
    const newer = post({ published: '2026-06-01', title: 'Newer' });
    expect(postsWithTag(doc([older, newer]), 'syllabus').map((p) => p.title)).toEqual([
      'Newer',
      'Older',
    ]);
    expect(postsWithTag(doc([older]), 'thin')).toEqual([]);
  });

  it('writes a byline that names a person where there is one and a desk where there is not', () => {
    expect(byline(AUTHORS[1] as BlogAuthor)).toBe('A Person, teaching desk at Wobo');
    expect(byline(AUTHORS[0] as BlogAuthor)).toBe('the syllabus desk at Wobo');
  });

  it('writes a date the way a person reads one, with no em dash in it', () => {
    expect(formatDate('2026-09-09')).toBe('9 September 2026');
    expect(formatDate('2026-01-31')).toBe('31 January 2026');
  });
});

// --- the canonical, the feed and the structured data ---------------------------------------------

describe('the origin everything syndicates from', () => {
  const origin = 'https://heywobo.com';

  it('gives every post an absolute address at our own origin', () => {
    const data = postJsonLd(origin, doc([post()]), post()) as Record<string, unknown>;
    expect(data['@type']).toBe('BlogPosting');
    expect(data.url).toBe('https://heywobo.com/blog/a-post');
    expect((data.mainEntityOfPage as Record<string, unknown>)['@id']).toBe(
      'https://heywobo.com/blog/a-post',
    );
    expect(data.datePublished).toBe('2026-09-09');
    expect(data.inLanguage).toBe('en-IN');
  });

  it('names the publisher, and names an author only where a person is named', () => {
    const named = post({ author: 'named' });
    const withPerson = postJsonLd(origin, doc([named]), named) as Record<string, unknown>;
    expect((withPerson.author as Record<string, unknown>)['@type']).toBe('Person');
    expect((withPerson.author as Record<string, unknown>).name).toBe('A Person');
    const withDesk = postJsonLd(origin, doc([post()]), post()) as Record<string, unknown>;
    expect((withDesk.author as Record<string, unknown>)['@type']).toBe('Organization');
    expect((withDesk.publisher as Record<string, unknown>).name).toBe('Wobo');
  });

  it('escapes structured data so a closing tag inside it can never end the script', () => {
    expect(jsonLd({ a: '</script><script>alert(1)</script>' })).not.toContain('</script>');
    expect(JSON.parse(jsonLd({ a: '<b>' })).a).toBe('<b>');
  });

  it('writes a feed a reader can subscribe to, newest first, pointing at itself', () => {
    const older = other({ published: '2026-01-01', title: 'Older' });
    const newer = post({ published: '2026-06-01', title: 'Newer' });
    const xml = feedXml(origin, doc([older, newer]));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<link>https://heywobo.com/blog</link>');
    expect(xml).toContain('href="https://heywobo.com/blog/feed.xml"');
    expect(xml.indexOf('<title>Newer</title>')).toBeLessThan(xml.indexOf('<title>Older</title>'));
    expect(xml).toContain('<guid isPermaLink="true">https://heywobo.com/blog/a-post</guid>');
    expect(xml).toContain('<guid isPermaLink="true">https://heywobo.com/blog/another-post</guid>');
  });

  it('escapes a title with an ampersand in it rather than writing broken XML', () => {
    const amp = post({ title: 'Marks & the syllabus' });
    expect(feedXml(origin, doc([amp]))).toContain('<title>Marks &amp; the syllabus</title>');
  });
});

// --- the blog's own index copy ---------------------------------------------------------------------

describe("the blog's registry", () => {
  const readme = [
    '# The Wobo blog',
    '',
    '**What we learn while building a tutor, written down.**',
    '',
    '## Tags',
    '',
    '| slug | title | blurb |',
    '|---|---|---|',
    '| syllabus | Syllabus | What a board publishes, and how to tell this year from last. |',
    '',
    '## Authors',
    '',
    '| key | name | role | about |',
    '|---|---|---|---|',
    '| syllabus-desk |  | syllabus desk | Reads the board documents. |',
    '| named | A Person | teaching desk | Writes about teaching. |',
    '',
    '## The assistance note',
    '',
    'Written with AI help, checked by a person before it was published.',
    '',
  ].join('\n');

  it('reads the title, the blurb, the tags, the authors and the note', () => {
    const index = parseBlogIndex(readme);
    expect(index.title).toBe('The Wobo blog');
    expect(index.blurb).toBe('What we learn while building a tutor, written down.');
    expect(index.tags).toEqual([
      {
        slug: 'syllabus',
        title: 'Syllabus',
        blurb: 'What a board publishes, and how to tell this year from last.',
      },
    ]);
    expect(index.authors[0]).toEqual({
      key: 'syllabus-desk',
      name: null,
      role: 'syllabus desk',
      about: 'Reads the board documents.',
    });
    expect(index.authors[1]?.name).toBe('A Person');
    expect(index.note).toContain('checked by a person');
  });

  it('refuses a registry with no tags and no authors, which would publish nothing', () => {
    expect(() => parseBlogIndex('# A blog\n\n**A blurb.**\n')).toThrow(/tags|authors/i);
  });
});
