import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { simpleParser } from "mailparser";
import { testEnv } from "./testEnv";

mock.module("./env", () => testEnv);
const { forward, toInboundEmail } = await import("./inbound");
const { inboundEmailSchema } = await import("core/schemas/tickets");
const { MAX_ATTACHMENT_BYTES, MAX_STORED_ATTACHMENTS } = await import("core/constants/attachment");

function raw(headers: string[], body: string, contentType = "text/plain; charset=utf-8") {
  return [...headers, `Content-Type: ${contentType}`, "", body].join("\r\n");
}

const parse = (source: string) => simpleParser(source, { keepCidLinks: true });

describe("toInboundEmail", () => {
  it("maps sender, subject, body and threading headers", async () => {
    const email = toInboundEmail(
      await parse(
        raw(
          [
            'From: "Anna Kowalska" <anna@example.com>',
            "Subject: Refund please",
            "Message-ID: <m3@example.com>",
            "In-Reply-To: <m2@example.com>",
            "References: <m1@example.com> <m2@example.com>",
          ],
          "I was charged twice.",
        ),
      ),
    );
    expect(email).toEqual({
      senderEmail: "anna@example.com",
      senderName: "Anna Kowalska",
      subject: "Refund please",
      body: "I was charged twice.",
      bodyHTML: undefined,
      messageId: "<m3@example.com>",
      inReplyTo: "<m2@example.com>",
      references: ["<m1@example.com>", "<m2@example.com>"],
    });
  });

  it("uses the address as the name when there is none", async () => {
    const email = toInboundEmail(await parse(raw(["From: anna@example.com"], "Hi")));
    expect(email.senderName).toBe("anna@example.com");
  });

  it("wraps a single References entry in an array and leaves a missing one out", async () => {
    const one = toInboundEmail(await parse(raw(["From: a@example.com", "References: <m1@example.com>"], "Hi")));
    expect(one.references).toEqual(["<m1@example.com>"]);
    const none = toInboundEmail(await parse(raw(["From: a@example.com"], "Hi")));
    expect(none.references).toBeUndefined();
  });

  it("derives the plain-text body from an HTML-only email and keeps the HTML", async () => {
    const email = toInboundEmail(
      await parse(raw(["From: a@example.com"], "<p>Hello <b>there</b></p>", "text/html; charset=utf-8")),
    );
    expect(email.body).toContain("Hello");
    expect(email.body).not.toContain("<");
    expect(email.bodyHTML).toContain("<b>there</b>");
  });

  it("sends a blank sender when From is missing, for the webhook to reject", async () => {
    const email = toInboundEmail(await parse(raw(["Subject: no sender"], "Hi")));
    expect(email.senderEmail).toBe("");
  });
});

// A multipart email whose parts are given as header lines and a body.
function multipart(subtype: string, parts: { headers: string[]; body: string }[]) {
  const lines = ["From: a@example.com", "MIME-Version: 1.0", `Content-Type: multipart/${subtype}; boundary=X`, ""];
  for (const { headers, body } of parts) lines.push("--X", ...headers, "", body);
  return [...lines, "--X--", ""].join("\r\n");
}

function filePart(filename: string, bytes: Buffer, contentType = "application/pdf") {
  return {
    headers: [
      `Content-Type: ${contentType}`,
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
    ],
    body: bytes.toString("base64"),
  };
}

const textPart = { headers: ["Content-Type: text/plain; charset=utf-8"], body: "See attached." };

describe("toInboundEmail attachments", () => {
  it("leaves attachments out when the email has none", async () => {
    const email = toInboundEmail(await parse(raw(["From: a@example.com"], "Hi")));
    expect(email.attachments).toBeUndefined();
  });

  it("sends a file's name, type, size and content", async () => {
    const pdf = Buffer.from("%PDF-1.7");
    const email = toInboundEmail(await parse(multipart("mixed", [textPart, filePart("invoice.pdf", pdf)])));
    expect(email.attachments).toEqual([
      {
        filename: "invoice.pdf",
        contentType: "application/pdf",
        size: pdf.length,
        contentId: undefined,
        content: pdf.toString("base64"),
      },
    ]);
  });

  it("keeps an inline image's cid, which the HTML still links to", async () => {
    const email = toInboundEmail(
      await parse(
        multipart("related", [
          { headers: ["Content-Type: text/html; charset=utf-8"], body: '<p><img src="cid:shot@x"></p>' },
          {
            headers: [
              "Content-Type: image/png",
              "Content-ID: <shot@x>",
              "Content-Disposition: inline; filename=shot.png",
              "Content-Transfer-Encoding: base64",
            ],
            body: Buffer.from("png").toString("base64"),
          },
        ]),
      ),
    );
    expect(email.bodyHTML).toContain("cid:shot@x");
    expect(email.attachments?.[0]?.contentId).toBe("shot@x");
  });

  it("names a part that has no filename", async () => {
    const nameless = {
      headers: ["Content-Type: application/octet-stream", "Content-Transfer-Encoding: base64"],
      body: Buffer.from("data").toString("base64"),
    };
    const email = toInboundEmail(await parse(multipart("mixed", [textPart, nameless])));
    expect(email.attachments?.[0]?.filename).toBe("attachment");
  });

  it("produces a body the webhook accepts for an email with only a file", async () => {
    const email = toInboundEmail(await parse(multipart("mixed", [filePart("scan.pdf", Buffer.from("pdf"))])));
    expect(email.body).toBe("");
    expect(inboundEmailSchema.parse(email).body).toBe("(no text)");
  });

  it("sends a file over the per-file limit without content, and keeps the ones after it", async () => {
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
    const email = toInboundEmail(
      await parse(multipart("mixed", [textPart, filePart("big.zip", big), filePart("small.pdf", Buffer.from("ok"))])),
    );
    expect(email.attachments?.map(({ filename, content }) => [filename, content !== undefined])).toEqual([
      ["big.zip", false],
      ["small.pdf", true],
    ]);
    expect(email.attachments?.[0]?.size).toBe(big.length);
    expect(inboundEmailSchema.safeParse(email).success).toBe(true);
  });

  it("stops storing once the email's total limit is reached, and the webhook accepts the result", async () => {
    const part = Buffer.alloc(MAX_ATTACHMENT_BYTES);
    const email = toInboundEmail(
      await parse(multipart("mixed", ["a", "b", "c"].map((name) => filePart(`${name}.bin`, part)))),
    );
    expect(email.attachments?.map(({ content }) => content !== undefined)).toEqual([true, true, false]);
    expect(inboundEmailSchema.safeParse(email).success).toBe(true);
  });

  it("stops storing after the file count limit, and the webhook accepts the result", async () => {
    const files = Array.from({ length: MAX_STORED_ATTACHMENTS + 1 }, (_, i) => filePart(`${i}.txt`, Buffer.from("x")));
    const email = toInboundEmail(await parse(multipart("mixed", files)));
    expect(email.attachments?.filter(({ content }) => content !== undefined)).toHaveLength(MAX_STORED_ATTACHMENTS);
    expect(email.attachments).toHaveLength(MAX_STORED_ATTACHMENTS + 1);
    expect(inboundEmailSchema.safeParse(email).success).toBe(true);
  });
});

describe("inboundEmailSchema", () => {
  const email = { senderEmail: "a@example.com", senderName: "A", body: "Hi" };

  it("strips NUL from every text field, which Postgres would answer with a 500", () => {
    const parsed = inboundEmailSchema.parse({
      ...email,
      senderName: "A\0nna",
      subject: "Re\0fund",
      body: "H\0i",
      bodyHTML: "<p>\0</p>",
      messageId: "<m\0@x>",
      inReplyTo: "<r\0@x>",
      references: ["<f\0@x>"],
    });
    expect(parsed).toEqual({
      ...email,
      senderName: "Anna",
      subject: "Refund",
      body: "Hi",
      bodyHTML: "<p></p>",
      messageId: "<m@x>",
      inReplyTo: "<r@x>",
      references: ["<f@x>"],
    });
  });

  it("treats a body of nothing but NUL as blank", () => {
    const result = inboundEmailSchema.safeParse({ ...email, body: "\0\0" });
    expect(result.error?.issues[0]?.message).toBe("body is required");
  });

  it("checks the length after stripping", () => {
    expect(inboundEmailSchema.safeParse({ ...email, subject: `${"s".repeat(998)}\0` }).success).toBe(true);
  });
});

describe("forward", () => {
  const email = { senderEmail: "a@example.com", senderName: "A", body: "Hi", messageId: "<m@example.com>" };
  afterEach(() => mock.restore());

  function respond(status: number) {
    return spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status }));
  }

  it("posts the email with the webhook secret", async () => {
    const fetchSpy = respond(201);
    await forward(email);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(testEnv.WEBHOOK_URL);
    expect((init!.headers as Record<string, string>)["X-Inbound-Secret"]).toBe("inbound-secret");
    expect(JSON.parse(init!.body as string)).toEqual(email);
  });

  it.each([
    [201, "processed"],
    [200, "processed"],
    [400, "failed"],
    [413, "failed"],
    [401, "retry"],
    [500, "retry"],
  ])("answers %i with %s", async (status, result) => {
    spyOn(console, "error").mockImplementation(() => {});
    respond(status);
    expect(await forward(email)).toBe(result as Awaited<ReturnType<typeof forward>>);
  });

  it("retries when the server is unreachable", async () => {
    spyOn(console, "error").mockImplementation(() => {});
    spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await forward(email)).toBe("retry");
  });
});
