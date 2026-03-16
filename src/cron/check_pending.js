const { Cron } = require('croner');
const connectionDb = require('../memory_chat/connection.js');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

function initCronJobs(client) {
    const job = new Cron('*/20 * * * * *', async () => {
        try {
            const connection = await connectionDb();

            // esto es para que no se procesen los chats que se acaban de crear
            // y se procesen los que tienen mas de 3 minutos sin actualizar
            const actual_time_db = dayjs().tz("America/Caracas").subtract(2, 'minute').format('YYYY-MM-DD HH:mm:ss');

            const pendingChats = await connection.all(`
                SELECT id_chat
                FROM chat_pending 
                WHERE status_closed = 0
                  AND status_reviewing = 0
                  AND updated_at < ?
            `, [actual_time_db]);
            await connection.close();


            if (pendingChats.length > 0) {
                console.log(`[CRON] Se encontraron ${pendingChats.length} chats pendientes.`);

                for (const chat of pendingChats) {
                    const chat_id = chat.id_chat
                    console.log(`[CRON] Procesando chat pendiente: ${chat_id}`);
                    const chat_instance = await client.getChatById(chat_id)

                    const info_chat = await chat_instance.getContact()
                    const nombre_contact = info_chat.name || info_chat.pushname || info_chat.number;

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
