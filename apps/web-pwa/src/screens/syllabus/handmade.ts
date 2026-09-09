/**
 * THE SIXTY-SEVEN PAGES THAT ARE WRITTEN RATHER THAN GENERATED.
 *
 * docs/GROWTH-SEARCH.md §6 is an owner ruling and it is not a preference:
 *
 *   *"Handcrafted, 67 pages. The 4 board pages, the 13 class pages and the 50 subject pages are
 *   written and designed one at a time, with their own opening, their own art and their own answer
 *   to the question a parent is actually asking on that page. These are the pages someone lands on
 *   while deciding, and there are few enough to do properly. They are never generated from a
 *   template with a name swapped, and a test asserts that no two of them share a paragraph."*
 *
 * This file is the written half of that. Every entry below was typed for one address and appears
 * at no other, and `handmade.test.ts` proves it the hard way: no two of the 67 share a paragraph,
 * a sentence, or even a six-word run. When one of these pages is opened, the reader's first
 * paragraph and the one question the page answers are its own, and the generated frame (the chapter
 * list, the provenance, the tutor door) sits underneath them.
 *
 * WHAT IS IN AN ENTRY, and why it is these three things:
 *
 *   `opening`   the page's first paragraph, before the counted list of what is under it. It says
 *               what this board, this year or this subject actually IS, in the way somebody who
 *               has taught it would say it.
 *   `question`  the question a parent is really asking on this page. Not a heading we invented to
 *               have one: the thing that made them search in the first place.
 *   `answer`    ours, written for that question on that page. It never promises a mark, never
 *               names anyone else, never claims an explanation the tier one page does not carry,
 *               and where it says Wobo draws, the same paragraph names another of the forms
 *               (docs/copy/voice.md §8.5).
 *
 * WHAT IS NOT HERE, said plainly rather than left to be discovered. The owner's ruling asks for
 * "their own art" as well, and these pages carry none. The figure that would go on one is drawn
 * per concept by the same pipeline that draws for a learner, and the concept cores that pipeline
 * needs are designed and not built (docs/GROWTH-SEARCH.md §3, the last two paragraphs). Drawing
 * sixty-seven decorations by hand instead would be the swapped-name template the ruling forbids,
 * wearing a picture. So the art waits for the cores, and this comment is the record that it is
 * owed rather than done.
 *
 * The copy law of DESIGN.md §0 and `docs/copy/voice.md` §8 covers every line in here, and
 * `copy.test.ts` runs it over these strings along with everything else the family writes: no class
 * or age range in any direction, no allowance count, no invented person, no late hour, no em dash,
 * no exclamation mark, no vendor, and never a word against anyone.
 */

/** One handwritten page. Three fields, all required: an entry with a gap is not handcrafted. */
export interface Handmade {
  /** The page's own opening paragraph. */
  opening: string;
  /** The question a parent is actually asking here, in their words. */
  question: string;
  /** Our answer to it, written for this page. */
  answer: string;
}

/**
 * Keyed by the page's own address, so a page and its words cannot drift apart: `pages.ts` looks an
 * entry up by the path it just computed, and `handmade.test.ts` fails if a key names an address
 * this build does not publish, or if a published board, class or subject page has no entry.
 */
export const HANDMADE: Readonly<Record<string, Handmade>> = {
  // --- the four boards ------------------------------------------------------------------------

  '/learn/cbse': {
    opening:
      'CBSE sets one syllabus for schools all over the country and publishes it as a document ' +
      'anybody can open. We read those documents rather than a summary of them, and every line on ' +
      'the pages under this one carries the file it came from, the page inside that file, and the ' +
      'day we last looked at it.',
    question: "Is this the syllabus my child's school is actually teaching?",
    answer:
      'It is the one the board published for this session, which is what a CBSE school builds its ' +
      'year around. Schools differ in the order they take it in and in the books they buy, and ' +
      'neither of those changes the chapter list. Where a school hands out a list of its own, you ' +
      'can give that to Wobo and it follows yours instead of this one.',
  },
  '/learn/icse': {
    opening:
      'ICSE is set by the Council for the Indian School Certificate Examinations, and its papers ' +
      'are written as units rather than as a numbered run of chapters with headings underneath. ' +
      'We publish the units as the Council wrote them, and nothing under them, because the ' +
      'Council puts nothing under them.',
    question: 'Why is there less on these pages than on the CBSE ones?',
    answer:
      "Because there is less in the document, and the difference is the Council's rather than " +
      'ours. Filling a unit with plausible headings would be inventing a syllabus, which is the ' +
      'one thing these pages will not do. So a shorter page, and a line saying why it is short. ' +
      'These papers are also still being checked, and every page here says so on its own row.',
  },
  '/learn/isc': {
    opening:
      "ISC is the Council's senior certificate, sat after the school certificate, and the science " +
      "and mathematics papers we publish for it are read straight off the Council's own documents " +
      "rather than off anybody's notes about them.",
    question: 'Is ISC just ICSE again, one year later?',
    answer:
      'No. They are separate papers published for separate certificates, which is why they sit at ' +
      'separate addresses here instead of being folded together. What the two share is a shape: a ' +
      'unit, with no named breakdown beneath it. That is why an ISC page carries the unit, the ' +
      'document behind it and nothing that was not in the document.',
  },
  '/learn/nios': {
    opening:
      'NIOS is the open school, and a learner arrives at it from a hundred different places: a ' +
      'year missed, a move between states, work, a family that needed the help. Its syllabus is ' +
      'published in full, and the edition we hold has been read and checked.',
    question: 'Does an open-school learner get the same tutor as everyone else?',
    answer:
      'The same one. There is no lighter version of Wobo for anybody. It works the answer out on ' +
      'a board while it talks, it says the reasoning aloud, it films the part that is easier ' +
      'watched than read, and it hands over something to drag when moving a thing is the quickest ' +
      "way to see it. All of that runs against the NIOS chapter list rather than somebody else's.",
  },

  // --- the thirteen classes -------------------------------------------------------------------

  '/learn/cbse/class-6': {
    opening:
      'This is the first year of middle school, and it is the year the words change: a sum ' +
      'becomes a problem, and a fact becomes something you are asked to account for. The ' +
      "syllabuses the board sets for it are listed below, each read from the board's own paper.",
    question: 'My child was fine in primary and is suddenly struggling. What happened?',
    answer:
      'Usually nothing has gone wrong. Middle school wants a reason where primary wanted an ' +
      'answer, and a child who could always get there quickly is now being asked to show the ' +
      'road. That is a skill, and it is taught rather than caught. Wobo works one step at a time ' +
      'and stops on the step that is genuinely stuck, instead of starting the chapter again from ' +
      'the top.',
  },
  '/learn/cbse/class-7': {
    opening:
      'This is where the arithmetic of the earlier years turns into algebra, and where science ' +
      'stops being only about things you can watch happen. Three syllabuses, all of them here, ' +
      'each with the document it was read from.',
    question: 'How much of this year actually matters later?',
    answer:
      'More of it than the marks suggest. Integers, fractions and the first letters standing in ' +
      'for numbers are the ground the senior chapters are built on, and a hole here tends to ' +
      'surface two years later as a chapter nobody can explain. Wobo tests the ground beneath a ' +
      'topic before it teaches the topic, and teaches whatever is missing first.',
  },
  '/learn/cbse/class-8': {
    opening:
      "The last year before the board's senior pattern starts shaping everything, and the one " +
      "that carries the ideas the following two years lean on hardest. The board's three " +
      'syllabuses for it are below.',
    question: 'Should we start preparing for the board exam now?',
    answer:
      'Not in the way that word usually means. There is nothing to cram for yet, and a year spent ' +
      'on old question papers this early buys very little. What pays is finishing each chapter ' +
      'properly as it arrives, so that revision, when it comes, is revision. Wobo is built for ' +
      'that rhythm: a little at a time, and whatever slipped comes back before it is lost.',
  },
  '/learn/cbse/class-9': {
    opening:
      'This is the year the syllabus gets long. Mathematics opens out, social science runs to ' +
      'more chapters than any other year of the school course, and the pace is set by what ' +
      'follows rather than by what is being taught.',
    question: 'Why does this year feel harder than the one after it?',
    answer:
      'Because everything new arrives at once and none of it has been seen before, while the ' +
      'following year revisits a great deal of it. That is also why a chapter left half ' +
      'understood here is expensive: it comes back wearing a different name. The list below is ' +
      "the board's own, so you can hold it up against what the school is teaching this term.",
  },
  '/learn/cbse/class-10': {
    opening:
      "This year ends in the board's own examination, and for most families it is the first time " +
      "an outside body marks their child's work. What that examination is set from is published " +
      'by the board, and it is what these pages were read off.',
    question: "Is the board's syllabus the same as what the school tests?",
    answer:
      "The board's paper is set from the board's syllabus, which is the list on these pages. A " +
      "school's own tests through the year belong to the school, and they often go wider or ask " +
      'in a different style. Both are worth taking seriously and neither changes the chapter ' +
      "list. Wobo teaches against the board's list, and when it marks it circles the step that " +
      'went wrong rather than the answer.',
  },
  '/learn/cbse/class-11': {
    opening:
      'A change of subject as much as a change of year: biology, chemistry, mathematics and ' +
      'physics arrive as four separate disciplines, with four separate documents and four ' +
      'vocabularies that do not translate into each other.',
    question: "This year's marks do not count for anything, do they?",
    answer:
      'They count for the thing that counts most, which is the year after it. Almost every senior ' +
      'chapter assumes this one, and a chapter skipped here is a chapter that will not stand up ' +
      "next year. The four syllabuses below are the board's own, each with the file, the page " +
      'inside it and the date we read it.',
  },
  '/learn/cbse/class-12': {
    opening:
      'The year that gets counted, and also the year with the least room in it. The four science ' +
      'and mathematics syllabuses the board publishes for it are set out here, chapter by ' +
      "chapter, off the board's document.",
    question: 'How do we get through this much without the year turning into a panic?',
    answer:
      'By not leaving it to the end, which is easy to say and is exactly what having a tutor ' +
      'within reach is for. A doubt cleared on the day it appears costs a few minutes; the same ' +
      'doubt in the last month costs an evening. Wobo answers one whenever it turns up, in ' +
      'whichever form the idea needs, and keeps its own account of what has not stayed learnt.',
  },
  '/learn/icse/class-9': {
    opening:
      'Six syllabuses run in this year of the ICSE course, and history and civics is the longest ' +
      'of them. The Council publishes each as a set of units, and units are what these pages ' +
      'hold.',
    question: 'Where are the topics under each unit?',
    answer:
      'There are none in the paper, so there are none here. The Council names the unit and leaves ' +
      'the breakdown to the school and the textbook, and a gap like that is not something we fill ' +
      'with a guess. What every unit page does carry is the paper it came from, the section ' +
      'inside it and the day somebody read it.',
  },
  '/learn/icse/class-10': {
    opening:
      'This is the year the school certificate is sat on, and the six syllabuses set for it are ' +
      'reproduced below word for word as the Council set them down, unit by unit.',
    question: 'Does Wobo teach the books my child already has?',
    answer:
      "Wobo teaches the syllabus rather than a publisher's edition of it, and the two line up " +
      'because the books are written to the same paper. Where a school works from a list it wrote ' +
      'itself, hand that over and Wobo follows that one. Nothing here is tied to a title.',
  },
  '/learn/isc/class-11': {
    opening:
      'The first of the two senior ISC years. The four syllabuses we hold for it are the ' +
      "Council's own papers for biology, chemistry, mathematics and physics, and each page names " +
      'the paper it came off.',
    question: 'How different is this from the other senior board?',
    answer:
      'They are different documents with different structures, which is why we keep them apart ' +
      'rather than mapping one onto the other. Setting two boards against each other is not ' +
      'something these pages do. The comparison that is worth your time is between this list and ' +
      'what your school is teaching, and that one you can make on this page.',
  },
  '/learn/isc/class-12': {
    opening:
      "The year the certificate is awarded on, with the Council's syllabuses for the four science " +
      'and mathematics subjects set out unit by unit as the papers set them out.',
    question: 'These are marked provisional. What does that mean?',
    answer:
      "It means we found the paper on the Council's own site and read it, and our second check on " +
      'it has not finished yet. Nothing is held back while that runs, because a unit list read ' +
      'off the real paper is worth more to you than an empty page. Until the check passes, every ' +
      'one of these pages says provisional rather than official.',
  },
  '/learn/nios/class-10': {
    opening:
      "The open school's secondary course, taken by learners of every age and on their own " +
      "timetable rather than a school's. The syllabuses below were read from the edition the open " +
      'school publishes.',
    question: 'Is an open-school syllabus a lighter syllabus?',
    answer:
      'It is a different shape rather than a smaller one. The open school writes for somebody ' +
      'working alone, so its papers name what sits under each chapter in detail, which is why ' +
      'these pages can carry a topic list where a board that publishes only units cannot. The ' +
      'teaching Wobo gives against it is the teaching it gives against anything.',
  },
  '/learn/nios/class-12': {
    opening:
      "The open school's senior secondary course. The four senior syllabuses we hold for it, in " +
      'biology, chemistry, mathematics and physics, come from the papers the open school ' +
      'publishes, read whole and hashed.',
    question: 'Nobody is teaching this to my child. Is that a problem?',
    answer:
      'It is the situation the open school is written for, and it is the situation Wobo is ' +
      'written for too. The chapter list below is the whole of what the course asks for. Wobo ' +
      'takes one chapter at a time, checks that it has stayed learnt before moving on, and brings ' +
      'back whatever slipped, which is the first thing a learner working alone loses.',
  },

  // --- the fifty subjects ---------------------------------------------------------------------

  '/learn/cbse/class-6/mathematics': {
    opening:
      'The year the number line stops being a picture on the wall and starts being a tool. Whole ' +
      'numbers, the first geometry with a name attached to it, and the beginnings of the idea ' +
      'that a letter can stand for something you do not know yet.',
    question: 'My child can do the sums but cannot do the word problems. Why?',
    answer:
      'Because those are two different skills, and only one of them has been practised. Turning a ' +
      'sentence into an equation is the harder half and it is rarely taught on its own. Wobo ' +
      'takes a word problem apart on the board a phrase at a time, shows which words became which ' +
      'symbols, and says the reasoning aloud as it goes.',
  },
  '/learn/cbse/class-6/science': {
    opening:
      'Middle school science begins as a set of things you can look at: what food is made of, ' +
      'what materials do, how a plant is put together, how a magnet behaves. The explanations ' +
      'stay close to the object.',
    question: 'Is it enough to memorise the answers at this stage?',
    answer:
      'It works for a term and stops working after that. The chapters here are the ones later ' +
      'years quietly assume, and a definition remembered without the reason behind it does not ' +
      'survive being asked a slightly different way. Wobo builds the diagram while it explains, ' +
      'and asks the question back at the end to see whether it landed.',
  },
  '/learn/cbse/class-6/social-science': {
    opening:
      'Three subjects share one syllabus here: the past, the earth and the way a country governs ' +
      'itself. Each is taught as a way of asking questions rather than as a list of things that ' +
      'happened.',
    question: 'How is anyone supposed to remember all these dates and names?',
    answer:
      'Mostly by not trying to remember them as a list. A date that hangs off a reason stays; a ' +
      'date on its own does not. Wobo lays a sequence out on a timeline so the order carries the ' +
      'meaning, puts up a short film where a film gets there faster, and comes back to whichever ' +
      'ones did not stick.',
  },
  '/learn/cbse/class-7/mathematics': {
    opening:
      'Integers arrive with their signs, fractions start behaving like numbers rather than pieces ' +
      'of cake, and the first proper algebra appears. It is the year the subject becomes ' +
      'abstract.',
    question: 'Why do the negative signs cause so much trouble?',
    answer:
      'Because a minus sign is doing two jobs at once, and nobody says which one it is doing in ' +
      'any given line. It is a direction and it is an instruction. Wobo separates the two on a ' +
      'number line you can push a marker along, then works the same sum out in symbols beside it ' +
      'so the two views sit together.',
  },
  '/learn/cbse/class-7/science': {
    opening:
      'The year science starts explaining rather than describing. Heat, acids and bases, ' +
      'nutrition in plants and animals, and the first look at what is going on inside something ' +
      'you cannot open.',
    question: 'How do we know this is what the school will actually cover?',
    answer:
      "Because it came out of the board's own paper and the page below says which one, which page " +
      'inside it and the day it was read. That is checkable in a minute: open the document and ' +
      'look. A school may reorder it or spend longer on one chapter, and the list itself is the ' +
      "board's.",
  },
  '/learn/cbse/class-7/social-science': {
    opening:
      'A wide year: medieval history, the workings of the environment, and how power is shared ' +
      'and checked. It covers more ground than any other subject in the year and is often the one ' +
      'left until last.',
    question: 'My child finds this the dullest subject on the timetable. Can that change?',
    answer:
      'Often it can, and usually the problem is that it is being met as a wall of paragraphs. The ' +
      'same chapter as a map that gets drawn while somebody talks over it, or a short film of how ' +
      'a thing actually worked, is a different experience. Wobo picks the form to suit the idea ' +
      'rather than the subject.',
  },
  '/learn/cbse/class-8/mathematics': {
    opening:
      'Rational numbers, linear equations in one variable, quadrilaterals and the first serious ' +
      'exponents. Much of it looks like last year with the difficulty turned up, and the ' +
      'difference is that the reasoning is now expected to be written down.',
    question: 'How much working should a child be showing?',
    answer:
      'Enough that somebody reading it can follow the argument without asking a question. That is ' +
      'the actual standard, and it is also why marks go missing when the answer is right. Wobo ' +
      'writes the working line by line as it solves, so what a full solution looks like is on the ' +
      'screen rather than described.',
  },
  '/learn/cbse/class-8/science': {
    opening:
      'Cells, force and pressure, chemical effects of current, and the first chapters that depend ' +
      'on a model of something too small to see. The subject starts asking for imagination as ' +
      'well as observation.',
    question: 'Which of these chapters come back later?',
    answer:
      'The ones built on a model rather than on an observation, which is most of them. A cell, a ' +
      'force diagram and the idea of a current are all revisited with more asked of them. The ' +
      "chapter list on this page is the board's own, and Wobo will check what is already solid " +
      'before it teaches on top of it.',
  },
  '/learn/cbse/class-8/social-science': {
    opening:
      'Modern history, resources and their use, and the constitution as a working document. It is ' +
      'the year the three strands start talking to each other rather than running in parallel.',
    question: 'There is so much reading here. Where does a child even start?',
    answer:
      'With one chapter, out loud, in order. The volume is what makes this subject feel ' +
      'impossible and the volume is also why skimming fails. Wobo will take a chapter in ' +
      'sections, draw the argument as a shape rather than a paragraph, and ask a question back ' +
      'before moving to the next section.',
  },
  '/learn/cbse/class-9/mathematics': {
    opening:
      'Number systems, polynomials, coordinate geometry and the first formal proofs. This is ' +
      'where mathematics starts asking not just for the answer but for the reason the answer has ' +
      'to be that one.',
    question: 'Why has proof suddenly become the whole point?',
    answer:
      'Because everything after this is built on it, and because a result you can derive is a ' +
      'result you cannot forget in an examination hall. Proof is a habit rather than a talent. ' +
      'Wobo builds one on the board a line at a time and says out loud why each line is allowed ' +
      'to follow the one above it.',
  },
  '/learn/cbse/class-9/science': {
    opening:
      'Matter, atoms and molecules, the cell, motion and the laws that govern it. Four ' +
      'disciplines are quietly present in one syllabus, and each one is being set up for the ' +
      'senior years.',
    question: 'Is this the year to decide whether a child is a science person?',
    answer:
      'It is a bad year to decide it, and a common one for it to be decided by accident. A ' +
      'difficult first chapter on motion is not evidence about a child, it is evidence about a ' +
      'chapter. Wobo will teach the same idea a different way when one way does not land, and ' +
      'then a third, rather than repeating the explanation that already failed.',
  },
  '/learn/cbse/class-9/social-science': {
    opening:
      'The longest syllabus in the school course: revolutions and the making of the modern world, ' +
      'the physical India, democracy as a set of institutions, and the economics of a village. ' +
      'Sixteen chapters, and no filler among them.',
    question: 'Is it possible to be good at this subject without a good memory?',
    answer:
      'Yes, and the children who do best at it usually are not memorising. They are holding a ' +
      'small number of causes and letting the detail hang off those. Wobo draws a cause and its ' +
      'consequences as a diagram you can point at, and reads the argument aloud, so the shape is ' +
      'what gets remembered.',
  },
  '/learn/cbse/class-10/mathematics': {
    opening:
      'Real numbers, pairs of linear equations, quadratics, trigonometry and circles. It is the ' +
      'most examined mathematics syllabus in the country and every chapter of it is fair game in ' +
      'the paper.',
    question: 'Is there a chapter that is safe to leave out?',
    answer:
      "Nobody can promise you one, and a page that named one would be guessing with your child's " +
      'year. What can be said is that the chapters sit on each other, so the cheapest way through ' +
      "is in order. The full list, off the board's own document, is on this page.",
  },
  '/learn/cbse/class-10/science': {
    opening:
      'Chemical reactions, life processes, light, electricity and the environment. Three sciences ' +
      'in one paper, each with its own way of arguing, and the year they are examined together ' +
      'for the first time.',
    question: 'How do we revise three subjects that are marked as one?',
    answer:
      'By treating them as three when learning and as one when practising the paper. The ' +
      'reasoning in a physics numerical and the reasoning in a life-processes answer have almost ' +
      'nothing in common. Wobo works a numerical out on the board with the units carried through ' +
      'every line, and takes a biology answer apart as a labelled figure instead.',
  },
  '/learn/cbse/class-10/social-science': {
    opening:
      'Nationalism and the making of nations, resources and their limits, the machinery of ' +
      'democracy, and development as something that can be measured. The chapters are fewer this ' +
      'year and each one is heavier.',
    question: 'The answers are so long. How long is long enough?',
    answer:
      'Long enough to make the argument and no longer, which is a skill and is examined as one. ' +
      'Padding is visible to a marker. Wobo will take a question, lay out the points it needs in ' +
      'order on the board, and say which of them are the ones actually carrying the marks.',
  },
  '/learn/cbse/class-11/biology': {
    opening:
      'The living world classified, the plant and animal body from the outside in, cell biology, ' +
      'and physiology. It is the year biology stops being a subject you can read the night before ' +
      'and starts being one with structure.',
    question: 'Is there any way through this that is not pure memorisation?',
    answer:
      'There is, and it is the difference between the children who cope and the ones who drown. ' +
      'Almost every list in this syllabus is a list because of a structure underneath it. Wobo ' +
      'draws that structure while it talks, then hands over a labelled figure with the labels ' +
      'taken off so the recall is active rather than a re-read.',
  },
  '/learn/cbse/class-11/chemistry': {
    opening:
      'Structure of the atom, periodicity, bonding, equilibrium, and the first organic chemistry. ' +
      'Three chemistries are running at once here and they are usually taught in parallel, which ' +
      'is what makes the year feel crowded.',
    question: 'Why does organic chemistry feel like a completely different subject?',
    answer:
      'Because it is one. Physical chemistry is arithmetic with a story attached, inorganic is ' +
      'largely pattern, and organic is a set of mechanisms that only make sense as movement. Wobo ' +
      'animates a mechanism arrow by arrow on the board and narrates why the electrons go where ' +
      'they go, which is not a thing a still diagram can do.',
  },
  '/learn/cbse/class-11/mathematics': {
    opening:
      'Sets and functions, trigonometry taken seriously, sequences, straight lines, limits and ' +
      'the first derivatives. The gap between the school certificate year and this one is the ' +
      'widest in the whole course.',
    question: 'My child did well last year and is suddenly lost. Is that normal?',
    answer:
      'It is extremely normal, and it is about the size of the step rather than about your child. ' +
      'This syllabus asks for abstraction that the earlier years never needed. Wobo goes back and ' +
      'tests the ground underneath a topic before teaching it, and teaches the missing piece ' +
      'first rather than pressing on.',
  },
  '/learn/cbse/class-11/physics': {
    opening:
      'Kinematics, laws of motion, work and energy, gravitation, thermodynamics and waves. Ten ' +
      'chapters, and every one of them is a piece of mathematics wearing a physical coat.',
    question: 'Is it a physics problem or a maths problem when a child gets stuck?',
    answer:
      'It is worth finding out, because the two need different help. Not knowing which equation ' +
      'the situation calls for is physics; knowing it and not being able to rearrange it is ' +
      'mathematics. Wobo draws the free-body diagram first, out loud, before a single symbol is ' +
      'written, which usually makes the answer to that question obvious.',
  },
  '/learn/cbse/class-12/biology': {
    opening:
      'Reproduction, genetics and evolution, biology in human welfare, biotechnology and ecology. ' +
      'The syllabus is shorter than the year before it and the questions asked of it are ' +
      'considerably longer.',
    question: 'Why do full marks in this subject feel so hard to reach?',
    answer:
      'Because the paper rewards precision of language rather than volume of it, and the exact ' +
      'term is usually the whole mark. Practising the word matters as much as knowing the idea. ' +
      "Wobo will ask a question back in the paper's own phrasing and mark what is missing from " +
      'the answer rather than simply showing a better one.',
  },
  '/learn/cbse/class-12/chemistry': {
    opening:
      'Solutions, electrochemistry, kinetics, the d block, and a long run of organic chemistry ' +
      'from haloalkanes to biomolecules. It is the heaviest of the four senior syllabuses by ' +
      'volume of named reactions.',
    question: 'How does anyone hold this many reactions in their head?',
    answer:
      'Not as a list, which is the trap. Reactions come in families with a shared mechanism, and ' +
      'a family learnt once carries dozens of individual cases. Wobo builds the mechanism on the ' +
      'board step by step, says what is happening at each arrow, and then gives back the same ' +
      'family with one step blanked to see if it stayed.',
  },
  '/learn/cbse/class-12/mathematics': {
    opening:
      'Relations and functions, matrices and determinants, calculus in both directions, vectors, ' +
      'three-dimensional geometry and probability. Half the paper is calculus and the other half ' +
      'is everything the earlier years were building towards.',
    question: 'Should we be doing past papers or the textbook?',
    answer:
      'Both, in that order, and the order is the part people get wrong. A past paper attempted ' +
      'before the chapter is solid teaches a child that they cannot do it. Wobo works a problem ' +
      'out fully on the board when the chapter is being learnt, and switches to asking rather ' +
      'than showing once it is.',
  },
  '/learn/cbse/class-12/physics': {
    opening:
      'Electrostatics, current, magnetism, electromagnetic induction, optics, dual nature, atoms, ' +
      'nuclei and semiconductors. Nine chapters, of which the electricity and magnetism run is ' +
      'the one that decides most papers.',
    question: 'Are the derivations really worth learning, or should we just do numericals?',
    answer:
      'They are asked for directly, and they are also where the numericals come from, so the ' +
      'choice is a false one. A derivation understood is several numericals you no longer have to ' +
      'remember. Wobo builds a field diagram as it derives, speaks each step as it writes it, and ' +
      'lets you stop it anywhere and ask why.',
  },
  '/learn/icse/class-9/biology': {
    opening:
      'The ICSE life sciences syllabus for this year is published as units, and they run from the ' +
      "cell through the flowering plant to the human body's systems. Each unit below carries the " +
      'paper it came from.',
    question: 'How much detail does this board expect in a biology answer?',
    answer:
      'More than the length of the unit heading suggests, which is exactly the difficulty with a ' +
      'syllabus published as units. The heading tells you the territory, not the depth. This page ' +
      'will not guess at the depth for you, and Wobo teaches the idea as far as the question in ' +
      'front of it goes rather than to a fixed level.',
  },
  '/learn/icse/class-9/chemistry': {
    opening:
      'Matter, the language of chemistry, atomic structure, bonding and the study of acids, bases ' +
      'and salts, listed here as units and nothing more, because that is all the paper gives.',
    question: "Is the chemistry here the same as any other board's?",
    answer:
      'The science is the same and the syllabus is not, which matters more than it sounds. The ' +
      'order, the emphasis and the way a question is asked all differ, and a child preparing from ' +
      "the wrong list wastes weeks. The units on this page are the Council's own, read off the " +
      'paper named below.',
  },
  '/learn/icse/class-9/geography': {
    opening:
      'Geography is a separate subject on this board rather than a strand inside social science, ' +
      'and its units cover the earth as a physical system and the map as a document you have to ' +
      'be able to read.',
    question: 'Why does map work cost so many marks?',
    answer:
      'Because it is a practical skill being examined on paper, and practice is the only thing ' +
      'that moves it. Reading about contour lines does very little. Wobo will draw a section ' +
      'across a contour map while it explains what the spacing means, and then hand the same map ' +
      'over with the reading left for you to do.',
  },
  '/learn/icse/class-9/history-and-civics': {
    opening:
      'The longest of the six syllabuses this year, and the one that puts the machinery of ' +
      'government beside the history that produced it. Eleven of them, and they stand on these ' +
      "pages in the Council's own words and order.",
    question: 'Is this two subjects or one?',
    answer:
      'One paper, two habits of mind, and the children who treat it as one subject usually lose ' +
      'marks in the civics half. History wants a cause and a consequence; civics wants a ' +
      'definition and an example. Wobo answers each in its own shape, and will say which of the ' +
      'two a given question is really asking for.',
  },
  '/learn/icse/class-9/mathematics': {
    opening:
      "The Council's mathematics units for this year cover pure arithmetic, algebra, geometry, " +
      'mensuration, trigonometry and statistics, each as a named unit with the working left to ' +
      'the classroom.',
    question: "Is this board's mathematics harder?",
    answer:
      'It is a different paper rather than a harder one, and this page does not rank one board ' +
      'against another. What is true is that a syllabus published as units leaves more to the ' +
      "school, so what your child's teacher sets is the best guide to depth. Wobo works to the " +
      'depth a given question actually asks for.',
  },
  '/learn/icse/class-9/physics': {
    opening:
      'Measurement, motion, laws of motion, pressure, heat, light, sound, electricity and ' +
      'magnetism, each one a unit the Council names and leaves the school to unpack.',
    question: 'Why does my child understand the theory and still lose marks?',
    answer:
      'Usually it is the numerical work and the units rather than the physics. A right method ' +
      'with a dropped unit is a wrong answer to a marker. Wobo carries the units through every ' +
      'line of the working on the board, out loud, so the place they get lost is visible rather ' +
      'than mysterious.',
  },
  '/learn/icse/class-10/biology': {
    opening:
      "The certificate year's biology units take the plant and the human body further, and add " +
      'the material on health and the environment that the paper leans on. Units only, as the ' +
      'Council publishes them.',
    question: 'Are diagrams really worth the time they take?',
    answer:
      'In this paper they carry marks of their own, and a labelled diagram often answers faster ' +
      'and more completely than a paragraph would. Drawing one from memory is the skill being ' +
      'tested. Wobo builds a figure stroke by stroke while it explains it, and then hands it back ' +
      'blank so the labels can be practised rather than re-read.',
  },
  '/learn/icse/class-10/chemistry': {
    opening:
      'Periodic properties, chemical bonding, acids and bases, analytical chemistry, mole ' +
      'concept, electrolysis, metallurgy and organic chemistry, taken unit by unit from the paper ' +
      'set for the certificate year.',
    question: 'The mole concept has stopped my child dead. Is that common?',
    answer:
      'It is one of the two or three places in the whole course where a class quietly divides, ' +
      'and it divides on one idea rather than on effort. A mole is a counting unit, and until ' +
      'that lands nothing built on it will. Wobo will stay on that single idea, and try it a ' +
      'different way rather than saying the same sentence louder.',
  },
  '/learn/icse/class-10/geography': {
    opening:
      "The longest of this year's ICSE syllabuses. Its units run from map work through the " +
      'climate and the soils of India to agriculture, industry and transport, published as units ' +
      'by the Council.',
    question: 'How much of this is India and how much is the world?',
    answer:
      "The unit headings on this page are the honest answer to that, and they are the Council's " +
      'own wording rather than a paraphrase. What is not here is any breakdown beneath them, ' +
      'because the paper does not carry one. Every page below names the document and the section ' +
      'it was read from.',
  },
  '/learn/icse/class-10/history-and-civics': {
    opening:
      'The units for the certificate year set the working of the union government beside the ' +
      'nationalist movement and the wars and settlements of the twentieth century. Six units, as ' +
      'published.',
    question: 'How do you revise a subject where every answer is an essay?',
    answer:
      'By practising the skeleton rather than the prose. A good answer here is four or five ' +
      'points in a defensible order, and the sentences are the easy part once the order is there. ' +
      'Wobo will lay the points out as a shape on the board, say which one is doing the heavy ' +
      'work, and then ask for the order back.',
  },
  '/learn/icse/class-10/mathematics': {
    opening:
      'Commercial mathematics, algebra, geometry, mensuration, trigonometry, statistics and ' +
      "probability, set out as the Council's own units for the final year of the school " +
      'certificate course.',
    question: 'What is the fastest way to stop making careless mistakes?',
    answer:
      'Writing more lines rather than fewer, which is the opposite of what most children do when ' +
      'they are trying to save time. A skipped line is where the sign gets lost. Wobo shows the ' +
      'full working on the board rather than the compressed version, and says out loud where the ' +
      'answer turned, instead of marking the whole thing wrong.',
  },
  '/learn/icse/class-10/physics': {
    opening:
      'Force, work, energy and power, machines, light, sound, electricity, heat and modern ' +
      'physics, one named unit apiece in the paper for the certificate year, with the document ' +
      'behind each.',
    question: 'Can a child catch up in physics in one year?',
    answer:
      'It happens often, and it depends almost entirely on whether the earlier ideas about force ' +
      'and motion are solid, because everything here leans on them. Wobo tests the ground under a ' +
      'topic before teaching the topic and teaches the gap first, which is the part a rushed ' +
      'catch-up usually skips.',
  },
  '/learn/isc/class-11/biology': {
    opening:
      "The first senior year of the Council's biology course, published as units covering the " +
      'diversity of living organisms, the structure of plants and animals, and cell biology.',
    question: "Is this year's biology needed for the medical entrance papers?",
    answer:
      'A great deal of it is assumed by them, and that is a reason to learn it properly rather ' +
      'than a reason to study for two things at once. These pages hold the school syllabus, which ' +
      'is what the certificate is set from. Wobo teaches against whichever syllabus you point it ' +
      'at, one at a time.',
  },
  '/learn/isc/class-11/chemistry': {
    opening:
      'Atomic structure, periodicity, bonding, states of matter, thermodynamics and the ' +
      'beginnings of organic chemistry, named as units by the Council and left at that.',
    question: 'How much mathematics is there really in chemistry?',
    answer:
      'More than most children expect in the physical chemistry units, and almost none in the ' +
      'organic ones, which is why a single verdict on the subject is usually wrong. Wobo works ' +
      'the arithmetic out line by line where a unit needs it, and switches to a mechanism drawn ' +
      'and talked through where the unit is about movement.',
  },
  '/learn/isc/class-11/mathematics': {
    opening:
      'Sets and functions, algebra, trigonometry, coordinate geometry, calculus and statistics, ' +
      'listed unit by unit for the earlier of the two senior years.',
    question: 'Where does the jump from the certificate year actually happen?',
    answer:
      'At the point where the subject stops asking you to compute and starts asking you to reason ' +
      'about what you are computing with. Functions and limits are usually where a child first ' +
      'feels it. Wobo will slow down at exactly that point, work a limit out on the board, and ' +
      'say what each line is claiming.',
  },
  '/learn/isc/class-11/physics': {
    opening:
      'Measurement, kinematics, dynamics, gravitation, properties of matter, heat and ' +
      'oscillations, with the practical work beside them, are how this board names its senior ' +
      'first-year units.',
    question: 'Does the practical work matter as much as the theory?',
    answer:
      'It carries marks of its own and it also changes how the theory is understood, which is the ' +
      'part that gets forgotten. A reading you have actually taken behaves differently in your ' +
      'head from one you have read about. Wobo can walk through what an experiment is doing and ' +
      'why, and it will not pretend to have done it for you.',
  },
  '/learn/isc/class-12/biology': {
    opening:
      "The senior year's units take in reproduction, genetics and inheritance, applications in " +
      "medicine and agriculture, biotechnology, and ecology, each a named unit in the Council's " +
      'senior paper.',
    question: 'Genetics is the chapter everyone warns about. Is it as bad as they say?',
    answer:
      'It is the one that rewards understanding most and memorisation least, which makes it feel ' +
      'worse and behave better. A cross worked out properly can be reconstructed under pressure; ' +
      'a memorised ratio cannot. Wobo draws the square out and fills it while it explains, then ' +
      'asks for the next one back.',
  },
  '/learn/isc/class-12/chemistry': {
    opening:
      'Solid state, solutions, electrochemistry, kinetics, surface chemistry, the elements, and a ' +
      'long organic run, listed as the units this board publishes for the final senior year.',
    question: 'Is it possible to leave organic chemistry until the end?',
    answer:
      'It is possible and it is expensive, because organic is the part that needs the most ' +
      'repetition over the longest time and the least last-minute reading. Mechanisms settle ' +
      'slowly. Wobo will take one family of reactions at a time and bring it back later on its ' +
      'own initiative, before it has gone.',
  },
  '/learn/isc/class-12/mathematics': {
    opening:
      'Relations and functions, algebra, calculus, probability, vectors and three-dimensional ' +
      'geometry, with the applied sections the Council sets alongside them, published as units.',
    question: 'How much of the senior paper is calculus?',
    answer:
      'Enough that it decides most results, and the unit list on this page is where to look ' +
      'rather than any rule of thumb somebody repeats. What these pages will not do is print a ' +
      'weighting the Council did not publish. Wobo works a calculus problem out in full on the ' +
      'board, talks it through as it goes, and will do it again a different way if the first way ' +
      'did not land.',
  },
  '/learn/isc/class-12/physics': {
    opening:
      'Electrostatics, current electricity, magnetism, electromagnetic induction, optics and ' +
      "modern physics, set down as units in the Council's paper for the senior certificate.",
    question: 'What separates a good physics answer from a correct one?',
    answer:
      'A diagram, a stated assumption, and units carried all the way through. Correct arithmetic ' +
      'with none of those is worth less than most children believe. Wobo draws the diagram first, ' +
      'says the assumption aloud as it makes it, and keeps the units on every line of the ' +
      'working.',
  },
  '/learn/nios/class-10/mathematics': {
    opening:
      "The open school's secondary mathematics course, written for somebody working through it " +
      'without a teacher in the room, which is why its chapters name what sits under them in ' +
      'unusual detail.',
    question: 'Can somebody actually learn mathematics alone?',
    answer:
      'They can, and the thing that decides it is not intelligence but whether anybody is there ' +
      'when a step will not go in. That is the gap Wobo is meant to sit in. It works the step out ' +
      'on the board, says it, and asks it back, at whatever hour the learner is actually sitting ' +
      'down to it.',
  },
  '/learn/nios/class-10/science-and-technology': {
    opening:
      'One course rather than three subjects: the open school puts physics, chemistry and biology ' +
      'together with the technology that comes out of them, and names the topics under every ' +
      'chapter.',
    question: 'Is this course accepted the same way a school certificate is?',
    answer:
      'The open school is a national board and its certificate stands on its own, which is a ' +
      'question for the board rather than for us and one they answer plainly on their own site. ' +
      'What we can say is what is on this page: the chapters, the topics under them, and the ' +
      'document each was read from.',
  },
  '/learn/nios/class-10/social-science': {
    opening:
      'History, geography, political science and economics in a single secondary course, with the ' +
      'topics named under each chapter rather than left to a textbook to decide.',
    question: 'How do we know how deep to go on each topic?',
    answer:
      'The named topics under each chapter are the best guide there is, and they are the open ' +
      "school's own phrasing and not a shortened version of it. That is the advantage of a " +
      'syllabus written for a learner working alone. Wobo teaches to the topic in front of it and ' +
      'stops there rather than wandering into the next one.',
  },
  '/learn/nios/class-12/biology': {
    opening:
      'The senior secondary biology course of the open school, from the diversity of life to ' +
      'reproduction, genetics and ecology, with the topics named under every chapter.',
    question: 'Is there enough here to prepare properly without a coaching class?',
    answer:
      'The syllabus itself is complete, and what is usually missing is not material but somebody ' +
      'to ask at the moment the question arrives. Wobo is there the moment one appears, draws the ' +
      'structure under discussion, and puts a process on film where watching it beats reading ' +
      'about it.',
  },
  '/learn/nios/class-12/chemistry': {
    opening:
      "The open school's senior chemistry course, covering atomic structure, states of matter, " +
      'chemical energetics, the elements and organic chemistry, each chapter broken into named ' +
      'topics.',
    question: 'Which topics are worth the most time?',
    answer:
      'Not something this page will guess at, because a weighting we have not read off the open ' +
      "school's own paper is one we would be inventing. The chapter and topic list below is " +
      "complete and it is the open school's own. Wobo can work through it in order and keep track " +
      'of what has stayed learnt.',
  },
  '/learn/nios/class-12/mathematics': {
    opening:
      "The largest of the open school's senior courses by chapter count: sets, algebra, " +
      'trigonometry, coordinate geometry, calculus, statistics and probability, each with its ' +
      'topics named.',
    question: 'This is a lot of chapters. Where should somebody start?',
    answer:
      'At the beginning, and the reason is structural rather than moral. The later chapters here ' +
      'assume the earlier ones almost without exception, so an order chosen by interest costs ' +
      'more than it saves. Wobo finds out what is already firm before it builds on it, which is ' +
      'what makes starting at the beginning quick rather than slow.',
  },
  '/learn/nios/class-12/physics': {
    opening:
      "The open school's senior physics course, from motion and the laws behind it through heat, " +
      'electricity, magnetism and optics to the modern chapters, with topics named under each.',
    question: 'How does anybody do physics practicals studying at home?',
    answer:
      'That is a question for the open school, which sets out what it requires and where it is ' +
      'done, and their own site is the place to read it rather than ours. On the theory Wobo can ' +
      'do a great deal: it draws the apparatus, works the readings through on the board, and says ' +
      'what each number is telling you.',
  },
};

/** The handwritten page at this address, or null where there is none. */
export function handmade(path: string): Handmade | null {
  return HANDMADE[path] ?? null;
}

/** Every address this file writes. The test holds it against what the family actually publishes. */
export function handmadePaths(): string[] {
  return Object.keys(HANDMADE);
}
