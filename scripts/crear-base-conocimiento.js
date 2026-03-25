const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

console.log('🔧 Creando Base de Conocimiento Completa...\n');

// Leer CSV de Tiendanube
const csvContent = fs.readFileSync('archivos/tiendanube-78394-17742912284600117320926671510 (1).csv', 'latin1');
const tnData = parse(csvContent, { delimiter: ';', columns: true, skip_empty_lines: true });

// Leer manuales disponibles
const manualesDir = 'archivos/Manuales';
const manuales = {};

function scanManuales(dir, basePath = '') {
  const items = fs.readdirSync(dir);
  items.forEach(item => {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanManuales(fullPath, path.join(basePath, item));
    } else if (item.endsWith('.pdf')) {
      // Extraer nombre del producto del nombre del archivo
      const nombreLimpio = item
        .replace(/_Manual_.*$/i, '')
        .replace(/_manual_.*$/i, '')
        .replace(/manual.*$/i, '')
        .replace(/\.pdf$/i, '')
        .replace(/[-_]/g, ' ')
        .trim()
        .toUpperCase();
      
      if (!manuales[nombreLimpio]) {
        manuales[nombreLimpio] = [];
      }
      manuales[nombreLimpio].push({
        archivo: item,
        ruta: fullPath,
        marca: basePath || path.basename(dir)
      });
    }
  });
}

scanManuales(manualesDir);
console.log(`📚 Manuales encontrados: ${Object.keys(manuales).length} modelos`);

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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Función para detectar tipo de producto
function detectarTipo(nombre) {
  const upper = nombre.toUpperCase();
  
  if (upper.includes('BATERIA ELECTRONICA') || 
      upper.includes('BATERÍA ELECTRÓNICA') ||
      upper.includes('ELECTRONIC DRUM') ||
      upper.includes('MD200') ||
      upper.includes('MD200L') ||
      upper.includes('MD200 ULTRA') ||
      upper.includes('MD10') ||
      upper.includes('MD10L') ||
      (upper.includes('ED9') && !upper.includes('MED')) ||
      (upper.includes('ED8') && !upper.includes('MED')) ||
      (upper.includes('ED6') && !upper.includes('MED'))) {
    return 'Batería Electrónica';
  }
  
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
  
  if (upper.includes('INTERFACE') || 
      upper.includes('INTERFAZ') || 
      upper.includes('MINIFUSE') || 
      upper.includes('AUDIOFUSE') ||
      upper.includes('SCARLETT') ||
      (upper.includes('STUDIO') && upper.includes('2')) ||
      (upper.includes('STUDIO') && upper.includes('4'))) {
    return 'Interface de Audio';
  }
  
  if (upper.includes('SINTETIZADOR') || 
      upper.includes('MICROBRUTE') || 
      upper.includes('MINIBRUTE') || 
      upper.includes('POLYBRUTE') ||
      upper.includes('MICROFREAK') ||
      upper.includes('ASTROLAB') ||
      upper.includes('DRUMBRUTE')) {
    return 'Sintetizador';
  }
  
  if (upper.includes('AURICULAR') || 
      upper.includes('HEADPHONE') ||
      (upper.includes('HE ') && upper.includes('ALCTRON'))) {
    return 'Auriculares';
  }
  
  if (upper.includes('MICROFONO') || 
      upper.includes('MICRÓFONO') ||
      (upper.includes('UM') && upper.includes('ALCTRON'))) {
    return 'Micrófono';
  }
  
  return 'Otro';
}

// Función para extraer modelo del nombre
function extraerModelo(nombre) {
  const upper = nombre.toUpperCase();
  
  // Buscar patrones MD (ej: MD200, MD200L, MD200ULTRA, MD10L)
  const mdMatch = upper.match(/\b(MD\d+[A-Z]*)\b/);
  if (mdMatch) return mdMatch[1];
  
  // Buscar patrones ED (ej: ED6, ED8, ED9)
  const edMatch = upper.match(/\b(ED\d+)\b/);
  if (edMatch) return edMatch[1];
  
  // Buscar otros modelos comunes
  const modelos = [
    'MINILAB', 'KEYLAB', 'KEYSTEP', 'BEATSTEP', 'MICROBRUTE', 'MINIBRUTE',
    'MINIFUSE', 'AUDIOFUSE', 'MICROFREAK', 'ASTROLAB', 'DRUMBRUTE'
  ];
  
  for (const modelo of modelos) {
    if (upper.includes(modelo)) {
      return modelo;
    }
  }
  
  return null;
}

// Función para buscar manuales
function buscarManuales(nombre, tipo) {
  const upper = nombre.toUpperCase();
  const modelo = extraerModelo(nombre);
  const encontrados = [];
  
  // Buscar por modelo exacto
  if (modelo) {
    for (const [key, docs] of Object.entries(manuales)) {
      if (key.includes(modelo) || modelo.includes(key)) {
        encontrados.push(...docs);
      }
    }
  }
  
  // Buscar por palabras clave del nombre
  const palabrasClave = upper.split(' ').filter(p => p.length > 2);
  for (const [key, docs] of Object.entries(manuales)) {
    for (const palabra of palabrasClave) {
      if (key.includes(palabra) && !encontrados.some(e => e.archivo === docs[0].archivo)) {
        encontrados.push(...docs);
        break;
      }
    }
  }
  
  return encontrados;
}

// Crear base de conocimiento
const baseConocimiento = {
  meta: {
    fecha_generacion: new Date().toISOString(),
    total_productos: tnData.length,
    total_manuales: Object.values(manuales).flat().length,
    fuente: 'Tiendanube + Manuales PDF'
  },
  productos: [],
  manuales_disponibles: manuales,
  indice_por_modelo: {}
};

// Procesar productos
const productosProcesados = new Set();

tnData.forEach((producto) => {
  const nombre = producto.Nombre || '';
  const descHTML = producto['Descripción'] || '';
  const descLimpia = cleanHTML(descHTML);
  
  if (!nombre || !descLimpia) return;
  
  const tipo = detectarTipo(nombre);
  const modelo = extraerModelo(nombre);
  
  // Crear key para deduplicar
  let key;
  if (modelo) {
    key = modelo;
  } else {
    key = nombre.split(' ').slice(0, 3).join(' ').toLowerCase();
  }
  
  if (productosProcesados.has(key)) return;
  productosProcesados.add(key);
  
  // Buscar manuales
  const manualesProducto = buscarManuales(nombre, tipo);
  
  const productoEntry = {
    id: producto['Identificador de URL'] || '',
    nombre: nombre,
    modelo: modelo,
    tipo: tipo,
    marca: producto.Marca || '',
    descripcion: descLimpia,
    especificaciones: {
      conectividad: extraerConectividad(descLimpia),
      drivers: extraerDrivers(descLimpia),
      alimentacion: extraerAlimentacion(descLimpia),
      pads: extraerPads(descLimpia),
      parlantes: descLimpia.toLowerCase().includes('parlante') || descLimpia.toLowerCase().includes('speaker'),
      midi: descLimpia.toLowerCase().includes('midi'),
      usb: descLimpia.toLowerCase().includes('usb'),
      bluetooth: descLimpia.toLowerCase().includes('bluetooth')
    },
    manuales: manualesProducto,
    precio: producto.Precio || '',
    sku: producto.SKU || ''
  };
  
  baseConocimiento.productos.push(productoEntry);
  
  // Agregar al índice por modelo
  if (modelo) {
    if (!baseConocimiento.indice_por_modelo[modelo]) {
      baseConocimiento.indice_por_modelo[modelo] = [];
    }
    baseConocimiento.indice_por_modelo[modelo].push(productoEntry);
  }
});

// Funciones auxiliares
function extraerConectividad(desc) {
  const lower = desc.toLowerCase();
  const conectividad = [];
  if (lower.includes('usb')) conectividad.push('USB');
  if (lower.includes('bluetooth')) conectividad.push('Bluetooth');
  if (lower.includes('midi')) conectividad.push('MIDI');
  return conectividad;
}

function extraerDrivers(desc) {
  const lower = desc.toLowerCase();
  if (lower.includes('plug and play') || lower.includes('class compliant')) {
    return 'No requiere (Plug and Play)';
  } else if (lower.includes('driver') || lower.includes('control center')) {
    return 'Requiere instalación';
  }
  return 'No especificado';
}

function extraerAlimentacion(desc) {
  const lower = desc.toLowerCase();
  if (lower.includes('phantom') || lower.includes('48v')) return 'Phantom Power 48V';
  if (lower.includes('batería') || lower.includes('battery')) return 'A batería';
  if (lower.includes('usb')) return 'Alimentación USB';
  return 'No especificado';
}

function extraerPads(desc) {
  const match = desc.match(/(\d+)\s*pad/i);
  return match ? match[1] : null;
}

// Guardar base de conocimiento
fs.writeFileSync('data/base-conocimiento.json', JSON.stringify(baseConocimiento, null, 2));

console.log(`\n✅ Base de Conocimiento creada exitosamente`);
console.log(`📦 Productos únicos: ${baseConocimiento.productos.length}`);
console.log(`📚 Manuales vinculados: ${Object.values(manuales).flat().length}`);
console.log(`📑 Modelos indexados: ${Object.keys(baseConocimiento.indice_por_modelo).length}`);

console.log('\n📊 Distribución por tipo:');
const porTipo = {};
baseConocimiento.productos.forEach(p => {
  if (!porTipo[p.tipo]) porTipo[p.tipo] = 0;
  porTipo[p.tipo]++;
});
Object.entries(porTipo).forEach(([tipo, cantidad]) => {
  console.log(`  ${tipo}: ${cantidad}`);
});

console.log('\n📖 Manuales disponibles por marca:');
const porMarca = {};
Object.values(manuales).flat().forEach(m => {
  if (!porMarca[m.marca]) porMarca[m.marca] = 0;
  porMarca[m.marca]++;
});
Object.entries(porMarca).forEach(([marca, cantidad]) => {
  console.log(`  ${marca}: ${cantidad} manuales`);
});

console.log('\n💾 Archivo generado: data/base-conocimiento.json');
