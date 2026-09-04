/**
 * Build step: the board finder on /subjects.
 *
 * The subjects page is the highest-intent page on the site — somebody reading it is checking
 * whether we are for them — and docs/SELL.md §6 gives it one job: remove the "does it cover mine"
 * objection. It cannot do that with a drawing of a search box, and it must not do it with a
 * sentence somebody liked the sound of. So the page ships a real finder over the real registry,
 * and this script is where the registry becomes something a page can hold.
 *
 * It reads TWO sources, both READ ONLY, both owned by the content pipeline:
 *
 *   content/curriculum/frameworks.seed.json   every board and curriculum Wobo can be told it is
 *                                             on: the name, the names it answers to, what kind of
 *                                             thing it is and where. 268 of them at this build.
 *   content/curriculum/syllabi/**             the boards whose OFFICIAL chapter lists we actually
 *                                             hold, subject by subject. Far fewer, and the whole
 *                                             point of this file is that the page can tell the two
 *                                             apart out loud.
 *
 * A syllabus file with `units: null` is one where the document was fetched and the chapter list
 * could NOT be extracted — the file records the blocker. It counts as NOT held, because a board
 * with no chapters behind it is a board we would be overclaiming. docs/SELL.md §5: proof comes
 * from specificity and from transparency, and "every state board we hold the official syllabus
 * for" is only a sale while it is true.
 *
 * Nothing here is typed by hand except the shape. The counts, the names, the subjects and the
 * syllabus year are the sources' own, and a board that leaves the registry fails this build rather
 * than lingering on the page.
 *
 * Run: `bun run scripts/pitch-boards.ts` (wired into `bun run build`).
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const SEED = join(REPO, 'content', 'curriculum', 'frameworks.seed.json');
const SYLLABI = join(REPO, 'content', 'curriculum', 'syllabi');
const OUT = join(HERE, '..', 'src', 'screens', 'pitch', 'boards.json');

// --- what the two sources look like -------------------------------------------------------------

export interface SeedFramework {
  id: string;
  name: string;
  aliases?: string[];
  kind: string;
  country: string | null;
  region: string | null;
}

export interface Seed {
  last_build: string;
  counts: { total: number; countries: number };
  frameworks: SeedFramework[];
}

export interface SyllabusFile {
  framework_id: string;
  subject: string;
  version: string | null;
  units: unknown[] | null;
}

// --- what the page reads ------------------------------------------------------------------------

export interface PitchBoard {
  id: string;
  /** The registry's own full name. */
  name: string;
  /** The shortest name the registry says it answers to — what a chip shows. */
  short: string;
  /** Every other name the registry says it answers to, as the registry writes them. */
  also: string[];
  /** "state board · Telangana" — its kind, and where it is. The registry's own facts. */
  where: string;
  /** The subjects whose official chapter list we hold. Empty where we hold none yet. */
  subjects: string[];
  /** The syllabus year those chapter lists were published for, or null. */
  year: string | null;
  /** How many chapters we hold for this board, across every subject. */
  chapters: number;
}

export interface PitchBoards {
  /** Where this file came from, so nobody wonders whether it was hand-typed. */
  source: string;
  registryBuild: string;
  /** Every board and curriculum in the registry. */
  total: number;
  countries: number;
  /** What we hold the official chapter lists for, counted from the syllabus files themselves. */
  held: { boards: number; syllabuses: number; chapters: number };
  boards: PitchBoard[];
}

/** The word for a registry `kind`, in the page's voice. Shared with the in-app board search. */
export const KIND_WORD: Record<string, string> = {
  national: 'national board',
  state: 'state board',
  international: 'international curriculum',
  open: 'open school',
  homeschool: 'homeschool programme',
  online: 'online school',
  personal: 'your own syllabus',
};

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region' });

/** A country code as a reader would say it. Falls back to the code, never to an invented name. */
export function countryName(code: string | null): string {
  if (!code) return '';
  try {
    return REGIONS.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "state board · Telangana", or as much of it as the registry knows. */
export function whereLine(framework: Pick<SeedFramework, 'kind' | 'country' | 'region'>): string {
  const kind = KIND_WORD[framework.kind] ?? framework.kind;
  const place = framework.region ?? countryName(framework.country);
  return [kind, place].filter(Boolean).join(' · ');
}

/**
 * The shortest name a board answers to — "CBSE" rather than "Central Board of Secondary
 * Education". An alias, never a coinage: whatever this returns, the registry already recognises.
 */
export function shortName(framework: SeedFramework): string {
  const names = [framework.name, ...(framework.aliases ?? [])].filter((n) => n.trim().length > 1);
  return names.reduce((best, name) => (name.length < best.length ? name : best), framework.name);
}

/** Every syllabus file under `content/curriculum/syllabi`, in a stable order. */
function syllabusFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) syllabusFiles(path, out);
    else if (entry.endsWith('.json')) out.push(path);
  }
  return out;
}

export interface Holding {
  subjects: string[];
  year: string | null;
  chapters: number;
  syllabuses: number;
}

/**
 * What we hold, per framework id, counted from the syllabus files.
 *
 * A file with no units is not a holding. It is an honest record of an attempt, and the page says
 * so in its own words rather than counting it as coverage.
 */
export function holdings(files: readonly SyllabusFile[]): Map<string, Holding> {
  const held = new Map<string, Holding>();
  for (const file of files) {
    const chapters = file.units?.length ?? 0;
    if (chapters === 0) continue;
    const entry = held.get(file.framework_id) ?? {
      subjects: [],
      year: file.version,
      chapters: 0,
      syllabuses: 0,
    };
    if (!entry.subjects.includes(file.subject)) entry.subjects.push(file.subject);
    entry.chapters += chapters;
    entry.syllabuses += 1;
    held.set(file.framework_id, entry);
  }
  for (const entry of held.values()) entry.subjects.sort();
  return held;
}

export function buildPitchBoards(seed: Seed, files: readonly SyllabusFile[]): PitchBoards {
  const held = holdings(files);
  const ids = new Set(seed.frameworks.map((f) => f.id));
  for (const id of held.keys()) {
    // A holding that names a board the registry does not carry would put a syllabus behind a board
    // the finder cannot show. Fail the build rather than ship the mismatch.
    if (!ids.has(id)) throw new Error(`pitch-boards: syllabi name '${id}', not in the registry`);
  }

  const boards = seed.frameworks.map((framework): PitchBoard => {
    const short = shortName(framework);
    const holding = held.get(framework.id);
    // Kept in the registry's own casing, because the finder SHOWS the name that matched: an alias
    // lower-cased here would be printed lower-cased on the row. Deduped case-insensitively.
    const seen = new Set([framework.name.toLowerCase(), short.toLowerCase()]);
    const also = (framework.aliases ?? []).filter((alias) => {
      const key = alias.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      id: framework.id,
      name: framework.name,
      short,
      also,
      where: whereLine(framework),
      subjects: holding?.subjects ?? [],
      year: holding?.year ?? null,
      chapters: holding?.chapters ?? 0,
    };
  });

  return {
    source: 'content/curriculum/frameworks.seed.json + content/curriculum/syllabi',
    registryBuild: seed.last_build,
    total: seed.counts.total,
    countries: seed.counts.countries,
    held: {
      boards: held.size,
      syllabuses: [...held.values()].reduce((n, h) => n + h.syllabuses, 0),
      chapters: [...held.values()].reduce((n, h) => n + h.chapters, 0),
    },
    boards,
  };
}

function main(): void {
  const seed = JSON.parse(readFileSync(SEED, 'utf8')) as Seed;
  const files = syllabusFiles(SYLLABI).map(
    (path) => JSON.parse(readFileSync(path, 'utf8')) as SyllabusFile,
  );
  const built = buildPitchBoards(seed, files);
  writeFileSync(OUT, `${JSON.stringify(built, null, 2)}\n`, 'utf8');
  console.log(
    `pitch-boards: ${built.boards.length} boards, ${built.held.boards} with the official chapter lists (${built.held.chapters} chapters)`,
  );
}

if (import.meta.main) main();
