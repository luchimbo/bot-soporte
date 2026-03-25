# 🤖 Knowledge Base Completa - SoporteBot

## 📋 Resumen

Sistema de base de conocimiento que integra:
- ✅ **590 productos** con descripciones completas
- ✅ **69 manuales PDF** vinculados
- ✅ **Sistema de búsqueda** por modelo, nombre o tipo
- ✅ **Información técnica** (conectividad, drivers, especificaciones)

## 📁 Estructura de Archivos

```
data/
├── base-conocimiento.json          # Base de datos completa
├── faqs-reales.json               # FAQs generadas
└── knowledge-base.json            # Respuestas históricas (existente)

archivos/
├── Manuales/
│   ├── Alctron/                   # 11 manuales
│   ├── Arturia/                   # 37 manuales
│   └── Midiplus/                  # 21 manuales
└── FAQs_Reales_Tiendanube.xlsx   # Excel para revisión

src/
├── knowledge-base.js              # Sistema de búsqueda (actualizado)
└── ...

scripts/
├── crear-base-conocimiento.js     # Genera la base de datos
├── generate-faqs-reales.js        # Genera FAQs
├── update-system-prompt.js        # Actualiza system prompt
└── ejemplo-uso-kb.js             # Ejemplos de uso
```

## 🎯 Modelos de Baterías Cubiertos

### Series ED (Electronic Drum):
- ✅ ED6
- ✅ ED8
- ✅ ED9 PRO

### Series MD (MIDI Drum):
- ✅ MD200ULTRA
- ✅ MD200L
- ✅ MD10L
- ✅ MD10D

### Otras:
- ✅ MP200 (Octapad)
- ✅ Medeli DD315
- ✅ BEHRINGER XD8

## 🔧 Uso en el Bot

### 1. Buscar información de un producto

```javascript
const { obtenerInfoProducto } = require('./src/knowledge-base');

const info = obtenerInfoProducto('MD200ULTRA');
if (info) {
  console.log(info.nombre);        // "Kit de Batería Electrónica MIDIPLUS MD200ULTRA"
  console.log(info.conectividad);  // "USB + MIDI + Bluetooth"
  console.log(info.requiere_drivers); // "No especificado"
  console.log(info.tiene_manuales);   // true
}
```

### 2. Responder consulta del cliente

```javascript
const { formatearRespuestaProducto } = require('./src/knowledge-base');

// Cliente: "Tengo una MD200ULTRA, ¿cómo se conecta?"
const respuesta = formatearRespuestaProducto('MD200ULTRA');
// Devuelve texto formateado con toda la info del producto
```

### 3. Buscar productos por nombre

```javascript
const { buscarProductoPorNombre } = require('./src/knowledge-base');

const resultados = buscarProductoPorNombre('Minilab');
// Devuelve array con todos los productos que coinciden
```

### 4. Listar baterías disponibles

```javascript
const { listarBaterias } = require('./src/knowledge-base');

const baterias = listarBaterias();
// Devuelve array con: modelo, nombre, conectividad, tiene_manuales
```

## 📊 Ejemplos de Respuestas

### Consulta: "MD200ULTRA"
```
📦 Kit de Batería Electrónica MIDIPLUS MD200ULTRA

📝 Descripción: El MIDIPLUS MD200ULTRA es un kit de batería electrónica 
profesional con 5 cuerpos de malla y 4 platillos...

🔌 Conectividad: USB + MIDI + Bluetooth
💿 Drivers: No especificado

📚 Manuales disponibles:
1. 200ULTRA.pdf
2. MIDIPLUS_Manual_AK490+_EN_V1.1.pdf
...
```

### Consulta: "ED9"
```
📦 PREVENTA Batería Electrónica MIDIPLUS ED9 PRO

🔌 Conectividad: USB + MIDI
💿 Drivers: No requiere (Plug and Play)

📚 Manuales disponibles:
1. MIDIPLUS_Manual_ED-9_Pro(Z12K)_EN_V0.2.pdf
```

## 🔍 Funciones Disponibles

| Función | Descripción |
|---------|-------------|
| `obtenerInfoProducto(modelo)` | Info completa de un producto por modelo |
| `buscarProductoPorModelo(modelo)` | Busca por modelo exacto |
| `buscarProductoPorNombre(termino)` | Búsqueda flexible por nombre |
| `listarBaterias()` | Lista todas las baterías |
| `obtenerManuales(modelo)` | Obtiene manuales de un producto |
| `formatearRespuestaProducto(modelo)` | Formatea respuesta para el cliente |
| `busquedaCompleta(query)` | Busca en productos + docs históricos |

## 📝 Datos por Producto

Cada producto incluye:
- **Nombre completo**
- **Modelo** (ED9, MD200ULTRA, etc.)
- **Tipo** (Batería, Controlador, etc.)
- **Marca**
- **Descripción completa** (de Tiendanube)
- **Especificaciones**:
  - Conectividad (USB, MIDI, Bluetooth)
  - Requiere drivers
  - Alimentación
  - Cantidad de pads
  - Parlantes integrados
- **Manuales PDF** vinculados
- **SKU** y precio

## 🔄 Actualización

Para regenerar la base de conocimiento:

```bash
# 1. Regenerar desde Tiendanube
node scripts/crear-base-conocimiento.js

# 2. Regenerar FAQs
node scripts/generate-faqs-reales.js

# 3. Actualizar system prompt
node scripts/update-system-prompt.js
```

## ⚠️ Notas Importantes

1. **Manuales**: Los PDF están en `archivos/Manuales/` y se vinculan automáticamente
2. **Modelos**: Se detectan automáticamente del nombre del producto
3. **Búsqueda**: No distingue mayúsculas/minúsculas ni acentos
4. **Respuestas**: Incluyen descripciones completas sin cortar
5. **Historial**: Se integra con el sistema de respuestas históricas existente

## 📈 Estadísticas

- **590 productos** únicos
- **69 manuales** PDF vinculados
- **278 FAQs** generadas
- **19 modelos** indexados
- **22 baterías electrónicas** catalogadas
- **3 marcas** con manuales (Arturia, Midiplus, Alctron)

## 🎯 Próximos Pasos

1. **Testear** el sistema con consultas reales
2. **Agregar** más manuales si faltan
3. **Mejorar** la extracción de especificaciones
4. **Crear** índice de búsqueda más rápido (si se necesita)
5. **Integrar** con el flujo del bot en Kapso

---

**¿Necesitás que agregue alguna función específica o que revise algún producto en particular?**
