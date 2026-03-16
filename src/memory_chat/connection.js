const { DatabaseSync } = require('node:sqlite');
const path = require("path");

const dbPath = path.join(__dirname, "memory_chat.db");

async function connectionDb() {
    const db = new DatabaseSync(dbPath);

    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_pending (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_chat TEXT,
            created_at TIMESTAMP,
            updated_at TIMESTAMP,
            status_reviewing BOOLEAN DEFAULT 0,
            status_closed BOOLEAN DEFAULT 0
        )
    `);

    return {
        get: async (sql, params = []) => db.prepare(sql).get(...params),
        all: async (sql, params = []) => db.prepare(sql).all(...params),
        run: async (sql, params = []) => db.prepare(sql).run(...params),
        exec: async (sql, params = []) => {
            if (params.length > 0) return db.prepare(sql).run(...params);
            return db.exec(sql);
        },
        close: async () => db.close()
    };
}

module.exports = connectionDb;