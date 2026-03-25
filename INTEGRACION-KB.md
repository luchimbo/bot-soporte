# 🤖 Knowledge Base Integrada - Documentación Técnica

## 🎯 Resumen de la Integración

El webhook ahora tiene acceso completo a la **base de conocimiento** con:
- ✅ **590 productos** catalogados
- ✅ **69 manuales PDF** vinculados
- ✅ **278 FAQs** generadas automáticamente
- ✅ **Detección automática** de modelos (ED6, ED8, ED9, MD200ULTRA, etc.)

## 🔗 Endpoints Disponibles

### 1. Webhook Principal (WhatsApp)
```
POST /webhook
```
**Función:** Recibe mensajes de WhatsApp y responde automáticamente

**Nuevo:** Detecta modelos de baterías automáticamente:
- Si el cliente escribe "tengo una MD200ULTRA", el bot detecta el modelo
- Consulta la knowledge base en tiempo real
- Incluye la info del producto en el contexto de la conversación

### 2. Health Check
```
GET /health
```
**Función:** Verifica estado del servidor y bases de datos

### 3. Consultar Producto
```
GET /api/product/:modelo
```
**Ejemplos:**
- `/api/product/MD200ULTRA`
- `/api/product/ED9`
- `/api/product/ED8`

**Respuesta:**
```json
{
  "success": true,
  "producto": {
    "nombre": "Kit de Batería Electrónica MIDIPLUS MD200ULTRA",
    "modelo": "MD200ULTRA",
    "tipo": "Batería Electrónica",
    "conectividad": "USB + MIDI + Bluetooth",
    "requiere_drivers": "No especificado",
    "descripcion": "...",
    "manuales": [...],
    "tiene_manuales": true
  }
}
```

### 4. Listar Baterías
```
GET /api/baterias
```
**Respuesta:** Lista todas las baterías electrónicas con info básica

### 5. Búsqueda
```
GET /api/search?q=termino
```
**Ejemplo:** `/api/search?q=Minilab`

### 6. Simulación
```
POST /simulate
```
**Body:**
```json
{
  "text": "Hola, tengo una MD200ULTRA",
  "sessionId": "test-123"
}
```

## 🧠 Cómo Funciona la Detección

### Flujo del Webhook:

1. **Recibe mensaje** del cliente por WhatsApp
2. **Detecta modelo:** Busca patrones como MD200ULTRA, ED9, ED8, etc.
3. **Consulta KB:** Si encuentra modelo, busca en `base-conocimiento.json`
4. **Enriquece contexto:** Agrega la info del producto a la sesión
5. **Genera respuesta:** El bot usa toda esta info para responder

### Ejemplo de Conversación:

**Cliente:** "Hola, compré una MD200ULTRA y no sé cómo conectarla al PC"

**Bot (internamente):**
1. Detecta "MD200ULTRA"
2. Consulta KB → Obtiene info completa
3. Ve que tiene USB + MIDI + Bluetooth
4. Ve que tiene manuales disponibles
5. Genera respuesta personalizada

**Respuesta del Bot:**
```
¡Hola! Veo que tenés la MD200ULTRA. 

Esta batería se conecta por USB + MIDI + Bluetooth. 
Para conectarla a la PC:
1) Usá el cable USB incluido
2) Conectá al puerto USB de tu computadora
3) Windows/Mac la detectará automáticamente

También tiene manual disponible si necesitás más detalles.
¿Te funcionó?
```

## 📁 Archivos del Sistema

```
src/
├── server.js                    # Webhook modificado
├── product-kb-integration.js    # Nueva integración
├── knowledge-base.js            # Base de conocimiento existente (actualizado)
├── assistant.js                 # Lógica del bot (sin cambios)
└── ...

data/
├── base-conocimiento.json       # Base de datos de productos (590 items)
├── faqs-reales.json            # 278 FAQs generadas
└── knowledge-base.json         # Respuestas históricas

archivos/
└── Manuales/
    ├── Alctron/                # 11 manuales
    ├── Arturia/                # 37 manuales
    └── Midiplus/               # 21 manuales
```

## 🚀 Cómo Usar

### 1. Iniciar el Servidor
```bash
npm start
```

### 2. Probar la Integración
```bash
node scripts/test-integration.js
```

### 3. Probar un Producto Específico
```bash
curl http://localhost:3000/api/product/MD200ULTRA
```

### 4. Ver Todas las Baterías
```bash
curl http://localhost:3000/api/baterias
```

## 📝 Modelos Soportados

### Baterías Electrónicas:
- **ED Series:** ED6, ED8, ED9 PRO
- **MD Series:** MD200ULTRA, MD200L, MD10L, MD10D
- **Otras:** MP200, DD315, XD8

### Controladores MIDI:
- Arturia: MiniLab, KeyLab, KeyStep, BeatStep
- Midiplus: AKM320, AKM322, Origin62

### Interfaces de Audio:
- Arturia: MiniFuse (1, 2, 4), AudioFuse
- Midiplus: Studio 2, Studio 4, Studio M

### Sintetizadores:
- Arturia: MicroBrute, MiniBrute, MicroFreak, AstroLab
- Midiplus: S-Engine

## 🔄 Actualizar la Base de Datos

Si cambian los productos en Tiendanube o agregás manuales nuevos:

```bash
# 1. Regenerar desde Tiendanube
node scripts/crear-base-conocimiento.js

# 2. Regenerar FAQs
node scripts/generate-faqs-reales.js

# 3. Actualizar system prompt (opcional)
node scripts/update-system-prompt.js

# 4. Reiniciar servidor
npm restart
```

## 🎨 Personalizar Respuestas

Para modificar cómo responde el bot, editá:
- `src/product-kb-integration.js` - Formato de respuestas
- `docs/KAPSO-SYSTEM-PROMPT-FINAL.txt` - Prompt del sistema
- `src/assistant.js` - Lógica del bot (avanzado)

## 📊 Monitoreo

El servidor loguea:
```
[Webhook] Mensaje de 5491132002154: "Hola, tengo una MD200ULTRA..."
[KB] Modelo detectado: MD200ULTRA
[KB] Info encontrada para MD200ULTRA
[Mock] Respuesta a 5491132002154: "¡Hola! Veo que tenés la MD200ULTRA..."
```

## 🐛 Troubleshooting

### Problema: "Producto no encontrado"
**Solución:** Verificar que `data/base-conocimiento.json` exista:
```bash
ls -lh data/base-conocimiento.json
node scripts/crear-base-conocimiento.js
```

### Problema: Manuales no vinculados
**Solución:** Verificar que los PDF estén en `archivos/Manuales/`

### Problema: Detección no funciona
**Solución:** Agregar el modelo a la lista en `detectDrumModel()`:
```javascript
const models = [
  'MD200ULTRA', 'MD200L', 'MD10L', 'MD10D',
  'ED9', 'ED8', 'ED6',
  'TU_MODELO_NUEVO'  // <-- Agregar acá
];
```

## ✅ Checklist de Implementación

- [x] Base de conocimiento creada (590 productos)
- [x] Manuales vinculados (69 PDFs)
- [x] FAQs generadas (278)
- [x] Detección automática de modelos
- [x] API REST endpoints
- [x] Integración con webhook
- [x] Scripts de prueba
- [x] Documentación

## 🎯 Próximos Pasos Sugeridos

1. **Testear** con conversaciones reales
2. **Agregar** más manuales si faltan
3. **Mejorar** detección de modelos (usar IA)
4. **Agregar** fotos de productos
5. **Crear** videos de soporte
6. **Integrar** con sistema de tickets

---

**¿Necesitás que agregue alguna función específica o que revise algún producto?**
