# RIM Public MCP Server

MCP server que conecta tu agente OpenClaw con la API de **Registro IMEI Multibanda Chile (RIM)**. Permite a tu bot validar IMEIs, identificar marca/modelo, verificar si están homologados ante SUBTEL, parsear fotos/textos/listas, y generar el archivo Excel oficial para subir al laboratorio.

## Qué hace

Tu agente OpenClaw recibe IMEIs por **WhatsApp/Telegram/Slack/etc.** en cualquier formato:

- 📸 **Foto** de la caja del celular o pantalla `*#06#`
- 💬 **Texto** natural ("te paso 3 imeis del cliente Juan...")
- 📊 **Excel/CSV** copy-paste o adjunto
- 📝 **Lista pegada** de IMEIs sueltos

Y el agente puede:

1. Extraer los IMEIs de cualquiera de esos formatos (con IA)
2. Validar que cada uno sea correcto (Luhn checksum)
3. Identificar marca y modelo automáticamente
4. Verificar si ya está inscrito en Chile (no cobrar 2 veces)
5. Detectar duplicados en lotes grandes
6. Generar el archivo Excel exacto que pide SUBTEL

## Pre-requisitos

- VPS con Linux (recomendado Ubuntu 22.04+)
- Node.js 18+ instalado
- OpenClaw 2026.4+ corriendo (con bot de Telegram/Discord/etc. ya emparejado)
- **API key `rim_live_*`** que te entregó RIM por DM

## Setup paso a paso

### 1) Verificá Node 18+

```bash
node --version
```

Si es menor a 18:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2) Cloná el repo

```bash
cd ~
git clone <URL_DEL_REPO_QUE_TE_PASA_RIM> rim-mcp
cd rim-mcp/mcp-server-rim-public
```

### 3) Instalá dependencias y compilá

```bash
npm install
npm run build
ls -la dist/   # debería existir dist/index.js
```

### 4) Test sanity check (sin OpenClaw todavía)

```bash
RIM_API_BASE=https://registroimeimultibanda.cl \
RIM_PUBLIC_API_KEY=rim_live_TU_KEY_AQUI \
node dist/index.js
```

Te queda esperando input por stdin. Pegá esto y dale Enter:

```
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

Deberías ver un JSON con las **8 tools** listadas (`rim_full_check_imei`, `rim_validate_imei`, etc.). Si las ves, todo bien.

Probá una llamada real con un IMEI que conozcas:

```
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"rim_full_check_imei","arguments":{"imei":"359381234567890"}}}
```

Te debería devolver un JSON consolidado con `validation`, `device`, `multibanda` y un `summary`.

**Ctrl+C** para cerrar.

### 5) Registrá el MCP server en OpenClaw

```bash
RIM_KEY="rim_live_TU_KEY_AQUI"

openclaw mcp set rim "{\"command\":\"node\",\"args\":[\"$HOME/rim-mcp/mcp-server-rim-public/dist/index.js\"],\"env\":{\"RIM_API_BASE\":\"https://registroimeimultibanda.cl\",\"RIM_PUBLIC_API_KEY\":\"$RIM_KEY\"}}"
```

Verificá que quedó:

```bash
openclaw mcp list
openclaw mcp show
```

### 6) Cargá el system prompt en tu agente

En el repo, dentro de `workspace-templates/`, hay 3 archivos para personalizar:

- `IDENTITY.md` — quién es tu agente (su nombre, "vibe")
- `USER.md` — datos de tu negocio (TENÉS QUE EDITARLO con tus datos)
- `TOOLS.md` — flujo de trabajo + integración con Google Sheets/Airtable

**Editá `USER.md`** con tu información real (negocio, productos, precios, cómo cobrás a tu cliente final). Después copiá los 3 al workspace de tu agente:

```bash
# Backup del workspace existente
cp ~/.openclaw/workspace/IDENTITY.md ~/.openclaw/workspace/IDENTITY.md.bak 2>/dev/null
cp ~/.openclaw/workspace/USER.md ~/.openclaw/workspace/USER.md.bak 2>/dev/null
cp ~/.openclaw/workspace/TOOLS.md ~/.openclaw/workspace/TOOLS.md.bak 2>/dev/null

# Copiar los nuevos (después de editar USER.md)
cp workspace-templates/IDENTITY.md ~/.openclaw/workspace/
cp workspace-templates/USER.md   ~/.openclaw/workspace/
cp workspace-templates/TOOLS.md  ~/.openclaw/workspace/
```

### 7) Sumá un MCP de Google Sheets o Airtable (opcional pero recomendado)

Si querés que tu agente automáticamente registre cada IMEI procesado en una planilla:

**Para Google Sheets:**

```bash
# Ejemplo con un MCP de Google Sheets popular
openclaw plugins install <NOMBRE_DEL_PLUGIN_SHEETS>
# Configurá las credenciales según indique ese plugin
```

**Para Airtable:**

```bash
openclaw plugins install <NOMBRE_DEL_PLUGIN_AIRTABLE>
# Cargá tu API key de Airtable
```

Cuando tengas el MCP de Sheets/Airtable instalado, editá `~/.openclaw/workspace/TOOLS.md` para que el agente sepa **a qué Sheet appendar y con qué columnas**. Hay un placeholder en el TOOLS.md que vino en este repo.

### 8) Reiniciá OpenClaw

```bash
systemctl --user restart openclaw-gateway
sleep 3
systemctl --user status openclaw-gateway --no-pager | head -5
```

Tiene que aparecer `active (running)`.

### 9) Probá end-to-end desde tu chat

Mandale al bot un IMEI por Telegram:

> Verificame este imei: 359381234567890

Tu agente debería:

1. Llamar `rim_full_check_imei`
2. Devolverte: validez (Luhn), marca/modelo, y si está inscrito en Chile

Si todo bien, listo. Si no responde o tira error, mirá los logs:

```bash
journalctl --user -u openclaw-gateway --since "5 minutes ago" --no-pager | tail -50
```

## Updates

Cuando RIM publique tools nuevas o mejoras:

```bash
cd ~/rim-mcp
git pull
cd mcp-server-rim-public
npm install   # solo si cambiaron dependencias
npm run build
systemctl --user restart openclaw-gateway
```

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| El bot no responde | Gateway caído | `systemctl --user status openclaw-gateway` y mirar logs |
| `HTTP 401: invalid_api_key` | RIM_PUBLIC_API_KEY mal pegada | Verificá que la env del MCP coincida con la key que te dieron |
| `HTTP 503: service_unavailable` (en check-multibanda) | API de WOM caída temporalmente | Reintentar en 1-2 min |
| `HTTP 429: rate_limit_exceeded` | Excediste tu cuota mensual | Contactar a RIM para subir el plan |
| El agente no usa las tools | Falta system prompt o el LLM no las "ve" | Verificar que copiaste TOOLS.md al workspace + restart |
| Imágenes no se procesan | Imagen muy grande (>10 MB) o URL no pública | Bajar resolución, o subir a Drive y pasarlo público |

## Costos

Cada call al MCP server termina siendo **una call a la API de RIM** que se factura según tu plan. Las tools que disparan **múltiples** calls:

- `rim_full_check_imei` → **3 calls** (validate + lookup + check_multibanda)
- Las demás → 1 call cada una

Para 3.000 IMEIs/mes con flujo típico (parse → full_check → export): ~9.000 + 30 = ~9.030 calls/mes.

## Soporte

- Bug en alguna tool / endpoint caído → contactá a RIM
- Cómo personalizar el agente → ver `EXAMPLE-FLOWS.md` para casos típicos
- Cómo integrar con Sheets/Airtable → consultá la doc del plugin específico que elegiste
