# ChromaDB Lite - Integración de Contexto

## Resumen

Se ha integrado ChromaDB Lite para enriquecer las respuestas del LLM con contexto de un archivo de texto. Cada vez que se inicia la aplicación:

1. **Elimina la colección anterior** (si existe) y crea una nueva con el contenido actualizado
2. **Carga el archivo `contexto.txt`** de la raíz del proyecto
3. **Divide el texto por párrafos** y genera embeddings locales usando `all-MiniLM-L6-v2`
4. **Almacena los embeddings** en ChromaDB para búsqueda semántica
5. **Enriquece el último mensaje del usuario** con contexto relevante antes de enviar al LLM

## Configuración

### 1. Archivo de contexto
- Ubicación: `contexto.txt` en la raíz del proyecto
- Formato: Texto plano, dividido por párrafos (líneas en blanco)
- Contenido: Información sobre productos de mecánica (ejemplo incluido)

### 2. Variables de entorno (opcionales)
Agregar al archivo `.env`:

```
# ChromaDB Context Configuration
CONTEXT_FILE_PATH=contexto.txt
CONTEXT_RESULTS_COUNT=3
CHROMA_HOST=localhost
CHROMA_PORT=8000
CHROMA_SSL=false
```

### 3. Iniciar servidor Chroma
**En una terminal separada**, ejecutar:
```bash
npm run start:chroma
```
o
```bash
npx chroma run --path ./chroma_db
```

El servidor se ejecutará en `http://localhost:8000`.

### 4. Iniciar la aplicación
**En otra terminal**, ejecutar:
```bash
npm start
```

## Flujo de trabajo

1. **Inicialización**: Al iniciar la aplicación, se conecta al servidor Chroma, carga el archivo `contexto.txt` y genera embeddings (puede tardar 10-30 segundos la primera vez).

2. **Recepción de mensaje**: Cuando llega un mensaje de WhatsApp:
   - Se extrae el último mensaje del usuario
   - Se busca contexto relevante en ChromaDB (los 3 párrafos más similares)
   - Se inserta un mensaje `system` con el contexto antes del último mensaje
   - Se envía todo al LLM para generar una respuesta informada

3. **Actualización del contexto**: Para cambiar la información:
   - Modificar `contexto.txt`
   - Reiniciar la aplicación (se regenerará la base de datos)

## Estructura de archivos

```
src/services/context-db.js      # Módulo ChromaDB
src/services/llm-http.js        # Módulo LLM (modificado para usar contexto)
contexto.txt                    # Archivo de contexto (personalizable)
chroma_db/                      # Directorio de persistencia de Chroma (opcional)
```

## Scripts disponibles

```bash
npm start                       # Inicia la aplicación principal
npm run start:chroma            # Inicia servidor Chroma (./chroma_db)
npm run start:chroma:getting-started # Inicia servidor Chroma (./getting-started)
npm run test:context            # Prueba la funcionalidad de contexto
```

## Notas importantes

- **Primera ejecución**: La descarga del modelo de embeddings (~90MB) puede demorar. Se cachea localmente.
- **Sin servidor Chroma**: Si el servidor no está disponible, la aplicación funcionará sin contexto (fallback silencioso).
- **Recreación de colección**: En cada inicio se elimina la colección anterior (si existe) y se crea una nueva con el contenido actualizado de `contexto.txt`.
- **Rendimiento**: Las búsquedas son rápidas una vez generados los embeddings.

## Personalización

- **Cambiar archivo de contexto**: Modificar `CONTEXT_FILE_PATH` en `.env`
- **Cambiar número de resultados**: Modificar `CONTEXT_RESULTS_COUNT`
- **Cambiar modelo de embeddings**: Editar `src/services/context-db.js` (línea 54)

## Solución de problemas

### Error "Failed to connect to chromadb"
- Verificar que el servidor Chroma esté corriendo: `curl http://localhost:8000/api/v1/heartbeat`
- Revisar los logs del servidor Chroma

### Error "Protobuf parsing failed" (modelo ONNX)
- Borrar cache: `rm -rf node_modules/@huggingface/transformers/.cache`
- Reiniciar aplicación

### Error "The requested resource could not be found" al eliminar colección
- Normal: ocurre cuando la colección no existía previamente (primer inicio)
- No afecta la funcionalidad: se procede a crear la colección nueva

### El contexto no se incluye en las respuestas
- Verificar que el servidor Chroma esté inicializado (logs de inicio)
- Revisar que `contexto.txt` tenga contenido válido
- Probar con `npm run test:context`