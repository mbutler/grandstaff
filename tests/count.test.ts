import { describe, expect, test } from "bun:test";
import {
  BAR_CELLS, beamGroups, CARDS, countedLength, EIGHTH_SYLLABLES, missMessage, progressMessage, shrinkCopy, valueName,
} from "../src/count/ruler";

describe("eighth-note ruler", () => {
  test("the first three bars fill eight syllables with no gaps", () => {
    expect(CARDS).toHaveLength(3);
    for (const card of CARDS) {
      expect(card.cells).toHaveLength(BAR_CELLS);
      expect(card.spans.reduce((sum, span) => sum + span.length, 0)).toBe(BAR_CELLS);
      expect(card.cells.some((cell) => cell === "rest")).toBe(false);
      for (const span of card.spans) expect(card.cells[span.start]).toBe("play");
    }
  });

  test("quarters own a number and an &", () => {
    expect(CARDS[0]!.spans.map((span) => span.length)).toEqual([2, 2, 2, 2]);
    expect(CARDS[0]!.cells).toEqual(["play", "hold", "play", "hold", "play", "hold", "play", "hold"]);
  });

  test("the shrink trap is a quarter followed by two eighths", () => {
    expect(CARDS[1]!.spans.map((span) => span.length)).toEqual([2, 1, 1, 2, 1, 1]);
    expect(beamGroups(CARDS[1]!.spans)).toEqual([[1, 2], [4, 5]]);
  });

  test("a dotted quarter is three eighths", () => {
    expect(CARDS[2]!.spans.map((span) => span.length)).toEqual([3, 1, 3, 1]);
    expect(beamGroups(CARDS[2]!.spans)).toEqual([]);
  });

  test("saying only the attack leaves a quarter one eighth long", () => {
    expect(countedLength(0, 2, 1)).toBe(1);
    expect(shrinkCopy("&", 2, 1)).toBe("You skipped “&”. That quarter counted as an eighth.");
  });

  test("saying both syllables restores the quarter", () => {
    expect(countedLength(0, 2, 2)).toBe(2);
    expect(valueName(2)).toBe("quarter");
    expect(valueName(3)).toBe("dotted quarter");
  });

  test("skipping the attack does not invent a duration", () => {
    expect(countedLength(0, 2, 0)).toBe(0);
    expect(missMessage(CARDS[0]!, 0)).toBe("You skipped “1”. Say that syllable before the next note.");
  });

  test("jumping off a dotted quarter names three syllables becoming one", () => {
    expect(EIGHTH_SYLLABLES[1]).toBe("&");
    expect(missMessage(CARDS[2]!, 1)).toBe("You skipped “&”. That dotted quarter counted as an eighth.");
  });

  test("a calm prefix asks for the hold", () => {
    expect(progressMessage(CARDS[0]!, 0)).toContain("Spacebar");
    expect(progressMessage(CARDS[0]!, 1)).toBe("Say “&”. This note is still sounding.");
    expect(progressMessage(CARDS[0]!, 8)).toBe(CARDS[0]!.success);
  });
});
