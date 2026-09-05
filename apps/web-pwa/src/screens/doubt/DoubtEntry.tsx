'use client';

/**
 * The entry — one tap from wherever a learner is, because a doubt arrives mid-lesson and
 * mid-homework and nobody with a textbook open wants to type the question.
 *
 * On a phone the control IS the camera: a file input with `capture="environment"` opens the back
 * camera on the first tap, no screen in between. On a laptop the same input opens the picker (a
 * desktop browser ignores `capture`), and the doubt screen adds drag-and-drop. The photo is made
 * small and upright on the device (capture.ts), handed to the screen in memory (never storage:
 * doubt-store.ts), and the screen opens on the reading.
 *
 * The input is real and focusable, so the keyboard path is Tab, then Enter. Nothing here is a
 * button pretending to be a camera.
 *
 * SIGNED IN FIRST (law 2). The gateway keeps a photo against an account and answers an anonymous
 * session with 403; until 2026-09-05 the camera opened for one anyway, the bytes were uploaded,
 * and only then was the child refused. Now an anonymous session meets the same control as a
 * button that takes them to sign in, before any shutter (`doorFor`, flow.ts).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../../shell/router';
import { useSdk } from '../../store/sdk';
import { CaptureRefused, captureFromFile } from './capture';
import { stashCapture } from './doubt-store';
import { doorFor } from './flow';
import './doubt.css';

export const DOUBT_ENTRY_LABEL = 'I have a doubt: take a photo of the page';
export const DOUBT_SIGN_IN_LABEL = 'Sign in first, then I can read a photo of your page';
export const DOUBT_SIGN_IN_LINE = 'Sign in first and I will read your page.';

/** A camera on the 24px grid at 2.5px, rounded, from the same hand as the nav icons. */
export function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8.5 h3.5 l1.5 -2.5 h6 l1.5 2.5 H20 v10 H4 z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}

/** Turn a picked file into a capture; a line the learner can read when it cannot be. */
export async function takeFile(
  file: File | null | undefined,
): Promise<{ ok: true } | { ok: false; say: string }> {
  if (!file) return { ok: false, say: '' };
  try {
    stashCapture(await captureFromFile(file));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      say:
        err instanceof CaptureRefused ? err.message : 'I could not open that photo. Try another?',
    };
  }
}

export function DoubtEntry() {
  const router = useRouter();
  const sdk = useSdk();
  const door = doorFor(sdk.account);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onChange = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ''; // the same photo twice is still a new doubt
    const took = await takeFile(file);
    if (took.ok) {
      router.navigate({ name: 'doubt' });
      return;
    }
    if (!took.say) return;
    setNote(took.say);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(null), 3200);
  };

  if (door === 'sign-in') {
    return (
      <button
        type="button"
        className="db-entry"
        title={DOUBT_SIGN_IN_LABEL}
        aria-label={DOUBT_SIGN_IN_LABEL}
        data-testid="doubt-entry"
        data-door="sign-in"
        onClick={() => router.navigate({ name: 'sign-in' })}
      >
        <CameraIcon />
      </button>
    );
  }

  return (
    <>
      <label className="db-entry" title={DOUBT_ENTRY_LABEL} data-testid="doubt-entry">
        <CameraIcon />
        <input
          type="file"
          accept="image/*"
          capture="environment"
          aria-label={DOUBT_ENTRY_LABEL}
          onChange={(e) => void onChange(e.currentTarget)}
        />
      </label>
      {note ? (
        <p className="db-entry-note" role="status">
          {note}
        </p>
      ) : (
        <span className="db-entry-note" role="status" hidden />
      )}
    </>
  );
}
