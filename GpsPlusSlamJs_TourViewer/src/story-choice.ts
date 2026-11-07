/**
 * A station with several stories (the visitor's story picker): which of its
 * stories can be played, what the story panel shows for the station, and
 * when the station ends. Pure: `scene-view.ts` renders the answers.
 *
 * Marks are cosmetic and not stored: they live here for as long as the
 * station is visited, keyed by station id, so a station put back in the
 * queue finds them again. The done state stays the guide's.
 */

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  tourStories,
  type TourStory,
} from "gps-plus-slam-app-framework/ar/tour-story";

import { isPlayableInK4 } from "./scene-player.js";

type StationStories = Pick<TourStation, "children">;
type VisitedStation = Pick<TourStation, "id" | "children">;

/** A story offered in the picker. */
export interface StoryPick {
  readonly story: TourStory;
  /** It was played during this visit. */
  readonly played: boolean;
}

export interface StoryPicker {
  readonly show: "picker";
  readonly picks: readonly StoryPick[];
}

/** What the story panel shows for a station. */
type StationPanel =
  | { readonly show: "nothing" }
  | { readonly show: "card" }
  | { readonly show: "story"; readonly story: TourStory }
  | StoryPicker;

/** The station's stories a visitor can play, in the file's order: an empty
 *  story, or one of quizzes alone, has nothing to show yet. */
export function playableStories(station: StationStories): readonly TourStory[] {
  return tourStories(station).filter((s) => s.children.some(isPlayableInK4));
}

/** A picker button's words: a played story is marked by a sign, not by a
 *  colour alone. */
export function storyPickLabel(pick: StoryPick): string {
  return pick.played ? `✓ ${pick.story.title}` : pick.story.title;
}

export interface StoryChoices {
  /** What the panel shows when it is `station`'s turn; `hasCard`: it has
   *  something to read without a story. */
  panelOf(station: VisitedStation, hasCard: boolean): StationPanel;
  /** A story of `station` ended or was ended: it is marked. The picker to
   *  return to, or null when none is left unplayed and the station ends. */
  storyEnded(station: VisitedStation, storyId: string): StoryPicker | null;
  /** The station is done: a revisit starts unmarked. */
  forget(station: Pick<TourStation, "id">): void;
  /** Everything stopped. */
  clear(): void;
}

export function createStoryChoices(): StoryChoices {
  const played = new Map<string, Set<string>>();

  const pickerOf = (
    station: VisitedStation,
    stories: readonly TourStory[],
  ): StoryPicker => {
    const marks = played.get(station.id);
    return {
      show: "picker",
      picks: stories.map((story) => ({
        story,
        played: marks?.has(story.id) ?? false,
      })),
    };
  };

  return {
    panelOf(station, hasCard) {
      const stories = playableStories(station);
      const [first] = stories;
      if (first === undefined) {
        return { show: hasCard ? "card" : "nothing" };
      }
      if (stories.length === 1) return { show: "story", story: first };
      return pickerOf(station, stories);
    },
    storyEnded(station, storyId) {
      const marks = played.get(station.id) ?? new Set<string>();
      marks.add(storyId);
      played.set(station.id, marks);
      const stories = playableStories(station);
      if (stories.some((s) => !marks.has(s.id))) {
        return pickerOf(station, stories);
      }
      played.delete(station.id);
      return null;
    },
    forget(station) {
      played.delete(station.id);
    },
    clear() {
      played.clear();
    },
  };
}
