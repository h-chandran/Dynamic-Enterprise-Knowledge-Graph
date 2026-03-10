CREATE INDEX person_email_idx IF NOT EXISTS
FOR (n:Person)
ON (n.email);

CREATE INDEX person_full_name_idx IF NOT EXISTS
FOR (n:Person)
ON (n.fullName);

CREATE INDEX team_name_idx IF NOT EXISTS
FOR (n:Team)
ON (n.name);

CREATE INDEX project_name_idx IF NOT EXISTS
FOR (n:Project)
ON (n.name);

CREATE INDEX project_status_idx IF NOT EXISTS
FOR (n:Project)
ON (n.status);

CREATE INDEX task_status_idx IF NOT EXISTS
FOR (n:Task)
ON (n.status);

CREATE INDEX task_due_date_idx IF NOT EXISTS
FOR (n:Task)
ON (n.dueDate);

CREATE INDEX blocker_status_idx IF NOT EXISTS
FOR (n:Blocker)
ON (n.status);

CREATE INDEX blocker_severity_idx IF NOT EXISTS
FOR (n:Blocker)
ON (n.severity);

CREATE INDEX skill_name_idx IF NOT EXISTS
FOR (n:Skill)
ON (n.name);

CREATE INDEX meeting_started_at_idx IF NOT EXISTS
FOR (n:Meeting)
ON (n.startedAt);

CREATE INDEX transcript_chunk_transcript_id_idx IF NOT EXISTS
FOR (n:TranscriptChunk)
ON (n.transcriptId);

CREATE INDEX transcript_chunk_index_idx IF NOT EXISTS
FOR (n:TranscriptChunk)
ON (n.chunkIndex);

CREATE INDEX update_event_type_idx IF NOT EXISTS
FOR (n:UpdateEvent)
ON (n.eventType);

CREATE INDEX update_event_occurred_at_idx IF NOT EXISTS
FOR (n:UpdateEvent)
ON (n.occurredAt);
