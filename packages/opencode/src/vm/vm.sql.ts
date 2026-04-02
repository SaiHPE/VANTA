import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { MessageTable } from "@/session/session.sql"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const VmTable = sqliteTable(
  "vm",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    hostname: text(),
    ip: text(),
    port: integer().notNull().$default(() => 22),
    username: text().notNull(),
    auth_type: text().notNull(),
    password: text(),
    private_key: text(),
    passphrase: text(),
    notes: text(),
    workspace_root: text(),
    repo_url: text(),
    os_name: text(),
    os_version: text(),
    kernel: text(),
    arch: text(),
    shell: text(),
    home_dir: text(),
    last_status: text().notNull().$default(() => "unknown"),
    last_seen_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("vm_project_idx").on(table.project_id),
    index("vm_name_idx").on(table.name),
    index("vm_hostname_idx").on(table.hostname),
    index("vm_ip_idx").on(table.ip),
  ],
)

export const VmActivityTable = sqliteTable(
  "vm_activity",
  {
    id: text().primaryKey(),
    vm_id: text()
      .notNull()
      .references(() => VmTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    message_id: text().references(() => MessageTable.id, { onDelete: "set null" }),
    part_id: text(),
    tool: text().notNull(),
    title: text().notNull(),
    status: text().notNull(),
    summary: text(),
    exit_code: integer(),
    transcript: text(),
    transcript_path: text(),
    artifacts: text({ mode: "json" }).$type<Array<{ name: string; mime: string; url: string }>>(),
    started_at: integer().notNull(),
    ended_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("vm_activity_vm_idx").on(table.vm_id),
    index("vm_activity_session_idx").on(table.session_id),
    index("vm_activity_message_idx").on(table.message_id),
    index("vm_activity_started_idx").on(table.started_at),
  ],
)
