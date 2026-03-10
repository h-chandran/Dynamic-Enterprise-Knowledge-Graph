export type TranscriptChunkCategory =
  | "active_work"
  | "progress_update"
  | "blocker"
  | "dependency"
  | "skill_gap"
  | "uncertainty";

export interface TranscriptChunk {
  text: string;
}

export interface ClassifiedTranscriptChunk {
  chunkId: string;
  chunkOrder: number;
  text: string;
  category: TranscriptChunkCategory;
}

/* eslint-disable no-unused-vars */
export interface TranscriptChunker {
  chunk: (...args: [string]) => TranscriptChunk[];
}

export interface TranscriptChunkClassifier {
  classify: (...args: [string]) => TranscriptChunkCategory;
}
/* eslint-enable no-unused-vars */

const splitIntoSentences = (text: string): string[] => {
  return text
    .split(/(?<=[.!?])\s+/g)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
};

const normalizeTranscript = (input: string): string => {
  return input.replace(/\r\n/g, "\n").trim();
};

export class RuleBasedTranscriptChunker implements TranscriptChunker {
  private readonly options: {
    maxChunkChars?: number;
    minChunkChars?: number;
  };

  constructor(options: { maxChunkChars?: number; minChunkChars?: number } = {}) {
    this.options = options;
  }

  chunk(transcriptText: string): TranscriptChunk[] {
    const normalized = normalizeTranscript(transcriptText);
    if (!normalized) {
      return [];
    }

    const maxChunkChars = this.options.maxChunkChars ?? 700;
    const minChunkChars = this.options.minChunkChars ?? 140;
    const units = normalized
      .split(/\n{2,}/g)
      .map((unit) => unit.trim())
      .filter((unit) => unit.length > 0);

    const chunks: TranscriptChunk[] = [];
    let current = "";

    const flushCurrent = () => {
      if (!current.trim()) {
        return;
      }

      chunks.push({ text: current.trim() });
      current = "";
    };

    for (const unit of units) {
      const sentences = unit.length > maxChunkChars ? splitIntoSentences(unit) : [unit];

      for (const sentence of sentences) {
        const next = current ? `${current} ${sentence}` : sentence;
        if (next.length <= maxChunkChars) {
          current = next;
          continue;
        }

        flushCurrent();
        current = sentence;
      }

      if (current.length >= minChunkChars) {
        flushCurrent();
      }
    }

    flushCurrent();

    return chunks;
  }
}

const CATEGORY_KEYWORDS: Record<TranscriptChunkCategory, RegExp[]> = {
  blocker: [
    /\bblocker(s)?\b/i,
    /\bstuck\b/i,
    /\bblocked\b/i,
    /\bcan't\b/i,
    /\bcannot\b/i,
    /\bwaiting on\b/i
  ],
  dependency: [/\bdepend(ency|encies|s)?\b/i, /\bawaiting\b/i, /\bneeds?\b.+\bfrom\b/i, /\bhandoff\b/i],
  skill_gap: [/\bneed help\b/i, /\bunfamiliar\b/i, /\blearning\b/i, /\blacking\b/i, /\bnot comfortable\b/i],
  uncertainty: [/\bunsure\b/i, /\buncertain\b/i, /\bmaybe\b/i, /\bmight\b/i, /\bnot clear\b/i],
  progress_update: [/\bcompleted\b/i, /\bfinished\b/i, /\bshipped\b/i, /\bdone\b/i, /\bprogress\b/i, /\bupdate\b/i],
  active_work: [/\bworking on\b/i, /\bcurrently\b/i, /\bbuilding\b/i, /\bimplementing\b/i, /\binvestigating\b/i]
};

const CATEGORY_PRECEDENCE: TranscriptChunkCategory[] = [
  "blocker",
  "dependency",
  "skill_gap",
  "uncertainty",
  "progress_update",
  "active_work"
];

export class RuleBasedTranscriptChunkClassifier implements TranscriptChunkClassifier {
  classify(chunkText: string): TranscriptChunkCategory {
    let topCategory: TranscriptChunkCategory = "active_work";
    let topScore = 0;

    for (const category of CATEGORY_PRECEDENCE) {
      const patterns = CATEGORY_KEYWORDS[category];
      const score = patterns.reduce((acc, pattern) => (pattern.test(chunkText) ? acc + 1 : acc), 0);

      if (score > topScore) {
        topScore = score;
        topCategory = category;
      }
    }

    return topCategory;
  }
}

export class TranscriptChunkingPipeline {
  private readonly chunker: TranscriptChunker;
  private readonly classifier: TranscriptChunkClassifier;

  constructor(chunker: TranscriptChunker, classifier: TranscriptChunkClassifier) {
    this.chunker = chunker;
    this.classifier = classifier;
  }

  createClassifiedChunks(input: { meetingId: string; transcriptText: string }): ClassifiedTranscriptChunk[] {
    const chunks = this.chunker.chunk(input.transcriptText);

    return chunks.map((chunk, index) => ({
      chunkId: `${input.meetingId}_chunk_${String(index + 1).padStart(4, "0")}`,
      chunkOrder: index,
      text: chunk.text,
      category: this.classifier.classify(chunk.text)
    }));
  }
}

export const defaultTranscriptChunkingPipeline = new TranscriptChunkingPipeline(
  new RuleBasedTranscriptChunker(),
  new RuleBasedTranscriptChunkClassifier()
);
