const { Cron } = require('croner');
const connectionDb = require('../memory_chat/connection.js');

function initCronJobs(client) {
    const job = new Cron('*/20 * * * * *', async () => {
        try {
            const connection = await connectionDb();

            const pendingChats = await connection.all(`
                SELECT id_chat
                FROM chat_pending 
                WHERE status_closed = 0
                  AND status_reviewing = 0
            `);
            await connection.close();


            if (pendingChats.length > 0) {
                console.log(`[CRON] Se encontraron ${pendingChats.length} chats pendientes.`);

                for (const chat of pendingChats) {
                    const chat_id = chat.id_chat
                    console.log(`[CRON] Procesando chat pendiente: ${chat_id}`);
                    const chat_instance = await client.getChatById(chat_id)
                    const nombre_chat = chat_instance.name

                    const mensajes = await chat_instance.fetchMessages({ limit: 15 });
                    const contruccion = mensajes.map((msg_history) => {
                        return {
                            isMe: msg_history.fromMe,
                            body: msg_history.body,
                        }
                    })
                    console.log(contruccion)

                    // RECUERDA CUANDO TERMINE DE RESPONDER EL CHAT USAR 
                    // await chat_instance.clearState();
                }
            }
        } catch (error) {
            console.error('[CRON] Error al verificar los chats pendientes:', error);
        }
    }, {
        protect: true,
        timezone: 'America/Caracas'
    });

    console.log('[CRON] Tarea programada iniciada (chequeo de chat_pending).');
    job.start();
    // return job;
    return true;
}

module.exports = initCronJobs;
