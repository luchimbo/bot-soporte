const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

console.log('📚 Generando FAQs basadas ÚNICAMENTE en descripciones reales de productos...\n');

// Leer archivo de tiendanube (descripciones reales) - formato CSV con separador ;
const tnFile = 'archivos/tiendanube-78394-17742912284600117320926671510 (1).csv';
const csvContent = fs.readFileSync(tnFile, 'latin1'); // Usar latin1 para caracteres especiales

// Parsear CSV con la librería adecuada
const tnData = parse(csvContent, {
  delimiter: ';',
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true
});

console.log(`✅ Productos cargados: ${tnData.length}`);

// Verificar columnas disponibles
const sampleProduct = tnData[0];
console.log('\nColumnas disponibles:', Object.keys(sampleProduct).slice(0, 10).join(', '), '...');
console.log('Columna Descripción existe:', 'Descripci�n' in sampleProduct || 'DescripciÃ³n' in sampleProduct || 'Descripción' in sampleProduct);

// Función para limpiar HTML
function cleanHTML(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Función para extraer nombre de producto con modelo
function extraerNombreProducto(nombre) {
  const upper = nombre.toUpperCase();
  const words = nombre.split(' ');
  
  // Para productos MD/ED, incluir el modelo en el nombre
  if (upper.includes('MD200') || upper.includes('MD10') || 
      upper.includes('ED6') || upper.includes('ED8') || upper.includes('ED9')) {
    // Buscar la posición del modelo y tomar hasta ahí + 1 palabra
    for (let i = 0; i < words.length; i++) {
      const wordUpper = words[i].toUpperCase();
      if (wordUpper.includes('MD200') || wordUpper.includes('MD10') ||
          wordUpper.includes('ED6') || wordUpper.includes('ED8') || wordUpper.includes('ED9')) {
        return words.slice(0, i + 1).join(' ');
      }
    }
  }
  
  // Para otros productos, usar primeras 4 palabras
  return words.slice(0, 4).join(' ');
}

// Función para extraer información técnica de la descripción
function extraerInfoTecnica(descLimpia, nombre) {
  const info = {
    conectividad: '',
    drivers: '',
    alimentacion: '',
    incluye: '',
    caracteristicas: [],
    compatibilidad: '',
    pads: '',
    parlantes: '',
    salidas: ''
  };
  
  const lower = descLimpia.toLowerCase();
  const upper = nombre.toUpperCase();
  
  // Buscar conectividad
  if (lower.includes('usb')) {
    info.conectividad = 'USB';
  }
  if (lower.includes('bluetooth')) {
    info.conectividad += (info.conectividad ? ' + ' : '') + 'Bluetooth';
  }
  if (lower.includes('midi')) {
    info.conectividad += (info.conectividad ? ' + ' : '') + 'MIDI';
  }
  
  // Buscar drivers
  if (lower.includes('driver') || lower.includes('control center')) {
    info.drivers = 'Requiere drivers';
  } else if (lower.includes('plug and play') || lower.includes('plug-and-play') || lower.includes('class compliant')) {
    info.drivers = 'No requiere drivers (plug and play)';
  }
  
  // Buscar alimentación phantom
  if (lower.includes('phantom') || lower.includes('48v')) {
    info.alimentacion = 'Phantom power 48V';
  }
  
  // Buscar pads (para baterías)
  if (lower.includes('pad')) {
    const padMatch = descLimpia.match(/(\d+)\s*pad/i);
    if (padMatch) {
      info.pads = padMatch[1] + ' pads';
    } else {
      info.pads = 'Incluye pads';
    }
  }
  
  // Buscar parlantes
  if (lower.includes('parlante') || lower.includes('speaker')) {
    info.parlantes = 'Tiene parlantes integrados';
  }
  
  // Buscar salidas
  if (lower.includes('salida') || lower.includes('output')) {
    info.salidas = 'Tiene salidas de audio';
  }
  
  // Buscar incluye
  const incluyeMatch = descLimpia.match(/incluye[,:\s]*([^\.]+)/i);
  if (incluyeMatch) {
    info.incluye = incluyeMatch[1].trim();
  }
  
  return info;
}

// Función para determinar tipo de producto basado en nombre real
function detectarTipo(nombre) {
  const upper = nombre.toUpperCase();
  
  // Baterías electrónicas (solo si tienen estas palabras específicas)
  if (upper.includes('BATERIA ELECTRONICA') || 
      upper.includes('BATERÍA ELECTRÓNICA') ||
      upper.includes('ELECTRONIC DRUM') ||
      // Series MD de Midiplus
      upper.includes('MD200') ||
      upper.includes('MD200L') ||
      upper.includes('MD200 ULTRA') ||
      upper.includes('MD10') ||
      upper.includes('MD10L') ||
      // ED series de Midiplus - detectar cualquier ED seguido de número, pero no MED (que es otra cosa)
      (upper.includes('ED9') && !upper.includes('MED')) ||
      (upper.includes('ED8') && !upper.includes('MED')) ||
      (upper.includes('ED6') && !upper.includes('MED'))) {
    return 'Batería Electrónica';
  }
  
  // Controladores MIDI
  if (upper.includes('CONTROLADOR MIDI') || 
      upper.includes('MINILAB') || 
      upper.includes('KEYLAB') || 
      upper.includes('KEYSTEP') ||
      upper.includes('BEATSTEP') ||
      upper.includes('LAUNCHKEY') ||
      upper.includes('OXYGEN') ||
      (upper.includes('MPK') && upper.includes('MINI'))) {
    return 'Controlador MIDI';
  }
  
  // Interfaces de audio
  if (upper.includes('INTERFACE') || 
      upper.includes('INTERFAZ') || 
      upper.includes('MINIFUSE') || 
      upper.includes('AUDIOFUSE') ||
      upper.includes('SCARLETT') ||
      (upper.includes('STUDIO') && upper.includes('2')) ||
      (upper.includes('STUDIO') && upper.includes('4'))) {
    return 'Interface de Audio';
  }
  
  // Sintetizadores
  if (upper.includes('SINTETIZADOR') || 
      upper.includes('MICROBRUTE') || 
      upper.includes('MINIBRUTE') || 
      upper.includes('POLYBRUTE') ||
      upper.includes('MICROFREAK') ||
      upper.includes('ASTROLAB') ||
      upper.includes('DRUMBRUTE')) {
    return 'Sintetizador';
  }
  
  // Auriculares
  if (upper.includes('AURICULAR') || 
      upper.includes('HEADPHONE') ||
      (upper.includes('HE ') && upper.includes('ALCTRON'))) {
    return 'Auriculares';
  }
  
  // Micrófonos
  if (upper.includes('MICROFONO') || 
      upper.includes('MICRÓFONO') ||
      (upper.includes('UM') && upper.includes('ALCTRON'))) {
    return 'Micrófono';
  }
  
  return null;
}

// Generar FAQs basadas en información REAL
const faqsReales = [];
const productosProcesados = new Set();

// Procesar cada producto de tiendanube
tnData.forEach((producto, index) => {
  // Los nombres de columna
  const nombre = producto.Nombre || '';
  const descHTML = producto['Descripción'] || '';
  const descLimpia = cleanHTML(descHTML);
  
  // Debug: mostrar primeros productos
  if (index < 3) {
    console.log(`\nProducto ${index}: ${nombre.substring(0, 50)}...`);
    console.log(`  Descripción: ${descHTML ? 'SÍ tiene (' + descHTML.length + ' chars)' : 'NO tiene'}`);
    if (descHTML) {
      console.log(`  Primeros 100 chars: ${descLimpia.substring(0, 100)}...`);
    }
  }
  
  if (!nombre || !descLimpia) return;
  
  const tipo = detectarTipo(nombre);
  if (!tipo) return; // Solo procesar productos identificables
  
  // Evitar duplicados (por nombre similar)
  // Para productos como "Kit de Batería Electrónica MIDIPLUS MD200ULTRA" 
  // necesitamos incluir el modelo en la key
  let key;
  const upperNombre = nombre.toUpperCase();
  if (upperNombre.includes('MD200') || upperNombre.includes('MD10') || 
      upperNombre.includes('ED6') || upperNombre.includes('ED8') || upperNombre.includes('ED9')) {
    // Para baterías MD/ED, usar más palabras para capturar el modelo
    key = nombre.split(' ').slice(0, 6).join(' ').toLowerCase();
  } else {
    key = nombre.split(' ').slice(0, 3).join(' ').toLowerCase();
  }
  if (productosProcesados.has(key)) return;
  productosProcesados.add(key);
  
  const info = extraerInfoTecnica(descLimpia, nombre);
  
  const nombreProducto = extraerNombreProducto(nombre);
  
  // Solo crear FAQs si tenemos información real
  if (info.conectividad) {
    faqsReales.push({
      categoria: 'Conectividad',
      tipo: tipo,
      producto: nombreProducto,
      pregunta: `¿El ${nombreProducto} se conecta por ${info.conectividad.includes('USB') ? 'USB' : info.conectividad}?`,
      respuesta: `Sí, según la información del producto, se conecta vía ${info.conectividad}. ${descLimpia}`
    });
  }
  
  if (info.drivers) {
    faqsReales.push({
      categoria: 'Drivers',
      tipo: tipo,
      producto: nombreProducto,
      pregunta: `¿El ${nombreProducto} necesita drivers?`,
      respuesta: `${info.drivers}. ${descLimpia}`
    });
  }
  
  if (info.alimentacion) {
    faqsReales.push({
      categoria: 'Alimentación',
      tipo: tipo,
      producto: nombreProducto,
      pregunta: `¿El ${nombreProducto} tiene ${info.alimentacion}?`,
      respuesta: `Sí, incluye ${info.alimentacion} según las especificaciones. ${descLimpia}`
    });
  }
  
  // FAQs específicas para series ED de Midiplus
  if (upperNombre.includes('MIDIPLUS') && (upperNombre.includes('ED6') || upperNombre.includes('ED8') || upperNombre.includes('ED9'))) {
    // FAQ sobre qué es ED
    if (!faqsReales.some(f => f.pregunta.includes('que significa ED') && f.tipo === 'Batería Electrónica')) {
      faqsReales.push({
        categoria: 'Información General',
        tipo: 'Batería Electrónica',
        producto: 'Serie ED Midiplus',
        pregunta: '¿Qué significa ED en las baterías Midiplus?',
        respuesta: 'ED es la sigla de "Electronic Drum" (Batería Electrónica). Es la línea de baterías electrónicas de Midiplus que incluye los modelos ED6, ED8 y ED9 PRO. Cada modelo ofrece diferentes características y tamaños de pads según las necesidades del baterista.'
      });
    }
    
    // FAQ sobre diferencias entre modelos ED
    if (descLimpia.toLowerCase().includes('diferencia') && (upperNombre.includes('ED9') || upperNombre.includes('ED8'))) {
      faqsReales.push({
        categoria: 'Comparación',
        tipo: 'Batería Electrónica',
        producto: nombreProducto,
        pregunta: `¿Cuáles son las diferencias entre la ${nombre.includes('ED9') ? 'ED9 PRO y ED8' : 'ED8 y otros modelos'}?`,
        respuesta: `Según la descripción del producto: ${descLimpia}`
      });
    }
  }
  
  if (info.parlantes) {
    faqsReales.push({
      categoria: 'Audio',
      tipo: tipo,
      producto: nombreProducto,
      pregunta: `¿El ${nombreProducto} tiene parlantes integrados?`,
      respuesta: `Sí, ${info.parlantes}. ${descLimpia}`
    });
  }
});

console.log(`\n✅ FAQs generadas basadas en descripciones reales: ${faqsReales.length}`);
console.log(`Productos únicos analizados: ${productosProcesados.size}`);

// Agrupar por tipo
const porTipo = {};
faqsReales.forEach(f => {
  if (!porTipo[f.tipo]) porTipo[f.tipo] = [];
  porTipo[f.tipo].push(f);
});

console.log('\nDistribución por tipo:');
Object.entries(porTipo).forEach(([tipo, lista]) => {
  console.log(`  ${tipo}: ${lista.length} FAQs`);
});

// Guardar
fs.writeFileSync('data/faqs-reales.json', JSON.stringify(faqsReales, null, 2));

// Crear Excel
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(faqsReales);
XLSX.utils.book_append_sheet(wb, ws, 'FAQs_Reales');
XLSX.writeFile(wb, 'archivos/FAQs_Reales_Tiendanube.xlsx');

console.log('\n💾 Archivos generados:');
console.log('  - data/faqs-reales.json');
console.log('  - archivos/FAQs_Reales_Tiendanube.xlsx');
