# Transcript Extraction Job Module

Chunk-level extraction pipeline that:
- runs separate entity, relationship, and event passes
- validates outputs with shared extraction schemas
- attaches confidence and evidence spans
- stores raw and normalized extraction outputs for human review
- avoids writing to the current-state graph
