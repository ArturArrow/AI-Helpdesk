import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { simpleParser } from "mailparser";
import { testEnv } from "./testEnv";

mock.module("./env", () => testEnv);
const { forward, toInboundEmail } = await import("./inbound");

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
