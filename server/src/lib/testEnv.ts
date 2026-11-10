// What the unit tests put in place of ./env. mock.module is global across test files, so every
// test that mocks ./env passes all of it, whichever settings its own module reads.
export const testEnv = {
  OPENAI_API_KEY: "test-key",
  MAILER_URL: "http://mailer.test",
  MAILER_SECRET: "mailer-secret",
  RAG_URL: "http://rag.test",
  RAG_SECRET: "rag-secret",
};
