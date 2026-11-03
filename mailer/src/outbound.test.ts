import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import express from "express";
import { testEnv } from "./testEnv";

// nodemailer is replaced before outbound.ts loads, so no test reaches an SMTP server.
const sendMail = mock(async (_message: unknown) => ({ messageId: "<sent@example.com>" }));
mock.module("./env", () => testEnv);
mock.module("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const { sendRouter } = await import("./outbound");

const server = express().use(sendRouter).listen(0);
const { port } = server.address() as { port: number };
afterAll(() => server.close());

function send(body: unknown, secret: string | null = "mailer-secret") {
  return fetch(`http://localhost:${port}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "X-Mailer-Secret": secret }) },
    body: JSON.stringify(body),
  });
}

const message = { to: "anna@example.com", subject: "Re: Refund", text: "Done." };

describe("POST /send", () => {
  beforeEach(() => sendMail.mockClear());

  it("sends from MAIL_FROM with the threading headers and returns the Message-ID", async () => {
    const res = await send({ ...message, inReplyTo: "<m1@example.com>", references: ["<m1@example.com>"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messageId: "<sent@example.com>" });
    expect(sendMail.mock.calls[0]![0]).toEqual({
      from: testEnv.MAIL_FROM,
      ...message,
      inReplyTo: "<m1@example.com>",
      references: ["<m1@example.com>"],
    });
  });

  it.each([
    ["no secret", null],
    ["a wrong secret", "nope"],
  ])("answers 401 with %s", async (_label, secret) => {
    const res = await send(message, secret);
    expect(res.status).toBe(401);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("answers 400 with the first issue for an invalid address", async () => {
    const res = await send({ ...message, to: "not-an-email" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "to must be a valid email address" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("answers 502 when SMTP fails", async () => {
    const error = mock(() => {});
    const original = console.error;
    console.error = error;
    sendMail.mockRejectedValueOnce(new Error("connection refused"));
    const res = await send(message);
    console.error = original;
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't send the email" });
  });
});
