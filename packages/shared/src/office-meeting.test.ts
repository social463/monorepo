import { describe, expect, it } from "vitest";
import { MEETING_DURATION_MINUTES, officeRoomDeepLinkPath } from "./office-meeting";

describe("officeRoomDeepLinkPath", () => {
  it("monta o caminho da sala com a externalKey", () => {
    expect(officeRoomDeepLinkPath("aurora")).toBe("/escritorio?sala=aurora");
  });

  it("escapa caracteres especiais da externalKey", () => {
    expect(officeRoomDeepLinkPath("sala do time a&b")).toBe(
      "/escritorio?sala=sala%20do%20time%20a%26b",
    );
  });
});

describe("MEETING_DURATION_MINUTES", () => {
  it("oferece as durações do produto em ordem crescente", () => {
    expect([...MEETING_DURATION_MINUTES]).toEqual([15, 30, 45, 60, 90]);
  });
});
