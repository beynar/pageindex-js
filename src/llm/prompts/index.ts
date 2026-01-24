// TOC detection and extraction
export {
  TocDetectionSchema,
  TocExtractionSchema,
  TocTransformSchema,
  tocDetectionPrompt,
  tocExtractionPrompt,
  pageOffsetPrompt,
  type TocDetectionResult,
  type TocExtractionResult,
  type TocTransformResult,
} from './toc.js'

// Section extraction
export {
  SectionExtractionSchema,
  PageMatchSchema,
  TitleVerificationSchema,
  ContinuationSchema,
  sectionExtractionPrompt,
  pageMatchPrompt,
  titleVerificationPrompt,
  type SectionExtractionResult,
  type PageMatchResult,
  type TitleVerificationResult,
  type ContinuationResult,
} from './extraction.js'

// Summary generation
export {
  NodeSummarySchema,
  DocDescriptionSchema,
  BatchSummarySchema,
  nodeSummaryPrompt,
  docDescriptionPrompt,
  batchSummaryPrompt,
  type NodeSummaryResult,
  type DocDescriptionResult,
  type BatchSummaryResult,
} from './summary.js'

// Search and reasoning
export {
  TreeSearchSchema,
  RelevanceScoreSchema,
  MultiHopReasoningSchema,
  treeSearchPrompt,
  relevanceScorePrompt,
  multiHopReasoningPrompt,
  formatTreeForPrompt,
  type TreeSearchResult,
  type RelevanceScoreResult,
  type MultiHopReasoningResult,
  type TreeSearchPromptOptions,
} from './search.js'
