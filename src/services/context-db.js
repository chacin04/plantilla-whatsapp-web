const fs = require('fs');
const path = require('path');
const { ChromaClient } = require('chromadb');
const { DefaultEmbeddingFunction } = require('@chroma-core/default-embed');
const config = require('../config/env');

const CONTEXT_FILE_PATH = process.env.CONTEXT_FILE_PATH || 'contexto.txt';
const CONTEXT_RESULTS_COUNT = parseInt(process.env.CONTEXT_RESULTS_COUNT) || 3;
const CHROMA_HOST = process.env.CHROMA_HOST || 'localhost';
const CHROMA_PORT = process.env.CHROMA_PORT || 8000;
const CHROMA_SSL = process.env.CHROMA_SSL === 'true' || false;

function withTimeout(promise, ms, errorMessage = 'Timeout') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms))
    ]);
}

let chromaClient = null;
let collection = null;
let isInitialized = false;

async function initializeContextDB() {
    try {
        console.log('[ChromaDB] Inicializando base de datos de contexto...');
        console.log(`[ChromaDB] Conectando a servidor: ${CHROMA_HOST}:${CHROMA_PORT} (SSL: ${CHROMA_SSL})`);
        
        chromaClient = new ChromaClient({
            host: CHROMA_HOST,
            port: CHROMA_PORT,
            ssl: CHROMA_SSL,
        });
        
        try {
            await withTimeout(chromaClient.heartbeat(), 5000, 'Timeout de conexión al servidor Chroma');
            console.log('[ChromaDB] Conexión exitosa al servidor Chroma');
        } catch (error) {
            console.warn('[ChromaDB] No se pudo conectar al servidor Chroma:', error.message);
            console.warn('[ChromaDB] Asegúrate de que el servidor esté corriendo con: npx chroma run --path ./chroma_db (o ./getting-started)');
            console.warn('[ChromaDB] Continuando sin funcionalidad de contexto.');
            isInitialized = false;
            return;
        }
        
        try {
            console.log('[ChromaDB] Eliminando colección anterior si existe...');
            await chromaClient.deleteCollection({name: 'context'});
            console.log('[ChromaDB] Colección anterior eliminada exitosamente');
        } catch (deleteError) {
            console.warn('[ChromaDB] No se pudo eliminar la colección (puede que no exista):', deleteError.message);
        }
        
        const embeddingFunction = new DefaultEmbeddingFunction();
        
        console.log('[ChromaDB] Cargando archivo de contexto:', CONTEXT_FILE_PATH);
        if (!fs.existsSync(CONTEXT_FILE_PATH)) {
            console.warn(`[ChromaDB] Archivo ${CONTEXT_FILE_PATH} no encontrado. Usando contexto vacío.`);
            isInitialized = true;
            return;
        }
        
        const contextText = fs.readFileSync(CONTEXT_FILE_PATH, 'utf-8');
        const paragraphs = contextText
            .split('\n\n')
            .map(p => p.trim())
            .filter(p => p.length > 0);
        
        console.log(`[ChromaDB] Dividido en ${paragraphs.length} párrafos`);
        
        if (paragraphs.length === 0) {
            console.warn('[ChromaDB] No hay párrafos válidos en el archivo');
            isInitialized = true;
            return;
        }
        
        console.log('[ChromaDB] Creando nueva colección...');
        try {
            collection = await chromaClient.createCollection({
                name: 'context',
                embeddingFunction: embeddingFunction,
            });
        } catch (createError) {
            if (createError.message.includes('already exists') || createError.message.includes('exist')) {
                console.log('[ChromaDB] La colección ya existe, eliminando y recreando...');
                await chromaClient.deleteCollection({name: 'context'});
                collection = await chromaClient.createCollection({
                    name: 'context',
                    embeddingFunction: embeddingFunction,
                });
            } else {
                throw createError;
            }
        }
        
        const ids = paragraphs.map((_, i) => `doc_${i}`);
        const metadatas = paragraphs.map((_, i) => ({ source: CONTEXT_FILE_PATH, paragraph: i }));
        
        console.log('[ChromaDB] Generando embeddings (puede tardar varios segundos)...');
        await collection.add({
            ids: ids,
            documents: paragraphs,
            metadatas: metadatas,
        });
        
        console.log(`[ChromaDB] Base de datos inicializada con ${paragraphs.length} documentos`);
        isInitialized = true;
        
    } catch (error) {
        console.error('[ChromaDB] Error durante la inicialización:', error);
        isInitialized = false;
        console.warn('[ChromaDB] Continuando sin funcionalidad de contexto.');
    }
}

async function queryContext(query, nResults = CONTEXT_RESULTS_COUNT) {
    if (!isInitialized || !collection) {
        console.warn('[ChromaDB] Base de datos no inicializada, retornando contexto vacío');
        return [];
    }
    
    try {
        const results = await collection.query({
            queryTexts: [query],
            nResults: nResults,
        });
        
        if (!results.documents || results.documents.length === 0) {
            return [];
        }
        
        const contextDocuments = results.documents[0];
        const distances = results.distances[0];
        
        return contextDocuments.map((doc, i) => ({
            text: doc,
            similarity: distances[i] !== undefined ? 1 - distances[i] : null,
        }));
        
    } catch (error) {
        console.error('[ChromaDB] Error consultando contexto:', error);
        return [];
    }
}

async function getContextForMessage(message, nResults = CONTEXT_RESULTS_COUNT) {
    try {
        const contextResults = await queryContext(message, nResults);
        
        if (contextResults.length === 0) {
            return '';
        }
        
        const contextText = contextResults
            .map((result, i) => `[Contexto ${i + 1}] ${result.text}`)
            .join('\n\n');
        
        return `Información relevante de nuestra base de conocimientos:\n${contextText}`;
        
    } catch (error) {
        console.error('[ChromaDB] Error obteniendo contexto para mensaje:', error);
        return '';
    }
}

module.exports = {
    initializeContextDB,
    queryContext,
    getContextForMessage,
    isInitialized: () => isInitialized,
};