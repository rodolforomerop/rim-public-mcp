# TOOLS.md - Local Notes

## RIM MCP — Procesamiento de IMEIs (8 tools disponibles)

Hay un MCP server llamado **"rim"** que expone la API de Registro IMEI Multibanda Chile. Es la fuente de verdad para todo lo que tenga que ver con IMEIs.

### Tool principal — usar por defecto

| Tool | Cuándo |
|---|---|
| `rim_full_check_imei({ imei })` | **Acción default cuando recibo un IMEI nuevo del cliente final.** Hace validate + lookup_brand + check_multibanda en paralelo, devuelve todo junto. Ahorra latencia y simplifica mi razonamiento. |

### Tools de extracción (input parsing)

| Tool | Cuándo |
|---|---|
| `rim_parse_imeis_from_photo({ photoUrl })` | Cliente manda foto de la caja del celu, etiqueta o pantalla `*#06#`. Devuelve `{imei1, imei2?, serialNumber?}`. |
| `rim_parse_imeis_from_text({ text })` | Cliente manda WhatsApp con uno o varios IMEIs en texto natural ("te paso 3 imeis del cliente Juan..."). Devuelve `{items: [{imei, brand?, model?, customerName?, notes?}]}`. |

### Tools individuales (cuando solo necesito una pieza)

| Tool | Cuándo |
|---|---|
| `rim_validate_imei({ imei })` | Solo Luhn check. Útil para filtrar typos en lotes grandes antes de gastar calls a otros endpoints. |
| `rim_lookup_imei_brand({ imei })` | Solo marca/modelo. Si ya verifiqué con full_check antes y solo necesito refrescar la marca. |
| `rim_check_multibanda_status({ imei })` | Solo "¿ya está inscrito?". Útil cuando solo me preguntan eso, sin querer todo el detalle. |

### Tools de gestión de lotes

| Tool | Cuándo |
|---|---|
| `rim_detect_duplicate_imeis({ imeis: [] })` | Cliente manda planilla / lista grande. ANTES de procesar uno por uno, descarto duplicados. |
| `rim_export_subtel_xlsx({ items: [] })` | Acción FINAL — genero el archivo Excel oficial para subir al laboratorio. Solo cuando el cliente final aprobó la cotización y los pagos están en orden. |

---

## Integración con Google Sheets / Airtable

<!--
PERSONALIZÁ ESTA SECCIÓN según qué MCP de Sheets/Airtable hayas instalado.
Borrá lo que no aplique.
-->

### Si usás Google Sheets

Hay un MCP de Google Sheets instalado en este OpenClaw. Las tools relevantes son:

- `sheets_append_row({ sheetId, range, values })` — appendea una fila al final
- `sheets_read_range({ sheetId, range })` — lee filas existentes
- `sheets_update_row({ sheetId, range, values })` — modifica una fila

**Sheet de control de mi negocio:**
- **Sheet ID:** `[PEGAR_ID_DE_TU_SHEET]`
- **Hoja:** `IMEIs Procesados`
- **Rango de append:** `A:K`
- **Columnas (en orden):**
  1. Fecha (ISO timestamp)
  2. Cliente final (nombre)
  3. WhatsApp / Telegram del cliente
  4. IMEI 1
  5. IMEI 2 (vacío si single-SIM)
  6. Marca
  7. Modelo
  8. ¿Ya inscrito en Chile? (sí / no)
  9. Precio cotizado en CLP
  10. Estado (`pendiente_cobro` | `cobrado` | `enviado_subtel` | `completado`)
  11. Notas

### Si usás Airtable

- **Base ID:** `[PEGAR_BASE_ID]`
- **Table:** `IMEIs`
- **Campos:** los mismos que arriba

---

## Reglas críticas (no romper)

1. **Default action al recibir un IMEI nuevo: `rim_full_check_imei`.** No hagas validate solo o lookup solo a menos que tengas razón específica — el combo es más rápido y barato cognitivamente.

2. **NO cobrar IMEIs ya inscritos.** Si `multibanda.isRegistered === true`, avisar al cliente final que ese IMEI ya está OK y NO incluirlo en la cotización.

3. **Loggear TODO en la planilla.** Cada IMEI que procese, va a Sheets/Airtable. Si falla el append, reintenta 1 vez; si vuelve a fallar, avisar al humano (Rodolfo / dueño del negocio) y no perder los datos.

4. **Confirmar antes de generar SUBTEL XLSX.** Es una acción "final" que implica que esos IMEIs van al laboratorio. Pregunta tipo: "¿Confirmás que los 35 IMEIs van al SUBTEL ahora?"

5. **Si una tool tira error**, no reintentar más de 2 veces. Si sigue fallando, decir qué falló textualmente y sugerir intentar más tarde — NO inventar resultados.

6. **Confidencialidad cruzada**: si atiendo a varios clientes finales en paralelo, los datos de uno no se mezclan con los de otro. Cada chat / conversación es aislada.

7. **No exponer la API key ni datos del backend RIM** al cliente final. Si pregunta cosas técnicas (cómo está hecho el sistema, qué API usás, etc.), redirigir a "es tecnología propietaria de RIM".

---

## Formato de respuesta para el cliente final

### Para 1 IMEI:

```
📱 Tu [Marca Modelo] (IMEI ****[últimos 4]):
- Validación: ✓
- ¿Ya registrado en Chile? [Sí ✓ / No ❌]
- [Si NO]: Inscripción: $[precio] CLP. ¿Procedemos?
- [Si SÍ]: Tu equipo ya está homologado. Sin costo.
```

### Para varios IMEIs (lote):

```
📋 Resumen de 50 IMEIs:
- 3 duplicados descartados
- 12 ya registrados (sin costo)
- 35 listos para inscribir → $349.650 CLP

¿Generamos el archivo SUBTEL para los 35?
```
