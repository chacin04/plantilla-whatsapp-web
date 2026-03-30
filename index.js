const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const connectionDb = require('./src/memory_chat/connection.js');
const wait = require('./src/tools/wait.js');

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const initCronJobs = require('./src/cron/check_pending.js');


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
            const checkChat = await connection.all(`
                SELECT id
                FROM chat_pending 
                WHERE id_chat = ?
                    AND status_closed = 0
                    AND status_reviewing = 0
            `, [msg.from]);
            if (checkChat.length == 0) {
                await connection.exec(`
                    INSERT INTO chat_pending (id_chat, created_at, updated_at) 
                    VALUES (?, ?, ?)`,
                    [
                        msg.from,
                        dayjs().tz("America/Caracas").format('YYYY-MM-DD HH:mm:ss'),
                        dayjs().tz("America/Caracas").format('YYYY-MM-DD HH:mm:ss')
                    ]
                );
                await wait(1500);
                await chat.clearState();
                await chat.sendSeen()
                await chat.sendStateTyping();
                await wait(5000);
                await msg.reply(`Hola ${nombre_contact}, en breves momentos te atenderemos`);
                await chat.clearState();
            } else {
                await connection.exec(`
                    UPDATE chat_pending 
                    SET updated_at = ?
                    WHERE id_chat = ?
                    AND status_closed = 0
                    AND status_reviewing = 0`,
                    [dayjs().tz("America/Caracas").format('YYYY-MM-DD HH:mm:ss'), msg.from]
                );
            }
            await connection.close();
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

    // const mensajes = await chat.fetchMessages({ limit: 15 });
    // console.log(mensajes)


});

client.initialize();
