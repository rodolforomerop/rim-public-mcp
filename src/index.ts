#!/usr/bin/env node
/**
 * RIM Public MCP Server
 *
 * Expone la API pública de Registro IMEI Multibanda Chile (los 7 endpoints
 * `/api/v1/*`) como tools MCP, más una tool combinada que hace fan-out de
 * 3 endpoints para procesamiento end-to-end de un IMEI.
 *
 * Pensado para clientes B2B (mayoristas / certificadores) que reciben
 * IMEIs por foto, texto o planilla y necesitan validar + identificar +
 * verificar el estado de homologación de cada uno.
 *
 * Auth: API key pública con prefijo `rim_live_*` (la misma que se usa con
 * curl directo a la API). El emisor (RIM) la asigna por cliente.
 *
 * Variables de entorno requeridas:
 *   - RIM_API_BASE: URL del backend, default https://registroimeimultibanda.cl
 *   - RIM_PUBLIC_API_KEY: la key rim_live_*** que te entregaron
 *
 * Transport: stdio (estándar para MCP servers locales).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const API_BASE = process.env.RIM_API_BASE || 'https://registroimeimultibanda.cl';
const API_KEY = process.env.RIM_PUBLIC_API_KEY;

if (!API_KEY) {
    console.error('[rim-public-mcp] FATAL: RIM_PUBLIC_API_KEY no está configurada en el entorno');
    process.exit(1);
}

if (!API_KEY.startsWith('rim_live_') && !API_KEY.startsWith('rim_test_')) {
    console.error('[rim-public-mcp] WARN: RIM_PUBLIC_API_KEY no parece tener formato rim_live_* / rim_test_* — verificá que sea la correcta');
}

/* ------------------------------ HTTP helper ------------------------------ */

async function callApi(
    path: string,
    body?: any,
    options?: { acceptBinary?: boolean },
): Promise<any> {
    const url = `${API_BASE}${path}`;
    const init: RequestInit = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    };

    const res = await fetch(url, init);

    // El endpoint de SUBTEL XLSX devuelve binario, lo manejamos aparte.
    if (options?.acceptBinary && res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return {
            __binary: true,
            base64: buf.toString('base64'),
            sizeBytes: buf.byteLength,
            contentType: res.headers.get('content-type') || 'application/octet-stream',
            filename:
                res.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ||
                'subtel-export.xlsx',
        };
    }

    const text = await res.text();
    let parsed: any;
    try {
        parsed = text ? JSON.parse(text) : {};
    } catch {
        parsed = { raw: text };
    }

    if (!res.ok) {
        throw new Error(
            `HTTP ${res.status}: ${parsed?.message || parsed?.error || text.slice(0, 300) || res.statusText}`,
        );
    }
    return parsed;
}

/* ------------------------------ Tool schemas ----------------------------- */

const validateSchema = z.object({
    imei: z.string().describe('15 dígitos. Acepta espacios/guiones, los limpia internamente.'),
});

const lookupSchema = z.object({
    imei: z.string().describe('IMEI 15 dígitos o solo TAC (8 dígitos). El TAC son los 8 primeros dígitos del IMEI y bastan para identificar marca/modelo.'),
});

const checkMultibandaSchema = z.object({
    imei: z.string().describe('IMEI 15 dígitos. Consulta la API de WOM (operador chileno cuya base está sincronizada con el sistema oficial SUBTEL).'),
});

const fullCheckSchema = z.object({
    imei: z.string().describe('IMEI 15 dígitos. Hace validate + lookup + check_multibanda EN PARALELO en una sola llamada — ahorra latencia cuando se procesan varios IMEIs seguidos.'),
});

const parseTextSchema = z.object({
    text: z.string().max(8000).describe('Texto en lenguaje natural con uno o más IMEIs y posiblemente metadata (cliente, marca, etc.). Máx 8.000 caracteres. Ej: "te paso 2 imeis del cliente Juan: 359381234567890 del iphone y 868234123456789 del samsung".'),
    locale: z.string().optional().describe('Locale, default "es-CL".'),
});

const parsePhotoSchema = z
    .object({
        photoUrl: z.string().url().optional().describe('URL pública de la imagen (jpg/png).'),
        photoDataUri: z.string().optional().describe('Imagen como data URI: "data:image/jpeg;base64,..."'),
    })
    .refine((d) => d.photoUrl || d.photoDataUri, {
        message: 'Hay que pasar photoUrl o photoDataUri.',
    });

const detectDuplicatesSchema = z.object({
    imeis: z
        .array(z.string())
        .min(1)
        .max(10000)
        .describe('Lista de IMEIs (15 dígitos cada uno, se limpian si vienen con basura). Máx 10.000.'),
});

const exportSubtelSchema = z.object({
    items: z
        .array(
            z.object({
                imei1: z.string(),
                imei2: z.string().optional(),
                serialNumber: z.string().optional(),
                brand: z.string(),
                model: z.string(),
            }),
        )
        .min(1)
        .max(10000)
        .describe('Lista de equipos a incluir en el Excel SUBTEL. Cada item es un equipo con sus IMEIs (1 o 2), opcionalmente serial number, marca y modelo.'),
    format: z
        .enum(['xlsx', 'csv', 'json'])
        .optional()
        .describe('Formato de salida. Default "xlsx" (el formato que pide SUBTEL).'),
    filename: z.string().optional().describe('Nombre base del archivo, sin extensión. Default "subtel-export-<timestamp>".'),
});

/* -------------------------------- Server -------------------------------- */

const server = new Server(
    { name: 'rim-public-mcp-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'rim_full_check_imei',
                description:
                    'Procesamiento completo de un IMEI en una sola llamada: valida Luhn, identifica marca/modelo, y verifica si está inscrito en Chile. Internamente hace fan-out de 3 endpoints en paralelo. **Usar esta tool por defecto** cuando el cliente final manda un IMEI nuevo y querés saber todo de él. Si solo necesitás una pieza específica (ej. solo verificar si está inscrito), usar las tools individuales.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        imei: { type: 'string', description: 'IMEI de 15 dígitos.' },
                    },
                    required: ['imei'],
                },
            },
            {
                name: 'rim_validate_imei',
                description:
                    'Verifica que un IMEI sea sintácticamente correcto (15 dígitos + checksum Luhn). Útil como filtro temprano antes de gastar calls a otros endpoints. Devuelve { valid, imei, tac, reason? }.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        imei: { type: 'string' },
                    },
                    required: ['imei'],
                },
            },
            {
                name: 'rim_lookup_imei_brand',
                description:
                    'Identifica marca y modelo de un IMEI a partir de su TAC (los primeros 8 dígitos). Devuelve { brand, model, deviceType, source: "cache"|"api"|"none", found }. Cache hit = instantáneo y gratis. Cache miss = consulta a fuente externa, levemente más lento.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        imei: { type: 'string' },
                    },
                    required: ['imei'],
                },
            },
            {
                name: 'rim_check_multibanda_status',
                description:
                    'Verifica si un IMEI ya está inscrito en la base oficial chilena (sistema Multibanda / SAE de SUBTEL). Devuelve { isRegistered: true|false, message }. **Crítico antes de cobrar al cliente final** — si ya está inscrito no tiene sentido inscribirlo de nuevo.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        imei: { type: 'string' },
                    },
                    required: ['imei'],
                },
            },
            {
                name: 'rim_parse_imeis_from_text',
                description:
                    'Extrae IMEIs y metadata (marca, modelo, nombre del cliente, notas) desde un mensaje de texto en lenguaje natural. Útil cuando el cliente final manda un WhatsApp tipo "te paso 3 imeis del cliente Juan, primero es del iphone 14...". Devuelve { items: [{imei, brand?, model?, customerName?, notes?}], intent, summary }.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                        locale: { type: 'string' },
                    },
                    required: ['text'],
                },
            },
            {
                name: 'rim_parse_imeis_from_photo',
                description:
                    'Extrae IMEIs y serial number desde una foto del dispositivo (caja, etiqueta, o pantalla *#06#). Acepta photoUrl (URL pública) o photoDataUri (base64). Útil cuando el cliente final manda solo una foto sin escribir nada. Devuelve { imei1, imei2?, serialNumber?, found }.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        photoUrl: { type: 'string', description: 'URL pública de la imagen (jpg/png), máx 10MB.' },
                        photoDataUri: { type: 'string', description: 'Imagen como data URI base64.' },
                    },
                },
            },
            {
                name: 'rim_detect_duplicate_imeis',
                description:
                    'Recibe una lista de IMEIs y detecta duplicados. Útil cuando consolidás múltiples planillas o WhatsApps del cliente final y querés evitar procesar el mismo IMEI dos veces. Devuelve { total, unique, duplicates: [{imei, occurrences, positions}], uniqueImeis }.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        imeis: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['imeis'],
                },
            },
            {
                name: 'rim_export_subtel_xlsx',
                description:
                    'Genera el archivo Excel en el formato exacto que pide SUBTEL para subir al laboratorio (5 columnas: IMEI 1, IMEI 2, Serie, Marca, Modelo). Acepta hasta 10.000 items. Devuelve el archivo en base64 listo para que el agente lo entregue al cliente o lo suba a Drive/Sheets. Formato default xlsx, también soporta csv y json.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    imei1: { type: 'string' },
                                    imei2: { type: 'string' },
                                    serialNumber: { type: 'string' },
                                    brand: { type: 'string' },
                                    model: { type: 'string' },
                                },
                                required: ['imei1', 'brand', 'model'],
                            },
                        },
                        format: { type: 'string', enum: ['xlsx', 'csv', 'json'] },
                        filename: { type: 'string' },
                    },
                    required: ['items'],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'rim_full_check_imei': {
                const { imei } = fullCheckSchema.parse(args || {});
                const [validate, lookup, multibanda] = await Promise.allSettled([
                    callApi('/api/v1/imei/validate', { imei }),
                    callApi('/api/v1/imei/lookup-tac', { imei }),
                    callApi('/api/v1/imei/check-multibanda', { imei }),
                ]);

                const result = {
                    imei,
                    validation:
                        validate.status === 'fulfilled'
                            ? validate.value
                            : { error: (validate as any).reason?.message },
                    device:
                        lookup.status === 'fulfilled'
                            ? lookup.value
                            : { error: (lookup as any).reason?.message },
                    multibanda:
                        multibanda.status === 'fulfilled'
                            ? multibanda.value
                            : { error: (multibanda as any).reason?.message },
                    summary: {
                        isValid: validate.status === 'fulfilled' && (validate.value as any)?.valid === true,
                        brandModel:
                            lookup.status === 'fulfilled'
                                ? `${(lookup.value as any)?.brand || '?'} ${(lookup.value as any)?.model || '?'}`.trim()
                                : '?',
                        isRegisteredInChile:
                            multibanda.status === 'fulfilled' &&
                            (multibanda.value as any)?.isRegistered === true,
                    },
                };
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }

            case 'rim_validate_imei': {
                const { imei } = validateSchema.parse(args || {});
                const data = await callApi('/api/v1/imei/validate', { imei });
                return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }

            case 'rim_lookup_imei_brand': {
                const { imei } = lookupSchema.parse(args || {});
                const data = await callApi('/api/v1/imei/lookup-tac', { imei });
                return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }

            case 'rim_check_multibanda_status': {
                const { imei } = checkMultibandaSchema.parse(args || {});
                const data = await callApi('/api/v1/imei/check-multibanda', { imei });
                return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }

            case 'rim_parse_imeis_from_text': {
                const parsed = parseTextSchema.parse(args || {});
                const data = await callApi('/api/v1/imei/parse-message', parsed);
                return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }

            case 'rim_parse_imeis_from_photo': {
                const parsed = parsePhotoSchema.parse(args || {});
                const data = await callApi('/api/v1/imei/parse-photo', parsed);
                return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }

            case 'rim_detect_duplicate_imeis': {
                const parsed = detectDuplicatesSchema.parse(args || {});
                const data = await callApi('/api/v1/imei/detect-duplicates', parsed);
                return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }

            case 'rim_export_subtel_xlsx': {
                const parsed = exportSubtelSchema.parse(args || {});
                const isBinary = !parsed.format || parsed.format === 'xlsx';
                const data = await callApi('/api/v1/subtel/format-export', parsed, {
                    acceptBinary: isBinary,
                });
                return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }

            default:
                return {
                    content: [{ type: 'text', text: `Tool desconocida: ${name}` }],
                    isError: true,
                };
        }
    } catch (error: any) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error ejecutando ${name}: ${error?.message || String(error)}`,
                },
            ],
            isError: true,
        };
    }
});

/* --------------------------------- Boot --------------------------------- */

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[rim-public-mcp] running. API_BASE=${API_BASE}`);
}

main().catch((err) => {
    console.error('[rim-public-mcp] fatal:', err);
    process.exit(1);
});
