# Transcript Extraction Job Module

Chunk-level extraction pipeline that:
- runs separate entity, relationship, and event passes
- validates outputs with shared extraction schemas
- retries failed passes with correction instructions
- attaches confidence and evidence spans
- stores raw and normalized extraction outputs for human review
- stores per-chunk extraction job status for admin/debug inspection
- avoids writing to the current-state graph
