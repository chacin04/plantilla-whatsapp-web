const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const connectionDb = require('./src/memory_chat/connection.js');
const wait = require('./src/tools/wait.js');
const config = require('./src/config/env');
const constants = require('./src/config/constants');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const initCronJobs = require('./src/cron/check_pending.js');
const { initializeContextDB } = require('./src/services/context-db.js');


const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // headless: false,
        executablePath: '/snap/bin/brave',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
        ],
    }
});


client.on('ready', () => {
    console.log('Client is ready!');
    initCronJobs(client);
});


client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});


client.on('message', async (msg) => {
    if ((msg.from).includes("@broadcast")) {
        return
    }
    if (msg.fromMe) {
        console.log("soy yo enviando a ", msg.to)
        return
    }
    if (msg.body == "/id") {
        msg.reply(msg.from)
        return
    }

    const info_contact = await msg.getContact();
    const nombre_contact = info_contact.name || info_contact.pushname || info_contact.number;

    const chat = await client.getChatById(msg.from);

    let check_while = true;
    while (check_while) {
        try {
            const connection = await connectionDb();
            const currentTime = dayjs().tz("America/Caracas").format('YYYY-MM-DD HH:mm:ss');
            
            const chatStatus = await connection.getChatStatus(msg.from);
            let shouldSendGreeting = false;
            
            if (!chatStatus) {
                await connection.exec(`
                    INSERT INTO chat_pending (id_chat, created_at, updated_at) 
                    VALUES (?, ?, ?)`,
                    [msg.from, currentTime, currentTime]
                );
                shouldSendGreeting = true;
                console.log(`[DB] Nuevo chat creado para ${msg.from}`);
            } else {
                if (chatStatus.status_closed === 1) {
                    await connection.resetChatStatus(msg.from, currentTime);
                    console.log(`[DB] Chat ${msg.from} reset de estado cerrado`);
                }
                
                let isInactive = true;
                if (chatStatus.updated_at) {
                    const updatedAt = dayjs.tz(chatStatus.updated_at, "America/Caracas");
                    const hoursDiff = dayjs().tz("America/Caracas").diff(updatedAt, 'hour');
                    isInactive = hoursDiff >= config.chat.inactivityHoursForGreeting;
                }
                
                if (isInactive) {
                    shouldSendGreeting = true;
                    console.log(`[DB] Chat ${msg.from} inactivo por más de ${config.chat.inactivityHoursForGreeting} horas, enviando saludo`);
                }
                
                await connection.exec(`
                    UPDATE chat_pending 
                    SET updated_at = ?
                    WHERE id_chat = ?`,
                    [currentTime, msg.from]
                );
            }
            
            await connection.close();
            
            if (shouldSendGreeting) {
                await wait(1500);
                await chat.clearState();
                await chat.sendSeen();
                await chat.sendStateTyping();
                await wait(5000);
                await msg.reply(`Hola ${nombre_contact}, en breves momentos te atenderemos`);
                await chat.clearState();
            }
            
            check_while = false;
        } catch (error) {
            await wait(1500);
            console.error('[DB] Error al verificar el chat:', error);
            check_while = true;
        }
    }


    await wait(3500);
    await chat.clearState();
    await chat.sendSeen()
    await chat.sendStateTyping();

});

async function init() {
    try {
        console.log('[Inicialización] Iniciando ChromaDB...');
        await initializeContextDB();
        console.log('[Inicialización] ChromaDB inicializado exitosamente');
    } catch (error) {
        console.warn('[Inicialización] ChromaDB falló, continuando sin contexto:', error.message);
    }
    
    console.log('[Inicialización] Iniciando cliente de WhatsApp...');
    client.initialize();
}

init();
