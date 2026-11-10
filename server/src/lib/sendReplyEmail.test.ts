import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { EmailStatus } from "../../generated/prisma/enums";
import { testEnv } from "./testEnv";

// The database and the mailer's address are replaced before sendReplyEmail.ts loads, so no test
// needs Postgres or reaches a mailer.
type StoredReply = {
  attachments: { filename: string; contentType: string; data: Uint8Array | null }[];
  body: string;
  emailStatus: EmailStatus | null;
  createdAt: Date;
  ticket: { id: number; subject: string; senderEmail: string; messageId: string | null };
};
let stored: StoredReply | null;
let earlier: { messageId: string }[];
const update = mock(async (_args: unknown) => ({}));
const updateMany = mock(async (_args: unknown) => ({ count: 1 }));

mock.module("./env", () => testEnv);
mock.module("./db", () => ({
  prisma: {
    reply: {
      findUnique: async () => stored,
      findMany: async () => earlier,
      update,
      updateMany,
    },
  },
}));

const { replySubject, sendReplyEmail, threadHeaders } = await import("./sendReplyEmail");

describe("threadHeaders", () => {
  it("is empty for a ticket with no Message-IDs", () => {
    expect(threadHeaders(null, [])).toEqual({});
  });

  it("lists the thread oldest first and answers the latest", () => {
    expect(threadHeaders("<t@x>", ["<r1@x>", "<r2@x>"])).toEqual({
      inReplyTo: "<r2@x>",
      references: ["<t@x>", "<r1@x>", "<r2@x>"],
    });
  });

  it("keeps the first and the 99 latest past 100", () => {
    const replies = Array.from({ length: 150 }, (_, i) => `<r${i}@x>`);
    const { inReplyTo, references } = threadHeaders("<t@x>", replies);
    expect(references).toHaveLength(100);
    expect(references![0]).toBe("<t@x>");
    expect(references![1]).toBe("<r51@x>");
    expect(inReplyTo).toBe("<r149@x>");
  });
});

describe("replySubject", () => {
  it("adds Re: once", () => {
    expect(replySubject("Refund")).toBe("Re: Refund");
    expect(replySubject("RE: Refund")).toBe("RE: Refund");
  });
});

describe("sendReplyEmail", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    stored = {
      body: "Your refund is on its way.",
      emailStatus: EmailStatus.pending,
      createdAt: new Date("2026-11-01T10:00:00Z"),
      attachments: [],
      ticket: { id: 7, subject: "Refund", senderEmail: "anna@example.com", messageId: "<t@x>" },
    };
    earlier = [{ messageId: "<c1@x>" }];
    update.mockClear();
    updateMany.mockClear();
    spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => mock.restore());

  function mailerAnswers(status: number, body: unknown = {}) {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status }));
  }

  it("sends the reply in the customer's thread and stores the Message-ID", async () => {
    mailerAnswers(200, { messageId: "<sent@x>" });
    await sendReplyEmail({ replyId: 3 }, false);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://mailer.test/send");
    expect((init!.headers as Record<string, string>)["X-Mailer-Secret"]).toBe("mailer-secret");
    expect(JSON.parse(init!.body as string)).toEqual({
      to: "anna@example.com",
      subject: "Re: Refund",
      text: "Your refund is on its way.",
      inReplyTo: "<c1@x>",
      references: ["<t@x>", "<c1@x>"],
    });
    expect(update.mock.calls[0]![0]).toMatchObject({
      where: { id: 3 },
      data: { emailStatus: EmailStatus.sent, messageId: "<sent@x>" },
    });
  });

  it("sends the reply's files as base64", async () => {
    stored!.attachments = [
      { filename: "faktura-ż.pdf", contentType: "application/pdf", data: new Uint8Array(Buffer.from("%PDF")) },
    ];
    mailerAnswers(200, { messageId: "<sent@x>" });
    await sendReplyEmail({ replyId: 3 }, false);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string).attachments).toEqual([
      { filename: "faktura-ż.pdf", contentType: "application/pdf", content: Buffer.from("%PDF").toString("base64") },
    ]);
  });

  it.each([EmailStatus.sent, EmailStatus.failed, null])("skips a reply whose status is %s", async (status) => {
    stored!.emailStatus = status;
    mailerAnswers(200, { messageId: "<sent@x>" });
    await sendReplyEmail({ replyId: 3 }, false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks a reply the mailer rejects as failed without retrying", async () => {
    mailerAnswers(400, { error: "to must be a valid email address" });
    await sendReplyEmail({ replyId: 3 }, false);
    expect(updateMany.mock.calls[0]![0]).toMatchObject({ data: { emailStatus: EmailStatus.failed } });
    expect(update).not.toHaveBeenCalled();
  });

  it("throws on a mailer error for pg-boss to retry, leaving it pending", async () => {
    mailerAnswers(502, { error: "Couldn't send the email" });
    expect(sendReplyEmail({ replyId: 3 }, false)).rejects.toThrow("mailer answered 502");
    await Promise.resolve();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("marks it failed on the last attempt", async () => {
    spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(sendReplyEmail({ replyId: 3 }, true)).rejects.toThrow("fetch failed");
    expect(updateMany.mock.calls[0]![0]).toMatchObject({ data: { emailStatus: EmailStatus.failed } });
  });
});
