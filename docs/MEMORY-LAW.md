# The memory law

**Owner, 2026-09-05, and this supersedes anything that contradicts it:**

> *"What browser storage are you talking about? Is that how Claude chat or ChatGPT chat LLMs work?
> No right? Then why are we doing that? Everything that user does in that account and everything
> that user's memory has is the context for Wobo — their behaviour, thoughts, mindset, learnings,
> courses or whatever it may be within the scope of our application. We hold it in our database
> linked to their account."*

---

## The law

**The database is the record. The account is the key. Everything else is a cache.**

Everything a learner does, and everything Wobo knows about them, lives in our database against their
account id. Not in a browser. Not on a device. A learner signs in on any device, anywhere, and gets
their own Wobo, whole: the same memory, the same history, the same sense of who they are.

That is the standard the owner named, and it is the right one. It is how a person expects an account
to behave in 2026, and anything less is a product that quietly forgets them.

## What was wrong, and it was a real mistake

Fourteen keys held a learner's own state in `localStorage` and nowhere else, and **Wobo's mind — the
behavioural signals, what it had noticed, what it remembered about a learner — was local-only by an
explicit unfinished TODO**: *"localStorage until the mind syncs through KGtoPG."* The sync was always
intended and was never built, so the most personal thing in the product was the least portable.

Four things did follow the account (the conversation, learner state, mastery, and the profile). The
rest stayed on whichever device happened to create it. The homepage promised *"Sign in so everything
stays with you, on any device"*, and that sentence was true of four things and false of the rest.

## What local storage is still FOR, and it is one thing only

This is a PWA, and a learner on a train or a patchy connection must still be able to work. So a local
copy is legitimate — **as a cache and a queue, never as the record.**

| | The record | The cache |
|---|---|---|
| Lives in | our database, keyed to the account | the browser |
| Is the truth when they disagree | **always** | never |
| Survives a new device | yes | no, and does not need to |
| What it is for | being the learner's Wobo | working offline, and painting instantly before the network answers |

The test of any piece of state: **if this device fell in a river, would the learner lose it?** If
yes, it is in the wrong place.

## The rules that follow

1. **Every learner-owned thing is written to the database against the account id.** No exceptions
   granted casually; an exception is a written decision in this file.
2. **Local storage is a write-through cache with an offline queue.** Write locally so the screen is
   instant, enqueue the write, reconcile when the network returns. Never the other way round.
3. **On sign-in, the account is the source.** Pull the learner's record and reconcile the cache to
   it. A device that has been away for a month gets the truth, not its own stale opinion.
4. **A failed write is never silent.** If the queue cannot drain, the learner is told, in one calm
   line, with a way to retry. Telling somebody their work is saved when it is not is the same
   category of failure as a false claim on a page, except the cost is their work.
5. **Nothing learner-owned is keyed to a device.** Genuinely device-level settings are a short,
   named list with a reason each: the auth session itself, mute, the dev inspect flag. That list
   lives in code and a test holds it, so the default is per-account and the exception has to be
   argued for.
6. **Wobo's mind syncs**, and the server half of it is built: `learner.wobo_mind` (migration 0020,
   applied), `GET`/`PUT /v1/me/mind`, `POST /v1/me/mind/forget`, and the record now reaching the
   tutor's prompt instead of the payload. The exact shape a client writes against is
   `docs/MIND-SYNC-CONTRACT.md`. One rule from it belongs in the law itself, because it IS the law
   applied: **a device's snapshot may confirm what the record holds and may never introduce
   anything.** Adding is an explicit verb (`remember`), clearing is an explicit verb (`forget`), and
   counting is a delta the server adds. Anything looser lets a cache that has been in a drawer for a
   month decide what Wobo remembers, which is the failure this law was written to end.
   The behavioural signals, the remembered facts, the sense of the learner:
   database, against the account, like everything else. This is the item the owner cares about most
   and it is the one that was missing.

## The line this does not cross

Holding a learner's context in our database does not mean holding more of it than the product needs.
The memory page stays: a learner can see what Wobo remembers and clear any of it. Erasure reaches
every store. What we hold is what teaching them requires, and the learner can always look at it.
