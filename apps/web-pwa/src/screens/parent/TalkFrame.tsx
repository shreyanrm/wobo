/**
 * What stands in front of the ask when it cannot open: no child chosen, not signed in, not a
 * parent account, or no gateway. The reason is the server's own line, never ours; the only words
 * this file adds are the two ways on.
 */

import { Button } from '../../ui/primitives';
import { TALK_COPY } from './talk-copy';

export interface TalkGateProps {
  code: string;
  message: string;
  onChoose: () => void;
  onSignIn: () => void;
}

export function TalkGate({ code, message, onChoose, onSignIn }: TalkGateProps) {
  return (
    <div className="pt-gate" role="status">
      <p className="pt-gate-line">{message}</p>
      {code === 'no_child_selected' || code === 'no_such_child' ? (
        <Button tone="pig" onClick={onChoose}>
          {TALK_COPY.chooseChild}
        </Button>
      ) : null}
      {code === 'sign_in_required' ? (
        <Button tone="pig" onClick={onSignIn}>
          {TALK_COPY.signIn}
        </Button>
      ) : null}
    </div>
  );
}
