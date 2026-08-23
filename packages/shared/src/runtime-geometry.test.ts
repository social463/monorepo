import {
  createEmptyMapDocumentV1,
  type CollisionObjectV1,
} from "./index";
import { describe, expect, it } from "vitest";
import { moveWithCollisions, runtimeSpawn } from "./runtime-geometry";

const rectangle: CollisionObjectV1 = {
  id: "wall-one",
  layerKey: "collision",
  type: "collision",
  geometry: { kind: "rectangle", x: 100, y: 0, width: 20, height: 200 },
  properties: { name: "Wall" },
};

describe("local map runtime geometry", () => {
  it("uses the default spawn point", () => {
    const document = createEmptyMapDocumentV1();
    const spawn = document.objects.find(
      (object) => object.type === "spawn-point" && object.properties.isDefault,
    );
    if (!spawn || spawn.geometry.kind !== "point") {
      throw new Error("The map fixture must include a default spawn.");
    }
    spawn.geometry.x = 64;
    spawn.geometry.y = 96;
    expect(runtimeSpawn(document)).toEqual({ x: 64, y: 96 });
  });

  it("does not tunnel through a rectangular wall", () => {
    expect(
      moveWithCollisions(
        { x: 70, y: 50 },
        { x: 80, y: 0 },
        10,
        [rectangle],
        400,
        400,
      ),
    ).toEqual({ x: 90, y: 50 });
  });

  it("slides along a wall when moving diagonally", () => {
    const moved = moveWithCollisions(
      { x: 90, y: 50 },
      { x: 30, y: 30 },
      10,
      [rectangle],
      400,
      400,
    );
    expect(moved.x).toBe(90);
    expect(moved.y).toBe(80);
  });

  it("blocks movement against polygonal collisions", () => {
    const polygon: CollisionObjectV1 = {
      id: "diagonal-wall",
      layerKey: "collision",
      type: "collision",
      geometry: {
        kind: "polygon",
        points: [
          { x: 100, y: 40 },
          { x: 160, y: 100 },
          { x: 100, y: 160 },
        ],
      },
      properties: {},
    };
    const moved = moveWithCollisions(
      { x: 70, y: 100 },
      { x: 80, y: 0 },
      10,
      [polygon],
      400,
      400,
    );
    expect(moved.x).toBe(90);
  });

  it("keeps the avatar inside map bounds", () => {
    expect(
      moveWithCollisions(
        { x: 15, y: 15 },
        { x: -50, y: -50 },
        10,
        [],
        400,
        400,
      ),
    ).toEqual({ x: 10, y: 10 });
  });
});

