import assert from "node:assert/strict";
import test from "node:test";
import {
  RuleBasedTranscriptChunkClassifier,
  RuleBasedTranscriptChunker,
  TranscriptChunkingPipeline
} from "./transcript-chunking.js";

test("chunker splits transcript into ordered semantic chunks", () => {
  const chunker = new RuleBasedTranscriptChunker({ maxChunkChars: 140, minChunkChars: 40 });
  const transcript = `
Manager: I'm currently working on the customer billing migration and documenting edge cases.

IC: Progress update, I finished the invoice serializer and shipped the retry flow to staging.

IC: I'm blocked waiting on security review for production credentials, so release is paused.
  `.trim();

  const chunks = chunker.chunk(transcript);

  assert.equal(chunks.length, 3);
  assert.match(chunks[0]?.text ?? "", /currently working on/i);
  assert.match(chunks[1]?.text ?? "", /progress update/i);
  assert.match(chunks[2]?.text ?? "", /blocked waiting on/i);
});

test("classifier maps chunks into required categories", () => {
  const classifier = new RuleBasedTranscriptChunkClassifier();

  assert.equal(classifier.classify("I am currently building the new API gateway."), "active_work");
  assert.equal(classifier.classify("Progress update: we completed migration and shipped fixes."), "progress_update");
  assert.equal(classifier.classify("I am blocked and stuck until access is restored."), "blocker");
  assert.equal(classifier.classify("This depends on platform team handoff next week."), "dependency");
  assert.equal(classifier.classify("I need help because I'm unfamiliar with this stack."), "skill_gap");
  assert.equal(classifier.classify("I am unsure and the next step is not clear yet."), "uncertainty");
});

test("pipeline assigns stable chunk ids and preserves chunk order", () => {
  const pipeline = new TranscriptChunkingPipeline(
    new RuleBasedTranscriptChunker({ maxChunkChars: 120, minChunkChars: 30 }),
    new RuleBasedTranscriptChunkClassifier()
  );

  const chunks = pipeline.createClassifiedChunks({
    meetingId: "meeting-123",
    transcriptText: `
I am currently implementing the onboarding automation.

Progress update: finished endpoint tests and shipped the hotfix.
    `.trim()
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.chunkId, "meeting-123_chunk_0001");
  assert.equal(chunks[1]?.chunkId, "meeting-123_chunk_0002");
  assert.equal(chunks[0]?.chunkOrder, 0);
  assert.equal(chunks[1]?.chunkOrder, 1);
});
