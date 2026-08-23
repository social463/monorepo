import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { devPhotoHandle, photoDataUriFor, AVATARS_DIR } from "./dev-photo";

describe("devPhotoHandle", () => {
  it("derives the handle from the email local part (lowercased)", () => {
    expect(devPhotoHandle("Lucca.Secco@eumedicoresidente.com.br")).toBe(
      "lucca.secco",
    );
  });
});

describe("photoDataUriFor", () => {
  const handle = "teste.foto";
  const file = join(AVATARS_DIR, `${handle}.png`);

  beforeAll(() => {
    mkdirSync(AVATARS_DIR, { recursive: true });
    // PNG 1x1 mínimo
    writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
  });
  afterAll(() => rmSync(file, { force: true }));

  it("returns a data URI when a file exists", () => {
    const uri = photoDataUriFor("teste.foto@empresa.com");
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it("finds versioned avatars under apps/api/assets in the container layout", () => {
    const uri = photoDataUriFor("isabel.queiroz@empresa.com");
    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("returns null when no file exists", () => {
    expect(photoDataUriFor("ninguem@empresa.com")).toBeNull();
  });
});
