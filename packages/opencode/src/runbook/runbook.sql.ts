import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable, MessageTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const RunbookRunTable = sqliteTable(
  "runbook_run",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text().references(() => MessageTable.id, { onDelete: "set null" }),
    path: text().notNull(),
    status: text().notNull(),
    step_idx: integer().notNull().$default(() => 0),
    bindings: text({ mode: "json" }).$type<Record<string, string[]>>(),
    facts: text({ mode: "json" }).$type<Record<string, string>>(),
    approval: text({ mode: "json" }).$type<{
      confirmed?: boolean
      roles?: Record<string, string[]>
    }>(),
    source_bundle: text({
      mode: "json",
    }).$type<
      Array<{
        kind: string
        role: string
        label?: string
        url?: string
        path?: string
        fetched_at?: number
      }>
    >(),
    pause_reason: text(),
    error: text(),
    time_started: integer(),
    time_ended: integer(),
    ...Timestamps,
  },
  (table) => [
    index("runbook_run_session_idx").on(table.session_id),
    index("runbook_run_message_idx").on(table.message_id),
    index("runbook_run_status_idx").on(table.status),
  ],
)

export const RunbookStepTable = sqliteTable(
  "runbook_step",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => RunbookRunTable.id, { onDelete: "cascade" }),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    step_id: text().notNull(),
    step_idx: integer().notNull(),
    kind: text().notNull(),
    title: text().notNull(),
    attempt: integer().notNull().$default(() => 0),
    status: text().notNull(),
    summary: text(),
    output_preview: text(),
    vm_activity_ids: text({ mode: "json" }).$type<Record<string, string>>(),
    artifacts: text({ mode: "json" }).$type<Array<{ name: string; mime: string; url: string }>>(),
    error: text(),
    time_started: integer(),
    time_ended: integer(),
    ...Timestamps,
  },
  (table) => [
    index("runbook_step_run_idx").on(table.run_id),
    index("runbook_step_session_idx").on(table.session_id),
    index("runbook_step_order_idx").on(table.run_id, table.step_idx),
    index("runbook_step_status_idx").on(table.status),
  ],
)
