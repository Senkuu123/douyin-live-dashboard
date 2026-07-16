import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import type { AppConfig } from "../config/app-config.js";
import { assertProjectDatabase, PROJECT_DATABASE } from "../config/app-config.js";

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT UNSIGNED PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS live_rooms (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    platform_room_id VARCHAR(64) NOT NULL,
    room_url VARCHAR(2048) NULL,
    anchor_id_hash CHAR(64) NULL,
    anchor_nickname VARCHAR(255) NULL,
    title VARCHAR(512) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'unknown',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_live_rooms_platform_room_id (platform_room_id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS monitoring_sessions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    room_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(32) NOT NULL,
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    stop_reason VARCHAR(64) NULL,
    collector_version VARCHAR(64) NOT NULL,
    event_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    integrity_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
    last_error TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_sessions_room_started (room_id, started_at),
    CONSTRAINT fk_sessions_room FOREIGN KEY (room_id) REFERENCES live_rooms(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS interaction_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_id CHAR(36) NOT NULL,
    platform_message_id VARCHAR(128) NOT NULL,
    session_id CHAR(36) NOT NULL,
    room_id BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    event_time DATETIME(3) NOT NULL,
    received_at DATETIME(3) NOT NULL,
    user_id_hash CHAR(64) NULL,
    nickname VARCHAR(255) NULL,
    content TEXT NULL,
    raw_method VARCHAR(128) NOT NULL,
    collector_version VARCHAR(64) NOT NULL,
    payload_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_events_session_message (session_id, platform_message_id),
    KEY idx_events_session_received (session_id, received_at),
    KEY idx_events_room_received (room_id, received_at),
    CONSTRAINT fk_events_session FOREIGN KEY (session_id) REFERENCES monitoring_sessions(id),
    CONSTRAINT fk_events_room FOREIGN KEY (room_id) REFERENCES live_rooms(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS connection_intervals (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    status VARCHAR(32) NOT NULL,
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    close_code INT NULL,
    reason VARCHAR(512) NULL,
    reconnect_attempt INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_connections_session_started (session_id, started_at),
    CONSTRAINT fk_connections_session FOREIGN KEY (session_id) REFERENCES monitoring_sessions(id)
  ) ENGINE=InnoDB`
];

async function withConnection<T>(pool: Pool, action: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    return await action(connection);
  } finally {
    connection.release();
  }
}

export async function createProjectDatabase(config: AppConfig["database"]): Promise<void> {
  assertProjectDatabase(config.database);
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    timezone: "Z"
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${PROJECT_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
  } finally {
    await connection.end();
  }
}

export function createPool(config: AppConfig["database"]): Pool {
  assertProjectDatabase(config.database);
  return mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    timezone: "Z",
    connectionLimit: 5,
    charset: "utf8mb4"
  });
}

export async function migrate(pool: Pool): Promise<void> {
  await withConnection(pool, async (connection) => {
    await connection.query("SET time_zone = '+00:00'");
    for (const statement of migrationStatements) {
      await connection.query(statement);
    }
    const [columns] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'interaction_events' AND COLUMN_NAME = 'metrics_json'`,
      [PROJECT_DATABASE]
    );
    if (columns.length === 0) {
      await connection.query("ALTER TABLE interaction_events ADD COLUMN metrics_json JSON NULL AFTER content");
    }
    await connection.execute(
      "INSERT IGNORE INTO schema_migrations (version) VALUES (?)",
      [1]
    );
    await connection.execute("INSERT IGNORE INTO schema_migrations (version) VALUES (?)", [2]);
  });
}
