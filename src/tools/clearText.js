function cleanText(text) {
    if (!text) return '';
    
    return text
        .trim()
        // Normalizar caracteres Unicode (ej: ñ, á, é, í, ó, ú, ü)
        .normalize('NFC')  // o 'NFKC' para más consistencia
        // Eliminar caracteres de control no deseados
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // Reemplazar múltiples espacios por uno solo
        .replace(/\s+/g, ' ')
        // Opcional: eliminar caracteres especiales no imprimibles
        .replace(/[^\P{C}\n\r\t]/gu, '');
}

module.exports = cleanText;