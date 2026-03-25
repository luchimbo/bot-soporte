const XLSX = require('xlsx');
const fs = require('fs');

console.log('🤖 Generando FAQs automáticas para todos los productos...\n');

// Leer catálogo
const wb = XLSX.readFile('archivos/Productos.xlsx');
const products = XLSX.utils.sheet_to_json(wb.Sheets['Productos_1788_']);

// Templates de FAQs por tipo de producto
const faqTemplates = {
  'Controladores MIDI': {
    conexion: (modelo, marca) => ({
      pregunta: `¿El ${modelo} se conecta a PC?`,
      respuesta: `Sí, el ${modelo} se conecta a PC/Mac por USB y funciona plug-and-play. Es class-compliant, no requiere drivers adicionales. Solo conectás el cable USB y tu DAW lo reconoce automáticamente.`
    }),
    drivers: (modelo, marca) => ({
      pregunta: `¿El ${modelo} necesita drivers?`,
      respuesta: `No, el ${modelo} es class-compliant y no requiere drivers. Funciona plug-and-play en Windows 10/11 y macOS. Solo conectá y listo.`
    }),
    midi: (modelo, marca) => ({
      pregunta: `¿El ${modelo} envía MIDI?`,
      respuesta: `Sí, el ${modelo} es un controlador MIDI que envía datos por USB. Se conecta directo a tu DAW y podés controlar instrumentos virtuales, sintetizadores y más.`
    }),
    audio: (modelo, marca) => ({
      pregunta: `¿El ${modelo} transmite audio?`,
      respuesta: `No, el ${modelo} es un controlador MIDI puro. Envía datos de control (qué nota tocás, qué tan fuerte, etc.) pero no transmite audio. Para audio necesitás una interface de audio aparte.`
    }),
    parlantes: (modelo, marca) => ({
      pregunta: `¿El ${modelo} tiene parlantes?`,
      respuesta: `No, el ${modelo} no tiene parlantes integrados. Es un controlador MIDI, solo envía señales de control a tu PC. El audio sale por tu computadora, interface de audio o monitores externos.`
    }),
    daw: (modelo, marca) => ({
      pregunta: `¿Cómo configuro el ${modelo} en mi DAW?`,
      respuesta: `1) Conectá el ${modelo} por USB 2) Abrí tu DAW y andá a Preferencias/Configuración 3) En la sección MIDI seleccioná "${modelo}" como dispositivo de entrada 4) Asigná el controlador a un instrumento virtual y ya podés tocar.`
    })
  },
  
  'Interfaces de Audio': {
    conexion: (modelo, marca) => ({
      pregunta: `¿La ${modelo} se conecta por USB?`,
      respuesta: `Sí, la ${modelo} se conecta a PC/Mac por USB (generalmente USB-C). Sí requiere instalar los drivers específicos del fabricante para funcionar correctamente.`
    }),
    drivers: (modelo, marca) => ({
      pregunta: `¿La ${modelo} necesita drivers?`,
      respuesta: `Sí, la ${modelo} requiere instalar drivers específicos. Descargalos desde la web oficial del fabricante antes de conectarla.`
    }),
    audio: (modelo, marca) => ({
      pregunta: `¿La ${modelo} transmite audio por USB?`,
      respuesta: `Sí, la ${modelo} es una interfaz de audio que transmite audio digital por USB. Permite grabar micrófonos, instrumentos y escuchar el playback por monitores o auriculares.`
    }),
    phantom: (modelo, marca) => ({
      pregunta: `¿La ${modelo} tiene phantom power?`,
      respuesta: `Sí, la ${modelo} incluye alimentación phantom de 48V para micrófonos condensador. Activá el botón +48V en el canal que usás para el micrófono.`
    }),
    midi: (modelo, marca) => ({
      pregunta: `¿La ${modelo} tiene MIDI?`,
      respuesta: `Sí, la ${modelo} incluye conexiones MIDI IN/OUT además del audio. Esto permite conectar teclados MIDI, sintetizadores y otros equipos externos.`
    }),
    configuracion: (modelo, marca) => ({
      pregunta: `¿Cómo configuro la ${modelo} por primera vez?`,
      respuesta: `1) Descargá los drivers desde la web oficial 2) Instalá antes de conectar 3) Conectá la interface por USB 4) Abrí tu DAW y seleccioná ${modelo} como dispositivo de audio 5) Ajustá el sample rate y buffer size según tu PC.`
    })
  },
  
  'Baterías Electrónicas': {
    conexion: (modelo, marca) => ({
      pregunta: `¿La ${modelo} se conecta a PC?`,
      respuesta: `Sí, la ${modelo} se conecta a PC por USB para enviar MIDI. No requiere drivers, es plug-and-play. También podés usarla sin PC gracias al módulo de sonido integrado.`
    }),
    parlantes: (modelo, marca) => ({
      pregunta: `¿La ${modelo} tiene parlantes?`,
      respuesta: `Sí, la ${modelo} tiene parlantes integrados para practicar sin auriculares. También tiene salida para auriculares y salidas de línea para conectar a una consola o interface.`
    }),
    midi: (modelo, marca) => ({
      pregunta: `¿La ${modelo} envía MIDI?`,
      respuesta: `Sí, la ${modelo} envía MIDI por USB cuando la conectás a la PC. Podés grabar tus interpretaciones en un DAW o usar la batería para controlar baterías virtuales como Addictive Drums o EZdrummer.`
    }),
    usb: (modelo, marca) => ({
      pregunta: `¿La ${modelo} transmite audio por USB?`,
      respuesta: `No, la ${modelo} no transmite audio por USB, solo MIDI. El audio sale por los parlantes integrados, la salida de auriculares o las salidas de línea. Si querés grabar audio, necesitás micrófonos o una interface de audio aparte.`
    }),
    pads: (modelo, marca) => ({
      pregunta: `¿Los pads de la ${modelo} son sensibles?`,
      respuesta: `Sí, los pads de la ${modelo} son sensibles a la velocidad (tocás fuerte = suena fuerte). Podés ajustar la sensibilidad desde el módulo para adaptarla a tu forma de tocar.`
    }),
    doblepedal: (modelo, marca) => ({
      pregunta: `¿La ${modelo} soporta doble pedal?`,
      respuesta: `Sí, la ${modelo} soporta doble pedal. Conectá el segundo pedal al jack correspondiente y activá la función DUAL KICK en el menú de configuración del módulo.`
    })
  },
  
  'Sintetizadores': {
    conexion: (modelo, marca) => ({
      pregunta: `¿El ${modelo} se conecta a PC?`,
      respuesta: `Sí, el ${modelo} se conecta por USB para MIDI. Pero el audio no pasa por USB, sale por las salidas analógicas. Lo usás como teclado MIDI con tu DAW o como sinte standalone.`
    }),
    audio: (modelo, marca) => ({
      pregunta: `¿El ${modelo} transmite audio por USB?`,
      respuesta: `No, el ${modelo} no transmite audio por USB. El sonido del sinte sale por las salidas de línea (L/R). El USB es solo para MIDI y control.`
    }),
    parlantes: (modelo, marca) => ({
      pregunta: `¿El ${modelo} tiene parlantes?`,
      respuesta: `Depende del modelo. Algunos tienen parlantes integrados para practicar, otros no y necesitás conectar auriculares o monitores externos. Verificá las especificaciones de tu modelo específico.`
    }),
    drivers: (modelo, marca) => ({
      pregunta: `¿El ${modelo} necesita drivers?`,
      respuesta: `Para MIDI no, es class-compliant. Pero si querés usar el software editor o librerías de sonido específicas, sí necesitás instalar el software del fabricante.`
    })
  },
  
  'Micrófonos': {
    conexion: (modelo, marca) => ({
      pregunta: `¿El ${modelo} se conecta a PC?`,
      respuesta: (marca) => {
        if (modelo.includes('USB') || marca === 'Alctron') {
          return `Sí, el ${modelo} es un micrófono USB que se conecta directo a la PC. No necesitás interface de audio, solo conectar y seleccionarlo como entrada en tu software de grabación.`;
        } else {
          return `El ${modelo} se conecta con cable XLR. Necesitás una interface de audio con preamplificador de micrófono o una consola para usarlo con la PC.`;
        }
      }
    }),
    phantom: (modelo, marca) => ({
      pregunta: `¿El ${modelo} necesita phantom power?`,
      respuesta: (marca) => {
        if (modelo.includes('USB')) {
          return `No, el ${modelo} es USB y se alimenta por el mismo cable USB. No requiere phantom power.`;
        } else {
          return `Sí, el ${modelo} es un micrófono de condensador que requiere alimentación phantom de 48V. Activá el botón +48V en tu interface de audio.`;
        }
      }
    }),
    tipo: (modelo, marca) => ({
      pregunta: `¿El ${modelo} es de condensador o dinámico?`,
      respuesta: (marca) => {
        if (modelo.includes('USB')) {
          return `El ${modelo} es un micrófono de condensador con conexión USB, ideal para grabación de voz y podcasts.`;
        } else {
          return `Verificá las especificaciones específicas de tu modelo en la web del fabricante o en la caja del producto.`;
        }
      }
    })
  },
  
  'Auriculares': {
    conexion: (modelo, marca) => ({
      pregunta: `¿Los ${modelo} se conectan a PC?`,
      respuesta: `Sí, los ${modelo} se conectan con cable minijack 3.5mm a la salida de auriculares de tu PC o interface de audio. Son plug-and-play, no requieren drivers.`
    }),
    usb: (modelo, marca) => ({
      pregunta: `¿Los ${modelo} son USB o cable?`,
      respuesta: `Los ${modelo} se conectan por cable analógico (minijack 3.5mm), no por USB. Los conectás a la salida de auriculares de tu PC, celular o interface de audio.`
    }),
    drivers: (modelo, marca) => ({
      pregunta: `¿Los ${modelo} necesitan drivers?`,
      respuesta: `No, los ${modelo} son plug-and-play. Se conectan por cable y funcionan inmediatamente sin instalar nada.`
    }),
    cerrado: (modelo, marca) => ({
      pregunta: `¿Los ${modelo} son cerrados o abiertos?`,
      respuesta: `Los ${modelo} son auriculares cerrados (closed-back), ideales para monitoreo en estudio y grabación porque aíslan bien del ruido externo.`
    })
  }
};

// Función para detectar tipo de producto
function detectarTipo(nombre) {
  const upper = nombre.toUpperCase();
  
  if (upper.includes('CONTROLADOR') || upper.includes('MINILAB') || upper.includes('KEYLAB') || 
      upper.includes('KEYSTEP') || upper.includes('BEATSTEP') || upper.includes('LAUNCHKEY') ||
      upper.includes('OXYGEN') || upper.includes('MPK') || upper.includes('CODE')) {
    return 'Controladores MIDI';
  }
  
  if (upper.includes('INTERFACE') || upper.includes('INTERFAZ') || upper.includes('MINIFUSE') || 
      upper.includes('AUDIOFUSE') || upper.includes('SCARLETT') || upper.includes('STUDIO')) {
    return 'Interfaces de Audio';
  }
  
  if (upper.includes('BATERIA') || upper.includes('BATERÍA') || upper.includes(' ED6') || 
      upper.includes(' ED8') || upper.includes(' ED9') || upper.includes('MD200') || 
      upper.includes('ELECTRONIC DRUM')) {
    return 'Baterías Electrónicas';
  }
  
  if (upper.includes('SINTETIZADOR') || upper.includes('SINTE') || upper.includes('BRUTE') || 
      upper.includes('FREAK') || upper.includes('ASTROLAB') || upper.includes('MINILOGUE') ||
      upper.includes('POLYBRUTE') || upper.includes('MICROFREAK')) {
    return 'Sintetizadores';
  }
  
  if (upper.includes('MICROFONO') || upper.includes('MICRÓFONO') || upper.includes('MICROPHONE') || 
      upper.includes('UM900') || upper.includes('M588')) {
    return 'Micrófonos';
  }
  
  if (upper.includes('AURICULAR') || upper.includes('HEADPHONE') || upper.includes('HEADSET') || 
      upper.includes('HE ') || upper.includes('ATH-')) {
    return 'Auriculares';
  }
  
  return null;
}

// Función para extraer marca
function extraerMarca(nombre) {
  const upper = nombre.toUpperCase();
  if (upper.includes('ARTURIA')) return 'Arturia';
  if (upper.includes('MIDIPLUS')) return 'Midiplus';
  if (upper.includes('ALCTRON')) return 'Alctron';
  if (upper.includes('BEHRINGER')) return 'Behringer';
  if (upper.includes('FOCUSRITE')) return 'Focusrite';
  if (upper.includes('NOVATION')) return 'Novation';
  if (upper.includes('AKAI')) return 'Akai';
  return 'Otra';
}

// Función para extraer modelo
function extraerModelo(nombre) {
  // Patrones comunes
  const patrones = [
    /(MINILAB)\s*(3|MK2|MKII)?/i,
    /(KEYLAB)\s*(ESSENTIAL)?\s*(49|61|88)?/i,
    /(KEYSTEP)\s*(37|PRO)?/i,
    /(MINIFUSE)\s*(1|2|4)?/i,
    /(ED9?|ED8|ED6)\s*(PRO)?/i,
    /(MD200|MD10)/i,
    /(AKM\d+)/i,
    /(HE\d+)/i,
    /(UM\d+)/i,
    /(MICROBRUTE|MINIBRUTE|POLYBRUTE|MICROFREAK|ASTROLAB)/i
  ];
  
  for (const patron of patrones) {
    const match = nombre.match(patron);
    if (match) return match[0].trim();
  }
  
  // Extraer palabras significativas
  const palabras = nombre.split(/\s+/);
  return palabras.slice(0, 3).join(' ');
}

// Generar FAQs
const faqsGeneradas = [];
const productosProcesados = new Set();

products.forEach(p => {
  const tipo = detectarTipo(p.Nombre);
  if (!tipo) return; // Saltar productos no identificables
  
  const marca = extraerMarca(p.Nombre);
  const modelo = extraerModelo(p.Nombre);
  const key = `${marca}-${modelo}-${tipo}`;
  
  // Evitar duplicados
  if (productosProcesados.has(key)) return;
  productosProcesados.add(key);
  
  const templates = faqTemplates[tipo];
  if (!templates) return;
  
  // Generar FAQs para este producto
  Object.entries(templates).forEach(([categoria, templateFn]) => {
    const faq = templateFn(modelo, marca);
    if (typeof faq.respuesta === 'function') {
      faq.respuesta = faq.respuesta(marca);
    }
    
    faqsGeneradas.push({
      id: `faq_auto_${faqsGeneradas.length + 1}`,
      activo: true,
      marca: marca,
      producto: modelo,
      categoria: `faq_${categoria}`,
      tipo_producto: tipo,
      pregunta: faq.pregunta,
      respuesta_aprobada: faq.respuesta,
      palabras_clave: `${modelo.toLowerCase()},${categoria},${tipo.toLowerCase()}`,
      requiere_producto: true,
      confianza_minima: 0.7
    });
  });
});

console.log(`✅ FAQs generadas: ${faqsGeneradas.length}`);
console.log(`Productos únicos cubiertos: ${productosProcesados.size}`);

// Agrupar por tipo
const porTipo = {};
faqsGeneradas.forEach(f => {
  if (!porTipo[f.tipo_producto]) porTipo[f.tipo_producto] = 0;
  porTipo[f.tipo_producto]++;
});

console.log('\nDistribución:');
Object.entries(porTipo).forEach(([tipo, cantidad]) => {
  console.log(`  ${tipo}: ${cantidad} FAQs`);
});

// Guardar
const outputPath = 'data/faqs-automaticas.json';
fs.writeFileSync(outputPath, JSON.stringify(faqsGeneradas, null, 2));
console.log(`\n💾 Guardado en: ${outputPath}`);

// También crear versión para Excel
const wbOut = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(faqsGeneradas);
XLSX.utils.book_append_sheet(wbOut, ws, 'FAQs_Automaticas');
XLSX.writeFile(wbOut, 'archivos/SoporteBot_FAQs_Automaticas.xlsx');
console.log('📊 También exportado a: archivos/SoporteBot_FAQs_Automaticas.xlsx');
