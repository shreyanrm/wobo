/**
 * The progress surfaces — the knowledge map and the parent's report.
 *
 *   import { ProgressSurfaces } from '../screens/progress';
 *
 * `ProgressSurfaces` is the wired pair and the thing a screen mounts. `Constellation` and `Report`
 * are pure and take their data as props, for a screen that wants only one of them; `evidence.ts`
 * and `sky.ts` are the arithmetic and the geometry, with no React in either.
 */

export { type BadgeInput, MAX_CHAPTER_BADGES, reportBadges } from './badges';
export { Constellation, type ConstellationProps } from './Constellation';
export {
  type ChapterRow,
  chapterRows,
  comingUp,
  coversWholeSyllabus,
  heldLater,
  type MinuteBar,
  minuteBars,
  needsAnotherPass,
  type ProgressTopic,
  type Projection,
  peakMinutes,
  projectFinish,
  type Retention,
  type RetentionRead,
  reportNote,
  STATE_WORDS,
  type SyllabusInput,
  type SyllabusReach,
  standings,
  syllabusReach,
  type Tally,
  type TopicState,
  tally,
  totalMinutes,
} from './evidence';
export { ProgressSurfaces } from './ProgressSurfaces';
export { Report, type ReportBadge, type ReportProps } from './Report';
export {
  buildSky,
  newlyLit,
  readSeen,
  SKY_H,
  SKY_W,
  type Sky,
  type SkyEdge,
  type SkyStar,
  writeSeen,
} from './sky';
