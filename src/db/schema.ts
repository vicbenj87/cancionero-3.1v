import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Sesiones compartidas con navegación sincronizada (director / oyentes)
// ---------------------------------------------------------------------------
export const cancioneroSessions = pgTable(
  "cancionero_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    // Hash + sal del código secreto. Nunca se guarda en texto plano.
    codeHash: varchar("code_hash", { length: 200 }).notNull(),
    codeSalt: varchar("code_salt", { length: 64 }).notNull(),
    // Identifica al dispositivo/navegador que creó la sesión (cookie propia).
    ownerToken: varchar("owner_token", { length: 64 }).notNull(),
    // Navegación actual del director: el hash de la app (#/, #/c/12/3, #/letra/12...)
    currentHash: text("current_hash").notNull().default("#/"),
    closed: boolean("closed").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("cancionero_sessions_owner_idx").on(table.ownerToken),
    index("cancionero_sessions_name_idx").on(table.name),
  ],
);

// ---------------------------------------------------------------------------
// Lista de acceso rápido semanal (10 canciones destacadas para el culto)
// ---------------------------------------------------------------------------
export const weeklyQuickSongs = pgTable(
  "weekly_quick_songs",
  {
    id: serial("id").primaryKey(),
    // Clave ISO de semana, p.ej. "2026-W06". Cambia automáticamente cada semana.
    weekKey: varchar("week_key", { length: 16 }).notNull(),
    position: integer("position").notNull(),
    songId: integer("song_id").notNull(),
    songTitle: varchar("song_title", { length: 200 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("weekly_quick_songs_week_idx").on(table.weekKey)],
);
