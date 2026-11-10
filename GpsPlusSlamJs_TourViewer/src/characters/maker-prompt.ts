/**
 * The prompt the author copies into an image AI: a fixed layout around
 * their own description. The page sends it nowhere.
 */

export const PROMPT_HEAD =
  "Create a character sprite sheet for an outdoor walking-tour app.\n\nCharacter: ";

export const PROMPT_EMPTY =
  "[DESCRIBE YOUR CHARACTER HERE - who they are, rough age, clothing, colours and drawing style.]";

export const PROMPT_BODY = `

Layout - follow it exactly:
- One landscape image with a 3:2 shape (for example 1536 x 1024 pixels).
- Four full-body drawings of the SAME character side by side in a single row. Each drawing sits centred in its own quarter of the width, with clear empty space between neighbours.
- Order from left to right:
  1. IDLE - standing relaxed, facing the viewer, arms at rest, mouth closed, friendly expression.
  2. TALKING A - exactly like drawing 1, only the mouth half open.
  3. TALKING B - exactly like drawing 1, only the mouth wide open, as if saying "ah".
  4. POINTING - same stance and facing as drawing 1, one arm stretched out towards the viewer's RIGHT with an open hand; mouth closed.
- All four drawings at the same size and scale, feet on the same invisible ground line near the bottom edge, nothing cut off.

Background and style:
- Transparent background (PNG with alpha). If you cannot produce real transparency, use one flat, pure white background instead.
- Give the figure a thin dark outline so it separates cleanly from the background.
- No shadow on the ground, no text, no labels, no frames.
- An original character, suitable for all ages - not a copy of an existing character, brand or real person.`;

export const IDEAS = [
  "a friendly fox park ranger with a green hat, flat cartoon style",
  "an old lighthouse keeper in a yellow raincoat, storybook style",
  "a small cheerful dragon who loves old books, flat cartoon style",
  "a market woman with a basket of apples, warm painted style",
] as const;

/** The whole prompt for a description (the placeholder when it is empty). */
export function promptText(desc: string): string {
  return PROMPT_HEAD + (desc.trim() || PROMPT_EMPTY) + PROMPT_BODY;
}
