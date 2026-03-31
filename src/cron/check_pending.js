const { Cron } = require('croner');
const connectionDb = require('../memory_chat/connection.js');
const llmService = require('../services/llm-http');
const config = require('../config/env');
const constants = require('../config/constants');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

async function processPendingChat(chatId, client, connection) {
    const currentTime = dayjs().tz("America/Caracas").format('YYYY-MM-DD HH:mm:ss');
    
    try {
        console.log(`[CRON] Intentando claim del chat: ${chatId}`);
        
        const claimed = await connection.claimChatForReview(chatId, currentTime);
        if (!claimed) {
            console.log(`[CRON] Chat ${chatId} ya fue tomado por otro proceso, saltando.`);
            return;
        }
        
        console.log(`[CRON] Chat ${chatId} claim exitoso, procesando...`);
        
        const chatInstance = await client.getChatById(chatId);
        const contactInfo = await chatInstance.getContact();
        const contactName = contactInfo.name || contactInfo.pushname || contactInfo.number;
        
        const messages = await chatInstance.fetchMessages({ limit: 10 });
        const formattedMessages = messages.map(msg => ({
            isMe: msg.fromMe,
            body: msg.body,
        }));
        
        console.log(`[CRON] Generando respuesta LLM para ${contactName} (${chatId})`);
        
        const llmResponse = await llmService.generateResponse(
            formattedMessages,
            contactName,
            { timeoutMs: config.llm.timeoutMs }
        );
        
        console.log(`[CRON] Respuesta LLM generada, enviando por WhatsApp...`);
        
        await chatInstance.clearState();
        await chatInstance.sendSeen();
        await chatInstance.sendStateTyping();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await chatInstance.sendMessage(llmResponse);
        
        await chatInstance.clearState();
        
        await connection.markChatAsClosed(chatId, currentTime);
        
        console.log(`[CRON] Chat ${chatId} procesado y cerrado exitosamente.`);
        
    } catch (error) {
        console.error(`[CRON] Error procesando chat ${chatId}:`, error);
        
        try {
            const revertTime = dayjs().tz("America/Caracas").format('YYYY-MM-DD HH:mm:ss');
            await connection.exec(`
                UPDATE chat_pending 
                SET status_reviewing = 0, updated_at = ?
                WHERE id_chat = ?
            `, [revertTime, chatId]);
            console.log(`[CRON] Chat ${chatId} revertido a pendiente debido a error.`);
        } catch (revertError) {
            console.error(`[CRON] Error revirtiendo chat ${chatId}:`, revertError);
        }
        
        if (error.message.includes('timeout')) {
            console.log(`[CRON] Timeout del LLM para chat ${chatId}, se reintentará en próximo ciclo.`);
        }
    }
}

function initCronJobs(client) {
    const job = new Cron('*/20 * * * * *', async () => {
        try {
            const connection = await connectionDb();
            
            const inactiveTime = dayjs().tz("America/Caracas")
                .subtract(40, "second")
                .format('YYYY-MM-DD HH:mm:ss');
            
            const pendingChats = await connection.all(`
                SELECT id_chat
                FROM chat_pending 
                WHERE status_closed = 0
                  AND status_reviewing = 0
                  AND updated_at < ?
                ORDER BY updated_at ASC
                LIMIT 5
            `, [inactiveTime]);
            
            await connection.close();
            
            if (pendingChats.length > 0) {
                console.log(`[CRON] Encontrados ${pendingChats.length} chats pendientes.`);
                
                for (const chat of pendingChats) {
                    const chatConnection = await connectionDb();
                    await processPendingChat(chat.id_chat, client, chatConnection);
                    await chatConnection.close();
                }
            }
        } catch (error) {
            console.error('[CRON] Error en ciclo de verificación:', error);
        }
    }, {
        protect: true,
        timezone: 'America/Caracas'
    });
    
    console.log('[CRON] Tarea programada iniciada (chequeo de chat_pending con LLM).');
    job.start();
    
    return true;
}

module.exports = initCronJobs;
