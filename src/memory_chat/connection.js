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

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_pending_id_chat 
        ON chat_pending(id_chat)
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_pending_status 
        ON chat_pending(status_reviewing, status_closed)
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_pending_updated_at 
        ON chat_pending(updated_at)
    `);

    return {
        get: async (sql, params = []) => db.prepare(sql).get(...params),
        all: async (sql, params = []) => db.prepare(sql).all(...params),
        run: async (sql, params = []) => db.prepare(sql).run(...params),
        exec: async (sql, params = []) => {
            if (params.length > 0) return db.prepare(sql).run(...params);
            return db.exec(sql);
        },
        close: async () => db.close(),

        claimChatForReview: async (idChat, timestamp) => {
            const result = await db.prepare(`
                UPDATE chat_pending 
                SET status_reviewing = 1, updated_at = ?
                WHERE id_chat = ? 
                AND status_reviewing = 0 
                AND status_closed = 0
                RETURNING id
            `).get(timestamp, idChat);
            return result !== undefined;
        },

        markChatAsClosed: async (idChat, timestamp) => {
            await db.prepare(`
                UPDATE chat_pending 
                SET status_closed = 1, updated_at = ?
                WHERE id_chat = ? 
                AND status_reviewing = 1
            `).run(timestamp, idChat);
        },

        resetChatStatus: async (idChat, timestamp) => {
            await db.prepare(`
                UPDATE chat_pending 
                SET status_reviewing = 0, status_closed = 0, updated_at = ?
                WHERE id_chat = ?
            `).run(timestamp, idChat);
        },

        getChatStatus: async (idChat) => {
            return await db.prepare(`
                SELECT status_reviewing, status_closed, updated_at
                FROM chat_pending
                WHERE id_chat = ?
            `).get(idChat);
        },

        isChatInactive: async (idChat, inactivityHours) => {
            const result = await db.prepare(`
                SELECT updated_at
                FROM chat_pending
                WHERE id_chat = ?
            `).get(idChat);
            
            if (!result || !result.updated_at) return true;
            
            const updatedAt = new Date(result.updated_at);
            const now = new Date();
            const hoursDiff = (now - updatedAt) / (1000 * 60 * 60);
            return hoursDiff >= inactivityHours;
        },
    };
}

module.exports = connectionDb;