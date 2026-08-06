-- Goal Mode is gone, replaced by the Chat/Agent tool permission split.
-- TaskItem first — it holds the FK to GoalRun.
DROP TABLE IF EXISTS "TaskItem";
DROP TABLE IF EXISTS "GoalRun";
