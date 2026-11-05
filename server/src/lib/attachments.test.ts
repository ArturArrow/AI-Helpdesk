import { describe, expect, it } from "bun:test";
import { toAttachmentRows } from "./attachments";

const file = { filename: "a.pdf", contentType: "application/pdf", size: 999 };

describe("toAttachmentRows", () => {
  it("decodes the content and takes the size from the bytes, not from the sender", () => {
    const [row] = toAttachmentRows([{ ...file, content: Buffer.from("hello").toString("base64") }]);
    expect(row).toEqual({ filename: "a.pdf", contentType: "application/pdf", size: 5, data: Buffer.from("hello") });
  });

  it("marks a file without content as too large and keeps the reported size", () => {
    const [row] = toAttachmentRows([{ ...file, contentId: "x@y" }]);
    expect(row).toEqual({ ...file, contentId: "x@y", tooLarge: true });
  });
});
