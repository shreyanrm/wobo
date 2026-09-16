"""The deliverability watch (wave 56): where our mail lands, and what happens when it goes wrong.

docs/MAIL-PRIMARY.md, "Watching where we land". The owner: *"we need to keep a track if we went to
spam or not"*, and *"be tactical, dont slow down, and change whats necessary but make sure i get
alerted at shreyan@doteventures.com"*.

Three ways of seeing, one way of answering:

* :mod:`.events` hears the mail provider's signed delivery events (delivered, bounced,
  complained, delayed) at ``POST /v1/mail/events``. A complaint or a hard bounce suppresses that
  address at once for every non-transactional kind, and every event is counted per day and per
  Feedback-ID kind.
* :mod:`.placement` sends one real mail per Primary-relevant kind to seed inboxes we own and
  reads, over IMAP, which folder or tab each landed in. Configured by environment or inert.
* :mod:`.postmaster` reads Google Postmaster Tools (v2): Gmail's spam rate overall and per
  Feedback-ID, the authentication rates, and the compliance verdict. Configured or inert.
* :mod:`.respond` answers without slowing anyone down: a kind over 0.10 percent is paused on its
  own, at 0.30 percent every kind that crossed is paused, sign-in codes and receipts never are,
  and every cause is an alert that is mailed, logged and shown, once an hour at most.

:mod:`.store` keeps all of it in one append-only table (``ops.mail_watch``, migration 0036),
never an address; :mod:`.api` is the cron door and the console's mail desk.

What never happens here: an open pixel, a click rewrite, a utm, a change to the sender, or a
cadence lowered across the board.
"""
