const config = require('../config/env');
const constants = require('../config/constants');
const { getContextForMessage } = require('./context-db.js');

const DEEPSEEK_ERROR_CODES = {
    400: 'Invalid Format - Check request body format',
    401: 'Authentication Failed - Invalid API key',
    402: 'Insufficient Balance - Add funds to your account',
    422: 'Invalid Parameters - Check request parameters',
    429: 'Rate Limit Reached - Slow down your requests',
    500: 'Server Error - Internal server issue',
    503: 'Server Overloaded - High traffic, try again later',
};

function validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('Messages must be a non-empty array');
    }

    const validRoles = ['system', 'user', 'assistant', 'tool'];
    
    for (const message of messages) {
        if (!message.role || !validRoles.includes(message.role)) {
            throw new Error(`Invalid role: ${message.role}. Must be one of: ${validRoles.join(', ')}`);
        }
        if (!message.content && message.role !== 'tool') {
            throw new Error('Message content is required for non-tool roles');
        }
    }
}

async function formatWhatsAppMessagesToLLM(messages, contactName) {
    const formattedMessages = [
        {
            role: constants.LLM.ROLE.SYSTEM,
            content: config.llm.systemPrompt,
        },
    ];

    for (const msg of messages) {
        const role = msg.isMe ? constants.LLM.ROLE.ASSISTANT : constants.LLM.ROLE.USER;
        const content = msg.body.trim();

        if (content) {
            formattedMessages.push({ 
                role, 
                content,
                name: role === constants.LLM.ROLE.USER ? contactName : undefined,
            });
        }
    }

    const lastUserMessageIndex = findLastUserMessageIndex(formattedMessages);
    if (lastUserMessageIndex !== -1) {
        const lastUserMessage = formattedMessages[lastUserMessageIndex];
        const context = await getContextForMessage(lastUserMessage.content);
        
        if (context) {
            console.log(`[LLM] Contexto obtenido para mensaje: "${lastUserMessage.content.substring(0, 50)}..."`);
            console.log(`[LLM] Añadiendo contexto al system prompt (longitud contexto: ${context.length} chars)`);
            formattedMessages[0].content = formattedMessages[0].content + '\n\n' + context;
            console.log(`[LLM] System prompt actualizado (longitud total: ${formattedMessages[0].content.length} chars)`);
        }
    }

    return formattedMessages;
}

function findLastUserMessageIndex(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === constants.LLM.ROLE.USER) {
            return i;
        }
    }
    return -1;
}

function buildPayload(messages) {
    const payload = {
        model: config.llm.model,
        messages,
        max_tokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
        stream: false,
    };

    if (config.llm.frequencyPenalty !== 0) {
        payload.frequency_penalty = config.llm.frequencyPenalty;
    }

    if (config.llm.presencePenalty !== 0) {
        payload.presence_penalty = config.llm.presencePenalty;
    }

    if (config.llm.topP !== 1) {
        payload.top_p = config.llm.topP;
    }

    if (config.llm.responseFormat !== 'text') {
        payload.response_format = { type: config.llm.responseFormat };
    }

    if (config.llm.thinkingEnabled) {
        payload.thinking = { type: 'enabled' };
        
        if (config.llm.model === 'deepseek-chat') {
            console.warn('[LLM] Thinking mode enabled but model is deepseek-chat. Consider using deepseek-reasoner for thinking mode.');
        }
    }

    return payload;
}

async function callDeepSeekAPI(messages, options = {}) {
    const { timeoutMs = config.llm.timeoutMs } = options;
    
    validateMessages(messages);
    const payload = buildPayload(messages);
    
    const url = `${config.deepseek.baseUrl}/chat/completions`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        console.log(`[LLM] Calling DeepSeek API: ${url}`);
        console.log(`[LLM] Payload:`, JSON.stringify({
            ...payload,
            messages: payload.messages.map(m => ({ 
                role: m.role, 
                content: m.content?.substring(0, 100) + (m.content?.length > 100 ? '...' : '') 
            }))
        },null,2));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.deepseek.apiKey}`,
                'Accept': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorCode = response.status;
            const errorText = await response.text();
            let errorMessage = `DeepSeek API error ${errorCode}: ${DEEPSEEK_ERROR_CODES[errorCode] || 'Unknown error'}`;
            
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message) {
                    errorMessage += ` - ${errorJson.error.message}`;
                }
            } catch {
                if (errorText) {
                    errorMessage += ` - ${errorText.substring(0, 200)}`;
                }
            }
            
            const error = new Error(errorMessage);
            error.code = errorCode;
            error.retryable = errorCode === 429 || errorCode >= 500;
            throw error;
        }

        const data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid response format from DeepSeek API');
        }

        const result = data.choices[0].message;
        
        console.log(`[LLM] Response received:`, {
            id: data.id,
            model: data.model,
            finish_reason: data.choices[0].finish_reason,
            content_length: result.content?.length || 0,
            reasoning_content_length: result.reasoning_content?.length || 0,
            usage: data.usage,
            content: result.content,
        });

        if (result.reasoning_content) {
            console.log(`[LLM] Reasoning content (first 200 chars):`, 
                result.reasoning_content.substring(0, 200) + 
                (result.reasoning_content.length > 200 ? '...' : ''));
        }

        return result.content || '';

    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            const timeoutError = new Error(`DeepSeek API request timeout after ${timeoutMs}ms`);
            timeoutError.code = 'TIMEOUT';
            timeoutError.retryable = true;
            throw timeoutError;
        }

        if (!error.code) {
            error.code = 'NETWORK_ERROR';
            error.retryable = true;
        }

        throw error;
    }
}

async function generateResponse(whatsAppMessages, contactName, options = {}) {
    const { maxRetries = constants.LLM.MAX_RETRIES } = options;
    const formattedMessages = await formatWhatsAppMessagesToLLM(whatsAppMessages, contactName);

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[LLM] Generating response (attempt ${attempt}/${maxRetries}) for ${contactName}`);
            const response = await callDeepSeekAPI(formattedMessages, options);
            console.log(`[LLM] Successfully generated response for ${contactName}`);
            return response;
        } catch (error) {
            lastError = error;
            
            const retryDelay = constants.LLM.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            console.error(`[LLM] Attempt ${attempt} failed (${error.code}):`, error.message);
            
            if (attempt < maxRetries && error.retryable !== false) {
                console.log(`[LLM] Retrying in ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else if (attempt === maxRetries) {
                console.error(`[LLM] All ${maxRetries} attempts failed for ${contactName}`);
                
                if (error.code === 401 || error.code === 402) {
                    console.error('[LLM] Critical error: Check API key or account balance');
                }
            }
        }
    }

    throw lastError;
}

module.exports = {
    generateResponse,
    formatWhatsAppMessagesToLLM,
    callDeepSeekAPI,
};