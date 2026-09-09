/**
 * THE SUBJECT PAGES /subjects LINKS, so that nine real pages are not orphans.
 *
 * `scripts/prerender.ts` writes a page for every subject hub — /subjects/physics,
 * /subjects/mathematics and seven more — each with the boards that set that subject, the classes
 * it is taught in and the official document behind every placement. Nothing on the built site
 * linked one of them. /subjects itself linked /about, /blog, /contact, the five legal documents,
 * /plans, /security and /subjects, and none of its own nine children; they were reachable only
 * from `sitemap.xml`, which is a list of addresses rather than a way for a reader to get anywhere.
 *
 * THE LIST IS TYPED HERE AND CHECKED AGAINST THE BUILD. /subjects is the highest-intent page on
 * the site and the syllabus tree it would have to read to generate this is 292KB of JSON, which is
 * not a download to put on that page for nine links. So the names are written once and
 * `test/hubs.test.ts` asserts they are exactly the hubs `releasedPages()` publishes, in that
 * order: a subject added or withdrawn fails a test rather than leaving a dead link or an orphan.
 */

import { SiteLink } from '../site/nav';
import { hubPath } from '../syllabus/address';

export interface SubjectPage {
  slug: string;
  name: string;
}

export const SUBJECT_PAGES: readonly SubjectPage[] = [
  { slug: 'biology', name: 'Biology' },
  { slug: 'chemistry', name: 'Chemistry' },
  { slug: 'geography', name: 'Geography' },
  { slug: 'history-and-civics', name: 'History and Civics' },
  { slug: 'mathematics', name: 'Mathematics' },
  { slug: 'physics', name: 'Physics' },
  { slug: 'science', name: 'Science' },
  { slug: 'science-and-technology', name: 'Science and Technology' },
  { slug: 'social-science', name: 'Social Science' },
];

/** The address of one subject page: the syllabus family's own, so the two cannot disagree. */
export const subjectPagePath = hubPath;

/**
 * The nine, as links, on the page they belong to. A strip rather than a list: they are one
 * dimension of the same offer the rest of the page makes, not a second navigation.
 */
export function SubjectPages() {
  return (
    <div className="sb-list sb-pages">
      <span className="sb-lk">The subjects we hold an official syllabus for, one page each</span>
      <div>
        {SUBJECT_PAGES.map((hub) => (
          <SiteLink key={hub.slug} href={subjectPagePath(hub.slug)}>
            {hub.name}
          </SiteLink>
        ))}
      </div>
    </div>
  );
}
