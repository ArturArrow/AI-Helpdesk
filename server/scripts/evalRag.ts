// Scores the knowledge base and the auto-resolve prompt on the questions in rag-eval/cases.json:
// where search ranks the chunk that answers each one, whether the model resolves or escalates as
// expected, whether a resolved reply has the expected facts, and whether it's in the ticket's language.
//
//   bun run --filter server eval:rag                    # against the documents already stored
//   bun run --filter server eval:rag --with-fixtures    # adds rag-eval/documents for the run, then deletes them
//   bun run --filter server eval:rag --only=2,6,41      # some questions only
//
// Needs OPENAI_API_KEY and the rag service (RAG_URL, RAG_SECRET, bun run dev:rag). Nothing is stored
// in the helpdesk database. It calls OpenAI once per question (embedding plus model), and the model
// isn't deterministic: compare runs on the totals, and rerun a question that flips before trusting it.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { autoResolveTicket, isAiConfigured } from "../src/lib/ai";
import { RAG_SECRET, RAG_URL, isRagConfigured } from "../src/lib/env";
import { KNOWLEDGE_EXCERPTS, addRagDocument, deleteRagDocument, listRagDocuments, searchKnowledge } from "../src/lib/rag";

type Case = {
  id: number;
  subject: string;
  body: string;
  language: "pl" | "en";
  document: string | null;
  marker: string | null;
  expect: "resolve" | "escalate" | "either";
  facts: string[];
};

const EVAL_DIR = join(import.meta.dirname, "rag-eval");
const FIXTURES_DIR = join(EVAL_DIR, "documents");
const RESULTS_PATH = join(import.meta.dirname, "../logs/rag-eval.json");
// How deep to look for the answering chunk, past what the model gets.
const SEARCH_DEPTH = 10;
// Questions sent to OpenAI at once, well under its rate limits.
const CONCURRENCY = 4;
const SENDER_NAMES = ["Anna Kowalska", "John Smith", "Piotr Nowak", "Emma Brown"];

const args = process.argv.slice(2);
const withFixtures = args.includes("--with-fixtures");
const only = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",").map(Number);

if (!isAiConfigured || !isRagConfigured) {
  console.error("Needs OPENAI_API_KEY, RAG_URL and RAG_SECRET in server/.env, and the rag service running.");
  process.exit(1);
}

const allCases: Case[] = await Bun.file(join(EVAL_DIR, "cases.json")).json();
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;

// The rank (1-based) of the first chunk from the expected document that contains the marker.
async function retrievalRank(c: Case): Promise<{ rank: number | null; topScore: number }> {
  const res = await fetch(`${RAG_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Rag-Secret": RAG_SECRET! },
    body: JSON.stringify({ query: `${c.subject}\n\n${c.body}`, k: SEARCH_DEPTH }),
  });
  if (!res.ok) throw new Error(`search answered ${res.status}: ${await res.text()}`);
  const { chunks } = (await res.json()) as { chunks: { text: string; filename: string; score: number }[] };
  const index = chunks.findIndex((chunk) => chunk.filename === c.document && c.marker && chunk.text.includes(c.marker));
  return { rank: index === -1 ? null : index + 1, topScore: chunks[0]?.score ?? 0 };
}

const POLISH_WORDS = new Set(["się", "jest", "nie", "możesz", "można", "jeśli", "oraz", "dla", "przy", "tak", "pozdrawiam", "dzień", "kurs", "kursu", "w", "z", "na", "do", "i"]);
const ENGLISH_WORDS = new Set(["the", "you", "your", "is", "are", "can", "to", "and", "for", "of", "with", "it", "regards", "yes", "no", "hi", "hello"]);

// A rough guess from common words: course names and "zł" are in both languages' replies.
function replyLanguage(text: string): "pl" | "en" {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const polish = words.filter((word) => POLISH_WORDS.has(word)).length;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  return polish > english ? "pl" : "en";
}

async function answer(c: Case, index: number) {
  const ticket = { subject: c.subject, body: c.body, senderName: SENDER_NAMES[index % SENDER_NAMES.length]! };
  const knowledge = await searchKnowledge(`${c.subject}\n\n${c.body}`);
  if (!knowledge) return { resolved: false, reply: "", note: "no excerpt above the floor" };
  return autoResolveTicket(ticket, knowledge);
}

async function evaluate(c: Case, index: number) {
  const [{ rank, topScore }, result] = await Promise.all([retrievalRank(c), answer(c, index)]);
  const decision = result.resolved ? "resolve" : "escalate";
  const decisionOk = c.expect === "either" || c.expect === decision;
  const missingFacts = result.resolved ? c.facts.filter((fact) => !regex(fact).test(result.reply)) : [];
  const language = result.resolved ? replyLanguage(result.reply) : null;
  const languageOk = language === null || language === c.language;
  return { ...c, rank, topScore, decision, decisionOk, missingFacts, language, languageOk, reply: result.reply };
}

// JSON can't hold JavaScript's /…/i, so a leading (?i) stands for the flag.
function regex(pattern: string) {
  return pattern.startsWith("(?i)") ? new RegExp(pattern.slice(4), "i") : new RegExp(pattern);
}

// Adds the fixtures the questions need that aren't stored yet; returns the ids to delete afterwards.
async function addMissingFixtures(): Promise<string[]> {
  const stored = new Set((await listRagDocuments()).map((document) => document.filename));
  const added: string[] = [];
  for (const filename of await readdir(FIXTURES_DIR)) {
    if (stored.has(filename)) continue;
    const data = new Uint8Array(await Bun.file(join(FIXTURES_DIR, filename)).arrayBuffer());
    added.push((await addRagDocument({ filename, contentType: "text/plain", data })).id);
    console.log(`Added ${filename} for this run.`);
  }
  return added;
}

const addedFixtures = withFixtures ? await addMissingFixtures() : [];
try {
  const stored = new Set((await listRagDocuments()).map((document) => document.filename));
  const missing = [...new Set(cases.map((c) => c.document).filter((d): d is string => d !== null && !stored.has(d)))];
  if (missing.length > 0) {
    console.error(`Missing from the knowledge base: ${missing.join(", ")}.`);
    console.error("Run with --with-fixtures for the test documents, and bun run seed:rag for the support FAQ.");
    process.exitCode = 1;
  } else {
    const results = [];
    for (let i = 0; i < cases.length; i += CONCURRENCY) {
      results.push(...(await Promise.all(cases.slice(i, i + CONCURRENCY).map((c, j) => evaluate(c, i + j)))));
    }
    report(results);
    await Bun.write(RESULTS_PATH, JSON.stringify(results, null, 1));
    console.log(`\nEvery question, answer and score: ${RESULTS_PATH}`);
  }
} finally {
  for (const id of addedFixtures) await deleteRagDocument(id);
  if (addedFixtures.length > 0) console.log(`Deleted the ${addedFixtures.length} documents added for this run.`);
}

function report(results: Awaited<ReturnType<typeof evaluate>>[]) {
  for (const r of results) {
    const ok = r.decisionOk && r.missingFacts.length === 0 && r.languageOk;
    const problems = [
      !r.decisionOk && `expected ${r.expect}, got ${r.decision}`,
      r.missingFacts.length > 0 && `missing ${r.missingFacts.join(" | ")}`,
      !r.languageOk && `replied in ${r.language}, asked in ${r.language === "pl" ? "en" : "pl"}`,
    ].filter(Boolean);
    const rank = r.document ? `rank ${r.rank ?? `>${SEARCH_DEPTH}`}` : "no answer in the documents";
    console.log(`${ok ? "OK " : "BAD"} #${String(r.id).padStart(2)} ${r.decision.padEnd(8)} ${rank.padEnd(26)} ${r.subject}`);
    if (!ok) {
      console.log(`      ${problems.join("; ")}`);
      if (r.reply) console.log(`      reply: ${r.reply.replaceAll("\n", " ")}`);
    }
  }

  const answerable = results.filter((r) => r.document);
  const resolved = results.filter((r) => r.decision === "resolve");
  const withFacts = resolved.filter((r) => r.facts.length > 0);
  const count = (list: unknown[], total: unknown[]) => `${list.length}/${total.length}`;
  console.log(`
Decisions as expected:           ${count(results.filter((r) => r.decisionOk), results)}
Resolved replies with the facts: ${count(withFacts.filter((r) => r.missingFacts.length === 0), withFacts)}
Resolved replies in the ticket's language: ${count(resolved.filter((r) => r.languageOk), resolved)}
Answer ranked 1st:               ${count(answerable.filter((r) => r.rank === 1), answerable)}
Answer within the ${KNOWLEDGE_EXCERPTS} excerpts sent: ${count(answerable.filter((r) => r.rank !== null && r.rank <= KNOWLEDGE_EXCERPTS), answerable)}`);
}
