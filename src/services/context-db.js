const fs = require('fs');
const path = require('path');
const { ChromaClient } = require('chromadb');

const { DefaultEmbeddingFunction } = require('@chroma-core/default-embed');
// const { SentenceTransformersEmbeddingFunction } = require('@chroma-core/sentence-transformer');

const config = require('../config/env');
const { PDFParse} = require('pdf-parse');

const cleanText = require('../tools/clearText');

const CONTEXT_DIR_PATH = process.env.CONTEXT_DIR_PATH || 'contexto';
const CONTEXT_FILE_PATH = process.env.CONTEXT_FILE_PATH || null; // Compatibilidad
const CONTEXT_RESULTS_COUNT = parseInt(process.env.CONTEXT_RESULTS_COUNT) || 3;
const CHROMA_HOST = process.env.CHROMA_HOST || 'localhost';
const CHROMA_PORT = process.env.CHROMA_PORT || 8000;
const CHROMA_SSL = process.env.CHROMA_SSL === 'true' || false;

// Configuración de chunking adaptativo
const CONTEXT_MIN_CHARS = parseInt(process.env.CONTEXT_MIN_CHARS) || 20;
const CONTEXT_TARGET_CHARS = parseInt(process.env.CONTEXT_TARGET_CHARS) || 600;
const CONTEXT_MAX_CHARS = parseInt(process.env.CONTEXT_MAX_CHARS) || 1200;
const CONTEXT_OVERLAP_CHARS = parseInt(process.env.CONTEXT_OVERLAP_CHARS) || 0;
const CONTEXT_SPLIT_BY_PARAGRAPHS = process.env.CONTEXT_SPLIT_BY_PARAGRAPHS !== 'false'; // true por defecto

function withTimeout(promise, ms, errorMessage = 'Timeout') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms))
    ]);
}

/**
 * Une líneas rotas artificialmente en textos extraídos de PDFs
 * Cuando una línea termina con letra (sin puntuación) y la siguiente empieza con minúscula,
 * probablemente es una continuación.
 */
function fixBrokenLines(text) {
    const lines = text.split('\n');
    const fixed = [];
    let i = 0;
    
    while (i < lines.length) {
        let currentLine = lines[i].trim();
        let j = i + 1;
        
        // Buscar líneas siguientes que sean continuaciones
        while (j < lines.length) {
            const nextLine = lines[j].trim();
            if (nextLine.length === 0) break;
            
            // Detectar si currentLine termina con letra y nextLine empieza con minúscula
            const endsWithLetter = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]$/.test(currentLine);
            const startsWithLower = /^[a-záéíóúñ]/.test(nextLine);
            
            if (endsWithLetter && startsWithLower) {
                // Unir con espacio (línea rota artificialmente)
                currentLine += ' ' + nextLine;
                j++;
            } else {
                break;
            }
        }
        
        fixed.push(currentLine);
        i = j;
    }
    
    return fixed.join('\n');
}

/**
 * Divide texto en chunks semánticos usando algoritmo adaptativo
 */
function splitIntoSemanticChunks(text, options = {}) {
    const {
        minChars = CONTEXT_MIN_CHARS,
        targetChars = CONTEXT_TARGET_CHARS,
        maxChars = CONTEXT_MAX_CHARS,
        overlapChars = CONTEXT_OVERLAP_CHARS,
        splitByParagraphs = CONTEXT_SPLIT_BY_PARAGRAPHS
    } = options;
    
    // Determinar separador según tipo de contenido
    const separator = splitByParagraphs ? '\n\n' : ' ';
    const separatorLength = splitByParagraphs ? 2 : 1;
    
    // Paso 1: Corregir líneas rotas en PDFs
    const fixedText = fixBrokenLines(text);
    
    // Paso 2: Dividir en párrafos naturales (múltiples saltos de línea)
    let paragraphs = fixedText.split(/\n\s*\n+/);
    
    // Paso 3: Limpiar y filtrar párrafos vacíos
    paragraphs = paragraphs.map(p => p.trim()).filter(p => p.length > 0);
    
    if (!splitByParagraphs || paragraphs.length === 0) {
        // Fallback: dividir por oraciones
        paragraphs = fixedText.split(/(?<=[.!?])\s+/).filter(p => p.length > 0);
    }
    

    
    const chunks = [];
    let currentChunk = '';
    let currentChars = 0;
    
    for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i];
        const paraChars = para.length;
        
        // Caso 1: Párrafo individual es muy grande (> maxChars)
        if (paraChars > maxChars) {
            // Si ya tenemos un chunk en construcción, guardarlo
            if (currentChars >= minChars) {
                chunks.push(currentChunk);
                currentChunk = '';
                currentChars = 0;
            }
            
            // Dividir el párrafo grande en oraciones
            const sentences = para.split(/(?<=[.!?;])\s+/).filter(s => s.length > 0);
            let sentenceChunk = '';
            let sentenceChars = 0;
            
            for (const sentence of sentences) {
                const sentenceLength = sentence.length;
                
                if (sentenceChars + sentenceLength <= maxChars) {
                    sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
                    sentenceChars += sentenceLength + 1; // +1 por el espacio
                } else {
                    if (sentenceChunk.length >= minChars) {
                        chunks.push(sentenceChunk);
                    }
                    sentenceChunk = sentence;
                    sentenceChars = sentenceLength;
                }
            }
            
            if (sentenceChunk.length >= minChars) {
                chunks.push(sentenceChunk);
            }
            continue;
        }
        
        // Caso 2: Agregar este párrafo al chunk actual
        if (currentChars + paraChars <= targetChars) {
            currentChunk += (currentChunk ? separator : '') + para;
            currentChars += paraChars + separatorLength; // +separatorLength por el separador
        } else {
            // Chunk actual está lo suficientemente lleno
            if (currentChars >= minChars) {
                chunks.push(currentChunk);
                
                // Iniciar nuevo chunk con superposición (si está habilitada y hay chunks anteriores)
                if (overlapChars > 0 && chunks.length > 0) {
                    const lastChunk = chunks[chunks.length - 1];
                    const overlapText = lastChunk.slice(-overlapChars);
                    currentChunk = overlapText + separator + para;
                    currentChars = overlapText.length + separatorLength + paraChars;
                } else {
                    currentChunk = para;
                    currentChars = paraChars;
                }
            } else {
                // Chunk actual muy pequeño, forzar combinación con este párrafo
            currentChunk += (currentChunk ? separator : '') + para;
                currentChars += paraChars + separatorLength;
            }
        }
    }
    
    // Agregar el último chunk si cumple mínimo
    if (currentChars >= minChars) {
        chunks.push(currentChunk);
    }
    
    // Si no se generaron chunks pero hay texto, crear un chunk con todo el contenido
    if (chunks.length === 0 && fixedText.trim().length > 0) {
        const fullText = fixedText.trim();
        
        // Caso 1: Texto demasiado pequeño (menor que minChars)
        if (fullText.length < minChars) {
            return [fullText]; // Retornar único chunk pequeño
        }
        
        // Caso 2: Texto demasiado largo (mayor que maxChars)
        if (fullText.length > maxChars) {
            // Dividir en oraciones y agrupar
            const sentences = fullText.split(/(?<=[.!?;])\s+/).filter(s => s.length > 0);
            let sentenceChunk = '';
            for (const sentence of sentences) {
                if (sentenceChunk.length + sentence.length + 1 <= maxChars) {
                    sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
                } else {
                    if (sentenceChunk.length >= minChars) chunks.push(sentenceChunk);
                    sentenceChunk = sentence;
                }
            }
            if (sentenceChunk.length >= minChars) chunks.push(sentenceChunk);
            
            // Si después de dividir no hay chunks (todas las oraciones muy cortas),
            // retornar el texto completo como único chunk
            if (chunks.length === 0) {
                return [fullText];
            }
            
            return chunks.filter(chunk => chunk.length >= minChars);
        }
        
        // Caso 3: Texto de tamaño adecuado (entre minChars y maxChars)
        return [fullText];
    }
    
    // Filtrar chunks que sean demasiado pequeños (por si acaso)
    return chunks.filter(chunk => chunk.length >= minChars);
}

async function loadContextFromPath(contextPath) {
    const paragraphs = [];
    const stat = fs.statSync(contextPath, { throwIfNoEntry: false });
    if (!stat) {
        console.warn(`[ChromaDB] Ruta de contexto no encontrada: ${contextPath}`);
        return paragraphs;
    }
    
    if (stat.isDirectory()) {
        const files = fs.readdirSync(contextPath, { withFileTypes: true });
        for (const file of files) {
            if (file.isDirectory()) continue;
            const ext = path.extname(file.name).toLowerCase();
            if (ext !== '.txt' && ext !== '.pdf') continue;
            
            const filePath = path.join(contextPath, file.name);
            await processFile(filePath, file.name, paragraphs);
        }
    } else if (stat.isFile()) {
        const fileName = path.basename(contextPath);
        await processFile(contextPath, fileName, paragraphs);
    }
    
    return paragraphs;
}

async function processFile(filePath, fileName, paragraphs) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.txt' && ext !== '.pdf') return;
    
    try {
        let text = '';
        if (ext === '.txt') {
            text = fs.readFileSync(filePath, 'utf-8');
        } else if (ext === '.pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = new PDFParse({data:dataBuffer});
            const dataText = await pdfData.getText();
            text = dataText.text;
        }
        
        // Dividir en chunks semánticos usando algoritmo adaptativo
        const fileParagraphs = splitIntoSemanticChunks(text);
        
        // Agregar metadatos de fuente
        for (const para of fileParagraphs) {
            paragraphs.push({
                text: para,
                source: fileName,
                path: filePath
            });
        }
        
        const avgLength = fileParagraphs.length > 0 
            ? Math.round(fileParagraphs.reduce((sum, p) => sum + p.length, 0) / fileParagraphs.length)
            : 0;
        console.log(`[ChromaDB] Cargado ${fileParagraphs.length} chunks de ${fileName} (avg: ${avgLength} chars)`);
    } catch (error) {
        console.error(`[ChromaDB] Error al procesar archivo ${fileName}:`, error.message);
    }
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
        // const embeddingFunction = new SentenceTransformersEmbeddingFunction({
            
        //     modelName:'Xenova/all-MiniLM-L6-v2',
        //     device: 'cpu', // 'cpu' or 'gpu' (default: 'cpu'),
            
        // });
        
        // Determinar ruta de contexto (prioridad: directorio, luego archivo)
        let contextPath = null;
        if (fs.existsSync(CONTEXT_DIR_PATH)) {
            contextPath = CONTEXT_DIR_PATH;
            console.log(`[ChromaDB] Usando ruta de contexto: ${contextPath}`);
        } else if (CONTEXT_FILE_PATH && fs.existsSync(CONTEXT_FILE_PATH)) {
            contextPath = CONTEXT_FILE_PATH;
            console.log(`[ChromaDB] Usando archivo de contexto (compatibilidad): ${contextPath}`);
        } else {
            console.warn('[ChromaDB] No se encontró directorio ni archivo de contexto. Usando contexto vacío.');
            isInitialized = true;
            return;
        }
        
        // Cargar párrafos desde la ruta (directorio o archivo)
        const paragraphObjects = await loadContextFromPath(contextPath);
        if (paragraphObjects.length === 0) {
            console.warn('[ChromaDB] No hay párrafos válidos en los archivos de contexto');
            isInitialized = true;
            return;
        }
        
        console.log(`[ChromaDB] Cargados ${paragraphObjects.length} párrafos de ${contextPath}`);
        
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
        
        const ids = paragraphObjects.map((_, i) => `doc_${i}`);
        const documents = paragraphObjects.map(p => cleanText(p.text));
        const metadatas = paragraphObjects.map((p, i) => ({ 
            source: p.source, 
            path: p.path,
            paragraph: i 
        }));
        const paragraphs = documents; // Compatibilidad con código posterior
        
        console.log('[ChromaDB] Generando embeddings (puede tardar varios segundos)...');

        const batchDocumentsCantidad = 100
        for(let i = 0; i < paragraphs.length; i += batchDocumentsCantidad) {
            const batchIds = ids.slice(i, i + batchDocumentsCantidad);
            const batchDocuments = documents.slice(i, i + batchDocumentsCantidad);
            const batchMetadatas = metadatas.slice(i, i + batchDocumentsCantidad);
            await collection.add({
                ids: batchIds,
                documents: batchDocuments,
                metadatas: batchMetadatas,
            });
        }
        
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

        console.log("[contextDocuments]: ",contextDocuments);
        
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
    splitIntoSemanticChunks,
};