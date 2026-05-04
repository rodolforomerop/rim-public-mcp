# Casos de uso típicos del agente B2B

Estos son los flujos que tu agente de OpenClaw va a ejecutar más seguido. Sirven como referencia para entender cómo combinar las tools del MCP `rim` con las de Google Sheets/Airtable.

---

## Flow 1: Cliente final manda foto del celular

**Input típico (Telegram):**

> [foto de la caja del Samsung]
> Hola, ¿este celu está registrado?

**Flow del agente:**

1. `rim_parse_imeis_from_photo({ photoUrl: "url-de-la-foto-en-telegram" })`
   - Devuelve: `{ imei1: "359381234567890", imei2: "359381234567891", serialNumber: "RF8XXXX" }`

2. `rim_full_check_imei({ imei: "359381234567890" })`
   - Devuelve: `{ validation: { valid: true, tac: "35938123" }, device: { brand: "Samsung", model: "Galaxy S25 Ultra" }, multibanda: { isRegistered: false }, summary: { isValid: true, brandModel: "Samsung Galaxy S25 Ultra", isRegisteredInChile: false } }`

3. (Si tiene `imei2`) repetir para el segundo IMEI

4. **(Sheets append)** `sheets_append_row({ sheetId: "...", values: [date, customerName, imei1, brand, model, status, price] })`

5. **Respuesta al cliente final:**
   > Tu **Samsung Galaxy S25 Ultra** (IMEI 35938...7890):
   > ❌ NO está registrado en Chile
   > Inscripción dual-SIM: **$9.990 CLP**
   >
   > ¿Querés que lo procesemos?

---

## Flow 2: Cliente final manda planilla Excel con 50 IMEIs

**Input típico:**

> [adjunto: lista_imeis_mayo.xlsx]
> Aquí los imeis del mes para inscribir

**Flow del agente:**

1. Extraer los IMEIs del Excel (con la tool de parser de archivos del agente o copy-paste manual al chat)

2. `rim_detect_duplicate_imeis({ imeis: [...50 imeis...] })`
   - Devuelve: `{ total: 50, unique: 47, duplicates: [...], uniqueImeis: [...47...] }`

3. **Loop por los 47 únicos** (o batches de 5-10 en paralelo):
   - `rim_full_check_imei({ imei })` para cada uno
   - Anotar resultados: válidos / ya registrados / pendientes de inscribir

4. **(Sheets append por lote)** todos los registros en la planilla del cliente B2B

5. **Resumen al cliente final:**
   > De 50 IMEIs:
   > - 3 duplicados descartados
   > - 12 ya estaban inscritos (sin costo)
   > - 35 listos para inscribir
   >
   > Total: **$349.650 CLP**
   > ¿Generamos el archivo SUBTEL para los 35?

6. Si dice sí → `rim_export_subtel_xlsx({ items: [...35 items con brand/model...] })`
   - Devuelve: archivo XLSX en base64
   - Agente reenvía al cliente final como adjunto

---

## Flow 3: Cliente final manda mensaje de texto sin estructura

**Input típico (WhatsApp):**

> Hola, te paso 3 imeis pa inscribir esta semana, son del cliente Pedro Reyes:
> primero del iphone 14 pro: 354123456789012
> el samsung S23: 868234567890123
> y un xiaomi redmi 13: 869123456789045

**Flow del agente:**

1. `rim_parse_imeis_from_text({ text: "<el-mensaje-completo>" })`
   - Devuelve:
     ```
     {
       items: [
         { imei: "354123456789012", brand: "Apple", model: "iPhone 14 Pro", customerName: "Pedro Reyes" },
         { imei: "868234567890123", brand: "Samsung", model: "Galaxy S23", customerName: "Pedro Reyes" },
         { imei: "869123456789045", brand: "Xiaomi", model: "Redmi 13", customerName: "Pedro Reyes" }
       ]
     }
     ```

2. Por cada item, `rim_full_check_imei({ imei })` — para confirmar marca/modelo (la IA puede equivocarse) y verificar si están inscritos

3. **(Sheets append)** los 3 registros en la planilla, con `customerName: "Pedro Reyes"` en cada fila

4. Respuesta al cliente final con resumen

---

## Flow 4: Cliente B2B hace cierre semanal (sin que el cliente final esté presente)

**Input típico (vos al agente):**

> Generame el archivo SUBTEL de todos los imeis pendientes de esta semana

**Flow del agente:**

1. **(Sheets read)** lee la planilla con los IMEIs procesados durante la semana, filtrando los `status = "Pendiente de inscribir"`

2. Para cada uno, asegurarse de tener `brand` y `model` (re-llamar `rim_lookup_imei_brand` si faltan)

3. `rim_export_subtel_xlsx({ items, filename: "subtel-semana-X-mayo" })`

4. Agente te entrega el archivo XLSX listo para subir al laboratorio + actualiza el status de esos IMEIs en la planilla a `"Enviado a SUBTEL <fecha>"`.

---

## Reglas que el agente DEBE seguir (system prompt)

1. **Siempre `rim_full_check_imei` antes de cobrar** al cliente final. Si está inscrito, NO se le cobra (avisar pero no procesar).

2. **Confirmar con el cliente final antes de generar archivo SUBTEL**. Es una acción "final" que implica que esos IMEIs van al laboratorio. No improvisar.

3. **Loggear TODO en Sheets/Airtable**. Cada IMEI que pase por el agente debe quedar registrado, con:
   - Fecha
   - Cliente final
   - IMEI(s)
   - Marca / modelo
   - Estado en Chile (registrado / no)
   - Precio cotizado
   - Status del trámite (pendiente / cobrado / enviado a SUBTEL / inscrito)

4. **Si una tool tira error**, no reintentar más de 2 veces. Si sigue fallando, informar al cliente final que hubo un problema técnico y se va a procesar más tarde — no inventar el resultado.

5. **No exponer la API key** ni datos del backend RIM al cliente final. Si pregunta cosas técnicas, redirigir.

6. **Confidencialidad cruzada**: si tu cliente B2B atiende a varios clientes finales, no mezclar datos entre ellos. Cada conversación / chat debería estar aislada.
