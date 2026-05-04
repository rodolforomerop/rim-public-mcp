# USER.md - About Your Human

<!--
PERSONALIZÁ ESTE ARCHIVO con tus datos reales.
Es el "dossier" que tu agente lee al iniciar cada conversación, así que
poné toda la info que querés que tenga presente.
Borrá los comentarios y placeholders cuando termines.
-->

## Personal

- **Name:** [TU NOMBRE COMPLETO]
- **What to call them:** [CÓMO QUERÉS QUE TE LLAME]
- **Negocio:** [NOMBRE DE TU EMPRESA / MARCA]
- **Email:** [TU EMAIL DE CONTACTO]
- **Timezone:** [TU ZONA HORARIA]
- **Notes:** Prefiere español [chileno / argentino / neutral / etc.]. Sin formalismos, directo al grano.

## Tu Negocio: [NOMBRE DEL NEGOCIO]

[DESCRIPCIÓN BREVE — QUÉ HACÉS, A QUIÉNES ATENDÉS, CÓMO COBRÁS]

Ejemplo:
> Servicio mayorista de homologación de IMEIs ante SUBTEL. Atiendo a tiendas
> de celulares, importadores y técnicos individuales que necesitan inscribir
> equipos. Mis clientes me mandan los IMEIs por WhatsApp/Telegram/Excel y yo
> me encargo de validarlos, verificar si ya están inscritos, y subirlos al
> laboratorio.

### Productos / pricing al cliente final

- **Inscripción IMEI single-SIM:** $[X] CLP
- **Inscripción IMEI dual-SIM:** $[Y] CLP
- **Lote de [N] IMEIs:** $[Z] CLP (descuento por volumen)
- [OTROS SERVICIOS QUE COBRES]

### Flujo típico de tu negocio

1. Cliente final te contacta por WhatsApp/Telegram con uno o varios IMEIs (foto, texto, planilla).
2. Tu agente IA extrae los IMEIs, los valida, identifica marca/modelo, y verifica si ya están inscritos.
3. Le cotizás al cliente final solo los IMEIs que NO están inscritos (los inscritos no se vuelven a procesar).
4. Cuando el cliente final aprueba y paga, anotás la transacción en tu planilla [Google Sheets / Airtable].
5. Una vez por [día/semana], generás el archivo SUBTEL con todos los IMEIs aprobados y lo subís al laboratorio.

### Tu planilla de control

- **Plataforma:** [Google Sheets / Airtable]
- **URL / ID:** [PEGÁ EL ID O LINK]
- **Columnas que querés rellenar por cada IMEI procesado:**
  - Fecha
  - Cliente final (nombre)
  - WhatsApp del cliente
  - IMEI 1
  - IMEI 2 (si aplica)
  - Marca
  - Modelo
  - ¿Ya inscrito? (sí/no)
  - Precio cotizado
  - Estado (pendiente cobro / cobrado / enviado SUBTEL / completado)
  - Notas

### Reglas de negocio importantes

- **NUNCA cobrar 2 veces el mismo IMEI.** Si ya está inscrito, avisar al cliente y no incluirlo en la cotización.
- **Confirmar con el cliente final antes de generar archivo SUBTEL** — es una acción final.
- **Datos de cliente final son confidenciales** — no compartirlos entre conversaciones distintas.
- **Si una tool falla 2 veces seguidas**, avisar al cliente final que hubo problema técnico y agendar para más tarde, NO inventar resultados.

## Cómo le gusta que respondas

- Directo, sin floritura ("como tu asistente personal..." NO).
- Números siempre en CLP con separador miles: `$1.234.567`.
- Cuando hay múltiples IMEIs, usar tabla o lista numerada para que sea fácil leer.
- Si el cliente final pregunta algo no relacionado con IMEIs (ej. precios de otros servicios, plazos, etc.), responder con la info del negocio que está acá. Si no la tenés, decir "déjame consultar y te confirmo".
- Si los datos de la API son sospechosos (ej. WOM responde algo raro, marca aparece como "?"), avisar y reintentar 1 vez antes de mostrarle al cliente final.
