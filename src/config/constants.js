module.exports = {
    DATABASE: {
        TABLE: {
            CHAT_PENDING: 'chat_pending',
        },
        STATUS: {
            PENDING: 0,
            REVIEWING: 1,
            CLOSED: 1,
        },
        COLUMN: {
            ID: 'id',
            ID_CHAT: 'id_chat',
            CREATED_AT: 'created_at',
            UPDATED_AT: 'updated_at',
            STATUS_REVIEWING: 'status_reviewing',
            STATUS_CLOSED: 'status_closed',
        },
    },
    LLM: {
        ROLE: {
            SYSTEM: 'system',
            USER: 'user',
            ASSISTANT: 'assistant',
        },
        ERROR_MESSAGES: {
            API_FAILURE: 'Lo siento, estoy teniendo problemas técnicos en este momento. Por favor, intenta de nuevo más tarde.',
            TIMEOUT: 'La respuesta está tardando más de lo esperado. Por favor, intenta de nuevo.',
        },
        MAX_RETRIES: 3,
        RETRY_DELAY_MS: 1000,
    },
    WHATSAPP: {
        MESSAGE: {
            GREETING: (name) => `Hola ${name}, en breves momentos te atenderemos`,
            PROCESSING: 'Procesando tu mensaje...',
        },
    },
    TIME: {
        MILLISECONDS: {
            SECOND: 1000,
            MINUTE: 60 * 1000,
            HOUR: 60 * 60 * 1000,
        },
    },
};