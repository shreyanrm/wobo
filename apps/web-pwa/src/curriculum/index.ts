/**
 * The curriculum, on the client.
 *
 * One import surface for every screen: what the learner studies, where it came from, how honest we
 * are about it, and the two doors out of "we do not have it" — discovery, and their own syllabus.
 * There is no bundled catalog behind any of it (CURRICULUM.md §10; WOBO-PLAN §13).
 */

export * from './adopt';
export * from './blueprint';
export { BoardSearch } from './BoardSearch';
export { cache } from './cache';
export { curriculum, curriculumReady, gatewayUrl, setCurriculumClient } from './client';
export * from './hooks';
export { ProvenanceLabel, SourceNote } from './Labels';
export { OverlayEditor } from './OverlayEditor';
export { OwnSyllabus } from './OwnSyllabus';
export { LevelPicker, SubjectPicker } from './Pickers';
export * from './placement';
export * from './pool';
export * from './prereq';
export * from './registry';
export { DiscoveryCard, EmptyWorldCard } from './StatusCard';
export * from './search';
export { canonicalSubjectId, subjectFamily, subjectLine } from './subjects';
export { UpgradeCard } from './UpgradeCard';
export * from './world';
