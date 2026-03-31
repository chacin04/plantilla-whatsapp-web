require('dotenv').config();

const REQUIRED_ENV_VARS = [
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_BASE_URL',
    'LLM_MODEL',
];

function validateEnvironment() {
    const missing = [];

    for (const envVar of REQUIRED_ENV_VARS) {
        if (!process.env[envVar]) {
            missing.push(envVar);
        }
    }

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}\n` +
            'Please check your .env file and ensure all required variables are set.'
        );
    }
}

function parseInteger(value, defaultValue) {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

function parseFloatValue(value, defaultValue) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}

function getConfig() {
    validateEnvironment();

    const baseUrl = process.env.DEEPSEEK_BASE_URL.replace(/\/$/, '');
    
    return {
        deepseek: {
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseUrl,
        },
        llm: {
            model: process.env.LLM_MODEL,
            systemPrompt: `
                Eres un asistente útil que responde preguntas de manera clara y concisa.
                tu forma de escribir sera para un usuario por whatsapp ,
                osea utiliza negritas y emojis como si fuera whatsapp,
                eres un asistente que  ayuda a buscar productos de mecanica o parte de carros por distintos medios
                como tiendas de mecanica que no tienes permetido decir, 
                solo vendemos productos no decimos ni tenemos nadaque ver con las tiendas que conseguimos los productos , 
                estamos ubicados en  venezuela.
                No tienes permetido decir que no tienes el producto,
                tu nombre de asistente es astrid, 
                no utilices tablas que no seas bien vistas en whatsapp,

                IMPORTANTE FORMATEADO :
                    1. en ves de poner **texto** utiliza *texto* para negritas,
                    2. en ves de usar ### texto ### utiliza *texto* para negritas,
                `,
            maxTokens: parseInteger(process.env.LLM_MAX_TOKENS, 500),
            temperature: parseFloatValue(process.env.LLM_TEMPERATURE, 0.7),
            timeoutMs: parseInteger(process.env.LLM_TIMEOUT_MS, 30000),
            
            thinkingEnabled: process.env.LLM_THINKING_ENABLED === 'true',
            responseFormat: process.env.LLM_RESPONSE_FORMAT || 'text',
            frequencyPenalty: parseFloatValue(process.env.LLM_FREQUENCY_PENALTY, 0),
            presencePenalty: parseFloatValue(process.env.LLM_PRESENCE_PENALTY, 0),
            topP: parseFloatValue(process.env.LLM_TOP_P, 1),
        },
        chat: {
            inactivityHoursForGreeting: parseInteger(process.env.INACTIVITY_HOURS_FOR_GREETING, 8),
        },
    };
}

const config = getConfig();

module.exports = config;