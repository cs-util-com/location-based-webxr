# `lectern-check-text.ts` - the reading stand check page's text

## Purpose

`CHECK_TEXT` (`title`, `body`): the narrated-text prototype's record, its
title and first two paragraphs verbatim, so `lectern-check.html` and the
prototype show the same words when compared side by side.

## Invariants

Plain data; two paragraphs a blank line apart, enough for a page turn
within the first paragraph and one to the second.

## Tests

`playwright-tests/lectern-check.spec.js` turns through it.
