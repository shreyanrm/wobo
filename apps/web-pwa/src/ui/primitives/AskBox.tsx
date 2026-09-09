import { type FormEvent, useState } from 'react';
import { Button, type ButtonTone } from './Button';
import { MicIcon } from './icons';

export interface AskBoxProps {
  /** The screen's own line — the box has no copy of its own. */
  placeholder: string;
  /** Controlled text; leave out for an uncontrolled box. */
  value?: string;
  onChange?: (text: string) => void;
  /** Enter, or the Ask button. Blank text never fires. */
  onAsk?: (text: string) => void;
  /** The microphone. Left out, the mic is still drawn but does nothing. */
  onMic?: () => void;
  /** Whether the microphone is drawn at all. The site's ask boxes have only the input and Ask. */
  mic?: boolean;
  /** The button's word. */
  askLabel?: string;
  /** The microphone's accessible name. */
  micLabel?: string;
  /** The input's accessible name. */
  label?: string;
  /**
   * The Ask button's colour. `pig` inside the app, where this box IS the front door and the one
   * pointer on the screen. A public page passes `ink`: there the conversion is the close panel, and
   * a pig pill sitting a screen above it puts two saturated calls to action at the point of
   * decision, which converts worse than one (docs/SELL.md §6, DESIGN.md §0 "one per view").
   */
  tone?: ButtonTone;
  autoFocus?: boolean;
  className?: string;
}

/** The front door: an input on paper-2, the mic on paper, and one Ask button. */
export function AskBox({
  placeholder,
  value,
  onChange,
  onAsk,
  onMic,
  mic = true,
  askLabel = 'Ask',
  micLabel = 'Hold to talk to Wobo',
  label,
  tone = 'pig',
  autoFocus,
  className,
}: AskBoxProps) {
  const [own, setOwn] = useState('');
  const text = value ?? own;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const line = text.trim();
    if (!line) return;
    onAsk?.(line);
    if (value === undefined) setOwn('');
  };
  return (
    // WOBO'S OWN SURFACES ARE NEVER ON THE GLASS (docs/INK-FREEZE-PLAN-TRACE.md §3, Freeze). This
    // box is Wobo's front door on every screen it appears on, so the mark lives HERE rather than
    // on each screen that mounts one: a new screen cannot forget it. The adversary, 2026-09-09,
    // findings 1 and 11: the /chat ask row and the "Hold to talk to Wobo" chip were on the map.
    <form
      className={className ? `wk-ask ${className}` : 'wk-ask'}
      onSubmit={submit}
      data-wobo-surface=""
    >
      <input
        value={text}
        onChange={(e) => {
          if (value === undefined) setOwn(e.target.value);
          onChange?.(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        // biome-ignore lint/a11y/noAutofocus: the home screen is the box — focus belongs here on arrival
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint="send"
      />
      {mic && (
        <button type="button" className="wk-mic" aria-label={micLabel} onClick={onMic}>
          <MicIcon />
        </button>
      )}
      <Button tone={tone} size="sm" type="submit">
        {askLabel}
      </Button>
    </form>
  );
}
