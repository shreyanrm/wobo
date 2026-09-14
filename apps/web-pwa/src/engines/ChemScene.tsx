'use client';

/**
 * ChemScene — the chemistry engine (SUBJECTS.md §5): make the unseeable visible. One spec-driven
 * component with four primitives, chosen by `kind`:
 *
 *  • balance    — an interactive equation BALANCER. The learner drags integer coefficients and
 *                 element conservation is checked LIVE, per element, deterministically (pure math,
 *                 no model). Wrong coefficients are refused (the equation reads "not yet"); the
 *                 exact conserving set is accepted. This is the crisp, correctness-never-wrong core.
 *  • titration  — a drop-by-drop titration lab. Strong-acid/strong-base pH is computed
 *                 deterministically per drop and drawn as a live pH curve; the beaker takes the
 *                 indicator's colour law (phenolphthalein: transparent → light pink → deep pink).
 *  • structure  — a 2D molecular structure rendered from SMILES by RDKit-js (lazy-loaded WASM).
 *  • molecule3d — a rotatable 3D molecule rendered by 3Dmol.js (lazy-loaded) from a MOL/PDB block.
 *
 * The renderers (structure / molecule3d) LAZY-LOAD their heavy libraries and degrade invisibly to an
 * honest fallback (the SMILES + formula) if the library is unavailable — the same "refusal is
 * invisible" doctrine the rest of Plexus follows. The balancer and titration need no dependency.
 *
 * Registers as a Wobo scene target: Wobo reads the live coefficients / pH (getSceneState), knows the
 * valid moves (getValidActions), and can DRIVE the scene directly — set a coefficient, add a drop
 * (applyTutorAction). Reduced-motion + mute aware; both themes; sentence-case, playful copy.
 *
 * The element-count parser + conservation check mirror the gateway's `plexus/chem.py` exactly, so a
 * balance spec that would be refused server-side is refused here too (one grammar, both ends).
 */

import { useRegisterTarget, useWoboBus } from '@wobo/wobo';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BarState } from '../screens/course/shared';
import {
  CardBody,
  captionSurface,
  cardTitle,
  lead,
  Scrubber,
  Stage,
  whisper,
} from '../screens/course/shared';
import { sfx } from '../ui/sound';
import { SafeSvg } from './DiagramView';

// --- the spec (discriminated by `kind`) -----------------------------------------------------------

export interface ChemTerm {
  /** A chemical formula, e.g. "H2O", "Ca(OH)2", "Al2(SO4)3". */
  formula: string;
  /** The correct coefficient in the balanced equation (the authored answer; the learner rediscovers it). */
  coefficient: number;
}

export interface ChemBalanceSpec {
  kind: 'balance';
  id: string;
  title: string;
  reactants: ChemTerm[];
  products: ChemTerm[];
  caption?: string;
}

export interface ChemTitrationSpec {
  kind: 'titration';
  id: string;
  title: string;
  /** What is in the flask. */
  analyte: { name: string; kind: 'acid' | 'base'; concentrationM: number; volumeMl: number };
  /** What is dripped in from the burette. */
  titrant: { name: string; kind: 'acid' | 'base'; concentrationM: number };
  /** Volume delivered per drop (mL); default 0.5. */
  dropVolumeMl?: number;
  /** The indicator whose colour law drives the flask (default phenolphthalein). */
  indicator?: 'phenolphthalein' | 'methyl-orange' | 'bromothymol-blue';
  caption?: string;
}

export interface ChemStructureSpec {
  kind: 'structure';
  id: string;
  title: string;
  /** SMILES string, rendered to 2D by RDKit-js. */
  smiles: string;
  /** Human label for the molecule (e.g. "ethanol"). */
  label?: string;
  caption?: string;
}

export interface ChemMolecule3DSpec {
  kind: 'molecule3d';
  id: string;
  title: string;
  /** A 3D structure block (coordinates) — MOL/SDF/PDB/XYZ. 3Dmol renders it rotatable. */
  data: string;
  format: 'mol' | 'sdf' | 'pdb' | 'xyz';
  label?: string;
  caption?: string;
}

export type ChemSceneSpec =
  | ChemBalanceSpec
  | ChemTitrationSpec
  | ChemStructureSpec
  | ChemMolecule3DSpec;

// --- validation (mirrors plexus/chem.py; a spec that cannot render/run is refused) ----------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Element symbols the parser accepts (the school-syllabus subset; shared with chem.py). */
const ELEMENTS: ReadonlySet<string> = new Set([
  'H',
  'He',
  'Li',
  'Be',
  'B',
  'C',
  'N',
  'O',
  'F',
  'Ne',
  'Na',
  'Mg',
  'Al',
  'Si',
  'P',
  'S',
  'Cl',
  'Ar',
  'K',
  'Ca',
  'Sc',
  'Ti',
  'V',
  'Cr',
  'Mn',
  'Fe',
  'Co',
  'Ni',
  'Cu',
  'Zn',
  'Ga',
  'Ge',
  'As',
  'Se',
  'Br',
  'Kr',
  'Rb',
  'Sr',
  'Y',
  'Zr',
  'Ag',
  'Cd',
  'Sn',
  'Sb',
  'I',
  'Xe',
  'Ba',
  'Pt',
  'Au',
  'Hg',
  'Pb',
]);

const FORMULA_TOKEN = /[A-Z][a-z]?|\d+|[()[\]]/g;

/**
 * Element counts for a formula, e.g. "Ca(OH)2" -> {Ca:1, O:2, H:2}. Handles nested ()/[] groups
 * with integer multipliers. Returns null for anything malformed or with an unknown element —
 * a formula the parser cannot prove well-formed never reaches the conservation check.
 */
export function parseFormula(formula: string): Record<string, number> | null {
  if (typeof formula !== 'string') return null;
  let s = formula.trim().replace(/\s+/g, '');
  if (!s) return null;
  // a trailing charge (SO4^2-, Na+) is dropped — conservation is over atoms
  s = s.replace(/\^?\d*[+-]$/, '');
  if (!s || !/^[A-Za-z0-9()[\]]+$/.test(s)) return null;
  const tokens = s.match(FORMULA_TOKEN);
  if (!tokens || tokens.join('') !== s) return null;

  let pos = 0;
  const takeInt = (): number => {
    if (pos < tokens.length && /^\d+$/.test(tokens[pos] ?? '')) {
      const n = Number(tokens[pos]);
      pos += 1;
      return n > 0 ? n : 0;
    }
    return 1;
  };
  const parseGroup = (depth: number): Record<string, number> | null => {
    const counts: Record<string, number> = {};
    while (pos < tokens.length) {
      const tok = tokens[pos] as string;
      if (tok === ')' || tok === ']') {
        if (depth === 0) return null;
        pos += 1;
        const mult = takeInt();
        const out: Record<string, number> = {};
        for (const k in counts) out[k] = (counts[k] ?? 0) * mult;
        return out;
      }
      if (tok === '(' || tok === '[') {
        pos += 1;
        const inner = parseGroup(depth + 1);
        if (inner === null) return null;
        for (const k in inner) counts[k] = (counts[k] ?? 0) + (inner[k] ?? 0);
      } else if (/^[A-Za-z]/.test(tok)) {
        if (!ELEMENTS.has(tok)) return null;
        pos += 1;
        const mult = takeInt();
        counts[tok] = (counts[tok] ?? 0) + mult;
      } else {
        return null; // a bare number with no element/group before it
      }
    }
    if (depth !== 0) return null;
    return counts;
  };
  const result = parseGroup(0);
  if (result === null || Object.keys(result).length === 0 || pos !== tokens.length) return null;
  return result;
}

/** Sum element counts over a side at the given coefficients; null if any term is malformed. */
export function sideTotals(
  terms: { coefficient: number; formula: string }[],
): Record<string, number> | null {
  const total: Record<string, number> = {};
  for (const t of terms) {
    if (!Number.isInteger(t.coefficient) || t.coefficient <= 0) return null;
    const counts = parseFormula(t.formula);
    if (counts === null) return null;
    for (const el in counts) total[el] = (total[el] ?? 0) + t.coefficient * (counts[el] ?? 0);
  }
  return Object.keys(total).length ? total : null;
}

/** True iff every element is conserved across the equation at the given coefficients. */
export function isBalanced(
  reactants: { coefficient: number; formula: string }[],
  products: { coefficient: number; formula: string }[],
): boolean {
  const left = sideTotals(reactants);
  const right = sideTotals(products);
  if (!left || !right) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const k of keys) if ((left[k] ?? 0) !== (right[k] ?? 0)) return false;
  return true;
}

/**
 * Well-formedness gate for a model-supplied SMILES, mirroring the gateway's `valid_smiles`
 * (services/gateway/.../plexus/chem.py): allowed characters only, and a length bound.
 *
 * RDKit is a WASM parser handed a string the model wrote. Refusing anything outside the SMILES
 * alphabet before it gets there keeps the renderer's input inside the shape it documents, and the
 * bound stops a pathological string from being the thing the tab spends its frame budget on.
 */
const SMILES_ALLOWED = /^[A-Za-z0-9()[\]=#\-+@%./\\:]+$/;
const SMILES_MAX = 300;

export function validSmiles(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  return s.length > 0 && s.length <= SMILES_MAX && SMILES_ALLOWED.test(s);
}

function parseTerm(raw: unknown): ChemTerm | null {
  if (!isRecord(raw) || !str(raw.formula)) return null;
  if (parseFormula(raw.formula) === null) return null;
  const coefficient =
    num(raw.coefficient) && Number.isInteger(raw.coefficient) && raw.coefficient > 0
      ? raw.coefficient
      : 1;
  return { formula: raw.formula.trim(), coefficient };
}

/** Validate a generated ChemScene spec — anything unrenderable/unrunnable is refused. */
export function parseChemScene(raw: unknown): ChemSceneSpec | null {
  if (!isRecord(raw)) return null;
  const src = isRecord(raw.spec) ? raw.spec : raw;
  const kind = src.kind;
  const id = str(src.id) ? src.id : 'chem';
  const title = str(src.title) ? src.title : 'chemistry';
  const caption = str(src.caption) ? src.caption : undefined;

  if (kind === 'balance') {
    const reactants = (Array.isArray(src.reactants) ? src.reactants : [])
      .map(parseTerm)
      .filter((t): t is ChemTerm => t !== null);
    const products = (Array.isArray(src.products) ? src.products : [])
      .map(parseTerm)
      .filter((t): t is ChemTerm => t !== null);
    if (reactants.length < 1 || products.length < 1) return null;
    if (reactants.length + products.length > 8) return null;
    // the authored answer MUST actually balance — a spec whose solution does not conserve is refused
    if (!isBalanced(reactants, products)) return null;
    return { kind: 'balance', id, title, reactants, products, caption };
  }

  if (kind === 'titration') {
    const a = isRecord(src.analyte) ? src.analyte : null;
    const t = isRecord(src.titrant) ? src.titrant : null;
    if (!a || !t) return null;
    if (!str(a.name) || (a.kind !== 'acid' && a.kind !== 'base')) return null;
    if (!num(a.concentrationM) || a.concentrationM <= 0 || !num(a.volumeMl) || a.volumeMl <= 0)
      return null;
    if (!str(t.name) || (t.kind !== 'acid' && t.kind !== 'base')) return null;
    if (!num(t.concentrationM) || t.concentrationM <= 0) return null;
    const dropVolumeMl = num(src.dropVolumeMl) && src.dropVolumeMl > 0 ? src.dropVolumeMl : 0.5;
    const indicator =
      src.indicator === 'methyl-orange' || src.indicator === 'bromothymol-blue'
        ? src.indicator
        : 'phenolphthalein';
    return {
      kind: 'titration',
      id,
      title,
      analyte: {
        name: a.name.trim(),
        kind: a.kind,
        concentrationM: a.concentrationM,
        volumeMl: a.volumeMl,
      },
      titrant: { name: t.name.trim(), kind: t.kind, concentrationM: t.concentrationM },
      dropVolumeMl,
      indicator,
      caption,
    };
  }

  if (kind === 'structure') {
    if (!str(src.smiles) || !validSmiles(src.smiles)) return null;
    return {
      kind: 'structure',
      id,
      title,
      smiles: src.smiles.trim(),
      label: str(src.label) ? src.label : undefined,
      caption,
    };
  }

  if (kind === 'molecule3d') {
    if (!str(src.data)) return null;
    if (
      src.format !== 'mol' &&
      src.format !== 'sdf' &&
      src.format !== 'pdb' &&
      src.format !== 'xyz'
    )
      return null;
    return {
      kind: 'molecule3d',
      id,
      title,
      data: src.data,
      format: src.format,
      label: str(src.label) ? src.label : undefined,
      caption,
    };
  }

  return null;
}

// ================================================================================================
// Balancer
// ================================================================================================

/** Renders a formula with subscripts as small text, e.g. H₂O. */
function Formula({ formula, coefficient }: { formula: string; coefficient: number }) {
  const parts = formula.split(/(\d+)/).filter((p) => p !== '');
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {coefficient > 1 && <span style={{ fontWeight: 620, marginRight: 1 }}>{coefficient}</span>}
      {parts.map((p, i) =>
        /^\d+$/.test(p) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional formula fragments
          <sub key={i} style={{ fontSize: '0.72em' }}>
            {p}
          </sub>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional formula fragments
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

function Balancer({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: ChemBalanceSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const terms = useMemo(() => [...spec.reactants, ...spec.products], [spec]);
  // every coefficient starts at 1 — the learner rediscovers the conserving set
  const [coeffs, setCoeffs] = useState<number[]>(() => terms.map(() => 1));
  const [touched, setTouched] = useState(false);
  const maxCoeff = 12;

  const withCoeff = (side: ChemTerm[], offset: number) =>
    side.map((t, i) => ({ formula: t.formula, coefficient: coeffs[offset + i] ?? 1 }));
  const reactants = withCoeff(spec.reactants, 0);
  const products = withCoeff(spec.products, spec.reactants.length);
  const balanced = isBalanced(reactants, products);

  // per-element left/right tallies for the live conservation table
  const left = sideTotals(reactants) ?? {};
  const right = sideTotals(products) ?? {};
  const elements = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();

  const setCoeff = (i: number, v: number) => {
    setCoeffs((prev) => prev.map((c, j) => (j === i ? v : c)));
    if (!touched) {
      setTouched(true);
      sfx.tap();
    }
  };
  const wasBalanced = useRef(false);
  useEffect(() => {
    if (balanced && !wasBalanced.current) sfx.bloom();
    wasBalanced.current = balanced;
  }, [balanced]);

  // continue unlocks once the equation actually balances
  useEffect(() => {
    setBar({ primary: { label: 'continue', disabled: !balanced, onClick: onDone } });
  }, [balanced, setBar, onDone]);

  // Wobo reads the live coefficients + conservation, and can drive a coefficient directly
  const applyTutorAction = (patch: Record<string, unknown>) => {
    const set = isRecord(patch.set) ? patch.set : patch;
    const idx = num(set.index) ? Math.round(set.index) : undefined;
    const v = num(set.value) ? Math.round(set.value) : undefined;
    if (idx !== undefined && v !== undefined && idx >= 0 && idx < terms.length) {
      setCoeff(idx, Math.max(1, Math.min(maxCoeff, v)));
    }
  };
  const ref = useRegisterTarget<HTMLDivElement>(`chem-balance-${spec.id}`, {
    kind: 'controls',
    label: `the equation balancer "${spec.title}" — every coefficient is adjustable`,
    getSceneState: () => ({
      equation: [
        reactants.map((t) => `${t.coefficient} ${t.formula}`).join(' + '),
        products.map((t) => `${t.coefficient} ${t.formula}`).join(' + '),
      ].join(' → '),
      balanced,
      perElement: elements.map((el) => `${el}: ${left[el] ?? 0} vs ${right[el] ?? 0}`),
    }),
    getValidActions: () => terms.map((t, i) => `set coefficient of ${t.formula} (index ${i})`),
    applyTutorAction,
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `chem-balance-${spec.id}`,
      equation: [
        reactants
          .map((t) => (t.coefficient > 1 ? `${t.coefficient}${t.formula}` : t.formula))
          .join(' + '),
        products
          .map((t) => (t.coefficient > 1 ? `${t.coefficient}${t.formula}` : t.formula))
          .join(' + '),
      ].join(' → '),
      steps: [
        ...elements.map(
          (el) =>
            `${el}: left ${left[el] ?? 0}, right ${right[el] ?? 0}${(left[el] ?? 0) === (right[el] ?? 0) ? ' ✓' : ''}`,
        ),
        balanced ? 'every element conserved — balanced' : 'not yet balanced',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec.id, reactants, products, elements, left, right, balanced]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const Side = ({ side, offset }: { side: ChemTerm[]; offset: number }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {side.map((t, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: terms are static per spec; index disambiguates duplicate formulas
          key={`${offset}-${t.formula}-${i}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {i > 0 && <span style={{ color: 'var(--wobo-ink-500)', margin: '0 2px' }}>+</span>}
          <span style={{ color: hue, fontWeight: 600, fontSize: '1.15rem' }}>
            <Scrubber
              value={coeffs[offset + i] ?? 1}
              min={1}
              max={maxCoeff}
              onChange={(v) => setCoeff(offset + i, v)}
              label={`coefficient of ${t.formula}`}
            />
          </span>
          <span style={{ fontSize: '1.15rem', color: 'var(--wobo-ink-900)' }}>
            <Formula formula={t.formula} coefficient={1} />
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <CardBody maxWidth={640}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={whisper}>
          balance it — drag each coefficient until every atom is accounted for
        </div>
        <div style={cardTitle}>{spec.title}</div>

        <Stage hue={hue} tint={0.05} minHeight={132} style={{ padding: 'clamp(16px, 3vw, 26px)' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}
            ref={ref}
          >
            <Side side={spec.reactants} offset={0} />
            <motion.span
              animate={{ color: balanced ? hue : 'var(--wobo-ink-500)' }}
              style={{ fontSize: '1.3rem', fontWeight: 600, margin: '0 4px' }}
            >
              →
            </motion.span>
            <Side side={spec.products} offset={spec.reactants.length} />
          </div>
        </Stage>

        {/* the live conservation ledger — the thing that makes "balanced" visible */}
        <div
          style={{
            border: '0.5px solid var(--wobo-hairline-on-paper-strong)',
            borderRadius: 10,
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={whisper}>atoms on each side</div>
          {elements.map((el) => {
            const l = left[el] ?? 0;
            const r = right[el] ?? 0;
            const ok = l === r;
            return (
              <div
                key={el}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto 1fr auto',
                  alignItems: 'center',
                  gap: 10,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <div style={{ textAlign: 'right', color: 'var(--wobo-ink-700)' }}>{l}</div>
                <div
                  style={{
                    fontWeight: 600,
                    color: ok ? hue : 'var(--wobo-ink-900)',
                    minWidth: 24,
                    textAlign: 'center',
                  }}
                >
                  {el}
                </div>
                <div style={{ textAlign: 'left', color: 'var(--wobo-ink-700)' }}>{r}</div>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={ok ? 'ok' : 'no'}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    style={{ color: ok ? hue : 'var(--wobo-ink-300)', fontSize: '0.9rem' }}
                  >
                    {ok ? '✓' : '≠'}
                  </motion.div>
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {balanced && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{
                border: '1px solid var(--wobo-feedback-correct)',
                background: 'var(--wobo-feedback-correctSoft)',
                borderRadius: 10,
                padding: '14px 16px',
                fontSize: '1rem',
                lineHeight: 1.6,
                color: 'var(--wobo-ink-900)',
              }}
            >
              balanced. every atom that goes in comes out — mass is conserved, so the coefficients
              on both sides now count the same atoms.
            </motion.div>
          )}
        </AnimatePresence>
        {!balanced && (
          <div
            style={{
              ...lead,
              ...captionSurface,
              color: 'var(--wobo-ink-900)',
            }}
          >
            {spec.caption ??
              'nothing is created or destroyed — the same atoms must appear on both sides.'}
          </div>
        )}
      </motion.div>
    </CardBody>
  );
}

// ================================================================================================
// Titration
// ================================================================================================

/** Deterministic strong-acid / strong-base pH after `volumeMl` of titrant has been added. */
export function titrationPH(spec: ChemTitrationSpec, volumeMl: number): number {
  const { analyte, titrant } = spec;
  const molAnalyte = analyte.concentrationM * (analyte.volumeMl / 1000);
  const molTitrant = titrant.concentrationM * (volumeMl / 1000);
  const totalL = (analyte.volumeMl + volumeMl) / 1000;
  // moles of H+ vs OH- currently in the flask
  const acidMol = analyte.kind === 'acid' ? molAnalyte : 0;
  const baseMol = analyte.kind === 'base' ? molAnalyte : 0;
  const addedAcid = titrant.kind === 'acid' ? molTitrant : 0;
  const addedBase = titrant.kind === 'base' ? molTitrant : 0;
  const netAcid = acidMol + addedAcid - (baseMol + addedBase); // >0 acidic, <0 basic
  if (totalL <= 0) return 7;
  if (Math.abs(netAcid) < 1e-12) return 7; // exact equivalence
  if (netAcid > 0) {
    const h = netAcid / totalL;
    return clampPH(-Math.log10(h));
  }
  const oh = -netAcid / totalL;
  return clampPH(14 + Math.log10(oh));
}

const clampPH = (ph: number) => Math.max(0, Math.min(14, ph));

/** Equivalence volume (mL) — where moles of titrant neutralize the analyte. */
export function equivalenceVolumeMl(spec: ChemTitrationSpec): number {
  const molAnalyte = spec.analyte.concentrationM * (spec.analyte.volumeMl / 1000);
  return (molAnalyte / spec.titrant.concentrationM) * 1000;
}

/** The indicator colour law — transparent → light pink → deep pink for phenolphthalein (owner spec). */
function indicatorColor(indicator: ChemTitrationSpec['indicator'], ph: number): string {
  if (indicator === 'methyl-orange') {
    if (ph < 3.1) return 'rgba(214, 69, 34, 0.30)'; // red
    if (ph < 4.4) return 'rgba(240, 160, 40, 0.30)'; // orange
    return 'rgba(240, 200, 40, 0.22)'; // yellow
  }
  if (indicator === 'bromothymol-blue') {
    if (ph < 6.0) return 'rgba(220, 180, 30, 0.26)'; // yellow
    if (ph < 7.6) return 'rgba(80, 170, 90, 0.24)'; // green
    return 'rgba(40, 110, 200, 0.26)'; // blue
  }
  // phenolphthalein — the owner's colour law
  if (ph < 8.2) return 'rgba(255, 255, 255, 0.02)'; // transparent / colorless
  if (ph < 10) return 'rgba(232, 62, 140, 0.22)'; // light pink
  return 'rgba(204, 30, 122, 0.42)'; // deep pink
}

const TITR_VB_W = 200;
const TITR_VB_H = 120;

function Titration({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: ChemTitrationSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  const bus = useWoboBus();
  const dropVol = spec.dropVolumeMl ?? 0.5;
  const equivMl = equivalenceVolumeMl(spec);
  // enough headroom to walk past the endpoint and see the curve's far arm
  const maxMl = Math.max(equivMl * 2, equivMl + 5 * dropVol);
  const maxDrops = Math.max(1, Math.ceil(maxMl / dropVol));
  const [drops, setDrops] = useState(0);

  const volume = drops * dropVol;
  const ph = titrationPH(spec, volume);
  const past = volume >= equivMl; // reached/passed the endpoint
  const fill = indicatorColor(spec.indicator, ph);

  // the pH curve — every point we have visited so far, drawn left to right
  const curve = useMemo(() => {
    const pts: { v: number; ph: number }[] = [];
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const v = (maxMl * i) / steps;
      pts.push({ v, ph: titrationPH(spec, v) });
    }
    return pts;
  }, [spec, maxMl]);

  const curvePath = useMemo(() => {
    const x = (v: number) => 8 + (v / maxMl) * (TITR_VB_W - 16);
    const y = (p: number) => TITR_VB_H - 8 - (p / 14) * (TITR_VB_H - 16);
    // reveal only up to the current volume (the curve draws itself as drops are added)
    const shown = curve.filter((pt) => pt.v <= Math.max(volume, 1e-6));
    if (shown.length < 2) return '';
    return shown
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(pt.v).toFixed(1)} ${y(pt.ph).toFixed(1)}`)
      .join(' ');
  }, [curve, maxMl, volume]);

  const addDrop = () => {
    setDrops((d) => {
      const next = Math.min(maxDrops, d + 1);
      if (next !== d) sfx.tap();
      return next;
    });
  };
  const reachedRef = useRef(false);
  useEffect(() => {
    if (past && !reachedRef.current) {
      reachedRef.current = true;
      sfx.bloom();
    }
  }, [past]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: past/dropVol ARE the triggers; addDrop is recreated every render
  useEffect(() => {
    setBar(
      past
        ? { primary: { label: 'continue', onClick: onDone } }
        : { primary: { label: `add a drop (+${dropVol} mL)`, onClick: addDrop } },
    );
  }, [past, dropVol, setBar, onDone]);

  const applyTutorAction = (patch: Record<string, unknown>) => {
    const set = isRecord(patch.set) ? patch.set : patch;
    if (set.action === 'addDrop') {
      addDrop();
      return;
    }
    if (num(set.volumeMl))
      setDrops(Math.max(0, Math.min(maxDrops, Math.round(set.volumeMl / dropVol))));
  };
  const ref = useRegisterTarget<HTMLDivElement>(`chem-titration-${spec.id}`, {
    kind: 'controls',
    label: `the titration of ${spec.analyte.name} with ${spec.titrant.name}`,
    getSceneState: () => ({
      volumeAddedMl: Number(volume.toFixed(2)),
      pH: Number(ph.toFixed(2)),
      equivalenceMl: Number(equivMl.toFixed(2)),
      pastEndpoint: past,
      indicatorColor: past ? 'pink' : 'colorless',
    }),
    getValidActions: () => [
      'add a drop of titrant',
      `set volume added (0..${maxMl.toFixed(1)} mL)`,
    ],
    applyTutorAction,
  });

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `chem-titration-${spec.id}`,
      steps: [
        `${spec.titrant.name} added: ${volume.toFixed(1)} mL`,
        `pH now: ${ph.toFixed(2)}`,
        `equivalence at: ${equivMl.toFixed(1)} mL`,
        past ? 'endpoint reached — indicator has turned' : 'before the endpoint',
      ],
      lastEditedAt: new Date().toISOString(),
    });
  }, [bus, spec, volume, ph, equivMl, past]);
  useEffect(() => () => bus.publishCanvas(undefined), [bus]);

  const cx = 8 + (Math.min(volume, maxMl) / maxMl) * (TITR_VB_W - 16);
  const cy = TITR_VB_H - 8 - (ph / 14) * (TITR_VB_H - 16);

  return (
    <CardBody maxWidth={640}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={whisper}>
          titrate it — add {spec.titrant.name} drop by drop and watch the pH turn
        </div>
        <div style={cardTitle}>{spec.title}</div>

        <Stage hue={hue} tint={0.05} minHeight={220} style={{ padding: 'clamp(14px, 3vw, 24px)' }}>
          <div
            ref={ref}
            style={{ display: 'flex', gap: 18, alignItems: 'stretch', flexWrap: 'wrap' }}
          >
            {/* the flask, taking the indicator colour */}
            <div
              style={{
                flex: '0 0 auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <svg
                viewBox="0 0 60 90"
                width={72}
                role="img"
                aria-label={`flask of ${spec.analyte.name}`}
              >
                {/* burette drip */}
                <line
                  x1="30"
                  y1="0"
                  x2="30"
                  y2="14"
                  stroke="var(--wobo-ink-300)"
                  strokeWidth="1.2"
                />
                <AnimatePresence>
                  <motion.circle
                    key={drops}
                    cx="30"
                    initial={{ cy: 14, opacity: 0.9 }}
                    animate={{ cy: 44, opacity: 0 }}
                    transition={{ duration: 0.5, ease: 'easeIn' }}
                    r="1.8"
                    fill={hue}
                  />
                </AnimatePresence>
                {/* flask body */}
                <path
                  d="M22 28 L22 42 L12 74 Q12 82 20 82 L40 82 Q48 82 48 74 L38 42 L38 28 Z"
                  fill="var(--wobo-paper)"
                  stroke="var(--wobo-ink-500)"
                  strokeWidth="1.2"
                />
                {/* liquid */}
                <motion.path
                  d="M17 58 L14 74 Q14 80 20 80 L40 80 Q46 80 46 74 L43 58 Z"
                  animate={{ fill }}
                  transition={{ duration: 0.4 }}
                  stroke="none"
                />
                <rect
                  x="24"
                  y="24"
                  width="12"
                  height="6"
                  fill="var(--wobo-paper)"
                  stroke="var(--wobo-ink-500)"
                  strokeWidth="1.2"
                />
              </svg>
              <div style={{ ...whisper, textAlign: 'center' }}>{spec.analyte.name}</div>
            </div>

            {/* the live pH curve */}
            <div style={{ flex: '1 1 260px', minWidth: 240 }}>
              <svg
                viewBox={`0 0 ${TITR_VB_W} ${TITR_VB_H}`}
                width="100%"
                role="img"
                aria-label="pH curve"
              >
                {/* axes */}
                <line
                  x1="8"
                  y1={TITR_VB_H - 8}
                  x2={TITR_VB_W - 8}
                  y2={TITR_VB_H - 8}
                  stroke="var(--wobo-ink-300)"
                  strokeWidth="0.8"
                />
                <line
                  x1="8"
                  y1="8"
                  x2="8"
                  y2={TITR_VB_H - 8}
                  stroke="var(--wobo-ink-300)"
                  strokeWidth="0.8"
                />
                {/* pH 7 guide */}
                <line
                  x1="8"
                  y1={TITR_VB_H - 8 - (7 / 14) * (TITR_VB_H - 16)}
                  x2={TITR_VB_W - 8}
                  y2={TITR_VB_H - 8 - (7 / 14) * (TITR_VB_H - 16)}
                  stroke="var(--wobo-ink-300)"
                  strokeWidth="0.5"
                  strokeDasharray="2 2"
                />
                {/* equivalence marker */}
                <line
                  x1={8 + (equivMl / maxMl) * (TITR_VB_W - 16)}
                  y1="8"
                  x2={8 + (equivMl / maxMl) * (TITR_VB_W - 16)}
                  y2={TITR_VB_H - 8}
                  stroke={hue}
                  strokeWidth="0.5"
                  strokeDasharray="1.5 2"
                  opacity={0.5}
                />
                {curvePath && (
                  <path
                    d={curvePath}
                    fill="none"
                    stroke={hue}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {volume > 0 && <circle cx={cx} cy={cy} r="2.4" fill={hue} />}
                <text
                  x={TITR_VB_W - 10}
                  y={TITR_VB_H - 11}
                  fontSize="6"
                  textAnchor="end"
                  fill="var(--wobo-ink-300)"
                >
                  mL
                </text>
                <text x="11" y="14" fontSize="6" fill="var(--wobo-ink-300)">
                  pH
                </text>
              </svg>
            </div>
          </div>
        </Stage>

        {/* live readouts */}
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', justifyContent: 'center' }}
        >
          {[
            { label: 'added', value: `${volume.toFixed(1)} mL` },
            { label: 'pH', value: ph.toFixed(2) },
            { label: 'equivalence', value: `${equivMl.toFixed(1)} mL` },
          ].map((r) => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--wobo-ink-500)' }}>{r.label}</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={r.value}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                  style={{
                    fontSize: '1.15rem',
                    fontWeight: 560,
                    color: past ? hue : 'var(--wobo-ink-900)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {r.value}
                </motion.span>
              </AnimatePresence>
            </div>
          ))}
        </div>

        <div
          style={{
            ...lead,
            ...captionSurface,
            color: 'var(--wobo-ink-900)',
          }}
        >
          {past
            ? 'the indicator has turned — you have just passed the equivalence point, where the acid and base exactly cancel.'
            : (spec.caption ??
              'watch the pH: it barely moves, then leaps through the endpoint in a single drop.')}
        </div>
      </motion.div>
    </CardBody>
  );
}

// ================================================================================================
// Structure (RDKit-js, 2D) and Molecule3D (3Dmol.js) — lazy-loaded, invisible fallback
// ================================================================================================

// biome-ignore lint/suspicious/noExplicitAny: the WASM module has no shipped types we depend on
let rdkitPromise: Promise<any> | null = null;
// biome-ignore lint/suspicious/noExplicitAny: see above
async function loadRDKit(): Promise<any> {
  if (!rdkitPromise) {
    rdkitPromise = (async () => {
      // dynamic import so the heavy WASM only loads when a structure card is actually shown
      const mod = await import('@rdkit/rdkit');
      // the wasm binary, resolved through Vite as a served asset URL
      const wasm = (await import('@rdkit/rdkit/dist/RDKit_minimal.wasm?url')).default;
      const init = (mod.default ?? mod) as (opts?: unknown) => Promise<unknown>;
      return init({ locateFile: () => wasm });
    })();
  }
  return rdkitPromise;
}

function Structure({ spec, hue }: { spec: ChemStructureSpec; hue: string }) {
  const bus = useWoboBus();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const ref = useRegisterTarget<HTMLDivElement>(`chem-structure-${spec.id}`, {
    kind: 'diagram',
    label: `the 2D structure of ${spec.label ?? spec.smiles}`,
    getSceneState: () => ({ smiles: spec.smiles, label: spec.label, rendered: svg !== null }),
  });

  useEffect(() => {
    let cancelled = false;
    loadRDKit()
      // biome-ignore lint/suspicious/noExplicitAny: WASM module
      .then((RDKit: any) => {
        if (cancelled) return;
        const mol = RDKit.get_mol(spec.smiles);
        if (!mol?.is_valid()) {
          mol?.delete?.();
          setFailed(true);
          return;
        }
        const drawn = mol.get_svg(360, 240);
        mol.delete();
        setSvg(drawn);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [spec.smiles]);

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `chem-structure-${spec.id}`,
      steps: [`molecule: ${spec.label ?? spec.smiles}`, `SMILES: ${spec.smiles}`],
      lastEditedAt: new Date().toISOString(),
    });
    return () => bus.publishCanvas(undefined);
  }, [bus, spec]);

  return (
    <CardBody maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={whisper}>the structure — every bond and atom, drawn from its formula</div>
        <div style={cardTitle}>{spec.title}</div>
        <Stage
          hue={hue}
          tint={0.05}
          minHeight={240}
          style={{ padding: 'clamp(14px, 3vw, 24px)', display: 'flex', justifyContent: 'center' }}
        >
          <div
            ref={ref}
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              width: '100%',
            }}
          >
            {svg ? (
              // RDKit's output is a string built from a MODEL-SUPPLIED SMILES, so it goes through
              // the same parse-and-sanitize door as every other generated SVG (SafeSvg): the DOM
              // tree is adopted from a DOMParser root, never injected as HTML.
              <SafeSvg
                svg={svg}
                label={`the 2D structure of ${spec.label ?? spec.smiles}`}
                style={{ maxWidth: '100%' }}
              />
            ) : failed ? (
              <div style={{ textAlign: 'center', color: 'var(--wobo-ink-700)' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 560, color: 'var(--wobo-ink-900)' }}>
                  {spec.label ?? 'molecule'}
                </div>
                <div style={{ ...whisper, marginTop: 6 }}>SMILES · {spec.smiles}</div>
              </div>
            ) : (
              <div style={whisper}>drawing the structure…</div>
            )}
          </div>
        </Stage>
        {spec.caption && <div style={lead}>{spec.caption}</div>}
      </div>
    </CardBody>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: 3Dmol has partial types we do not depend on
let mol3dPromise: Promise<any> | null = null;
// biome-ignore lint/suspicious/noExplicitAny: see above
async function load3Dmol(): Promise<any> {
  if (!mol3dPromise) mol3dPromise = import('3dmol');
  return mol3dPromise;
}

function Molecule3D({ spec, hue }: { spec: ChemMolecule3DSpec; hue: string }) {
  const bus = useWoboBus();
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  const ref = useRegisterTarget<HTMLDivElement>(`chem-mol3d-${spec.id}`, {
    kind: 'diagram',
    label: `the rotatable 3D model of ${spec.label ?? 'the molecule'}`,
    getSceneState: () => ({ label: spec.label, format: spec.format, rotatable: !failed }),
  });

  useEffect(() => {
    let cancelled = false;
    // biome-ignore lint/suspicious/noExplicitAny: 3Dmol viewer handle
    let viewer: any = null;
    load3Dmol()
      // biome-ignore lint/suspicious/noExplicitAny: 3Dmol namespace
      .then(($3Dmol: any) => {
        if (cancelled || !holder.current) return;
        const create = $3Dmol.createViewer ?? $3Dmol.default?.createViewer;
        viewer = create(holder.current, { backgroundColor: 'white' });
        viewer.addModel(spec.data, spec.format);
        viewer.setStyle({}, { stick: {}, sphere: { scale: 0.28 } });
        viewer.zoomTo();
        viewer.render();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      try {
        viewer?.clear?.();
      } catch {
        /* viewer teardown is best-effort */
      }
    };
  }, [spec.data, spec.format]);

  useEffect(() => {
    bus.publishCanvas({
      nodeId: `chem-mol3d-${spec.id}`,
      steps: [`3D molecule: ${spec.label ?? 'molecule'}`, 'drag to rotate'],
      lastEditedAt: new Date().toISOString(),
    });
    return () => bus.publishCanvas(undefined);
  }, [bus, spec]);

  return (
    <CardBody maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={whisper}>the molecule in 3D — drag to turn it over</div>
        <div style={cardTitle}>{spec.title}</div>
        <Stage hue={hue} tint={0.05} minHeight={280} style={{ padding: 0, overflow: 'hidden' }}>
          <div ref={ref} style={{ width: '100%', height: 300, position: 'relative' }}>
            <div ref={holder} style={{ width: '100%', height: '100%', position: 'relative' }} />
            {failed && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--wobo-ink-700)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div
                    style={{ fontSize: '1.1rem', fontWeight: 560, color: 'var(--wobo-ink-900)' }}
                  >
                    {spec.label ?? 'molecule'}
                  </div>
                  {/* This is the FAILED branch, so "still loading" was never true here as well as
                      being a caption for a wait. What is true is said instead, and the lesson
                      carries on around it. */}
                  <div style={{ ...whisper, marginTop: 6 }}>This one did not open. Carry on.</div>
                </div>
              </div>
            )}
          </div>
        </Stage>
        {spec.caption && <div style={lead}>{spec.caption}</div>}
      </div>
    </CardBody>
  );
}

// ================================================================================================
// The engine entry — switches on kind. structure/molecule3d have no act-gate (viewing is the act),
// so they unlock continue immediately; balance/titration own their own bar.
// ================================================================================================

export function ChemScene({
  spec,
  hue,
  setBar,
  onDone,
}: {
  spec: ChemSceneSpec;
  hue: string;
  setBar: (b: BarState | null) => void;
  onDone: () => void;
}) {
  // viewing primitives unlock continue right away; interactive ones gate it themselves
  const passive = spec.kind === 'structure' || spec.kind === 'molecule3d';
  useEffect(() => {
    if (passive) setBar({ primary: { label: 'continue', onClick: onDone } });
  }, [passive, setBar, onDone]);

  switch (spec.kind) {
    case 'balance':
      return <Balancer spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
    case 'titration':
      return <Titration spec={spec} hue={hue} setBar={setBar} onDone={onDone} />;
    case 'structure':
      return <Structure spec={spec} hue={hue} />;
    case 'molecule3d':
      return <Molecule3D spec={spec} hue={hue} />;
  }
}

// --- hand-authored demos (prove the engine end to end on the gallery bench) ------------------------

export const CHEM_BALANCE_DEMO: ChemBalanceSpec = {
  kind: 'balance',
  id: 'demo-combustion',
  title: 'the burning of methane',
  // CH4 + 2 O2 -> CO2 + 2 H2O
  reactants: [
    { formula: 'CH4', coefficient: 1 },
    { formula: 'O2', coefficient: 2 },
  ],
  products: [
    { formula: 'CO2', coefficient: 1 },
    { formula: 'H2O', coefficient: 2 },
  ],
  caption: 'methane burns in oxygen. balance it so no atom is lost.',
};

export const CHEM_TITRATION_DEMO: ChemTitrationSpec = {
  kind: 'titration',
  id: 'demo-hcl-naoh',
  title: 'strong acid, strong base',
  analyte: { name: 'HCl', kind: 'acid', concentrationM: 0.1, volumeMl: 25 },
  titrant: { name: 'NaOH', kind: 'base', concentrationM: 0.1 },
  dropVolumeMl: 1,
  indicator: 'phenolphthalein',
  caption: '25 mL of 0.1 M HCl, titrated with 0.1 M NaOH.',
};

export const CHEM_STRUCTURE_DEMO: ChemStructureSpec = {
  kind: 'structure',
  id: 'demo-ethanol',
  title: 'ethanol',
  smiles: 'CCO',
  label: 'ethanol',
  caption: 'two carbons, an oxygen, and the hydrogens that fill every remaining bond.',
};
