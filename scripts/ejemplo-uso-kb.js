const {
  obtenerInfoProducto,
  listarBaterias,
  buscarProductoPorNombre,
  formatearRespuestaProducto
} = require('../src/knowledge-base');

console.log('🤖 EJEMPLO: Bot consultando Knowledge Base\n');
console.log('=' .repeat(60));

// Ejemplo 1: Cliente pregunta por MD200ULTRA
console.log('\n📝 Consulta: "Tengo una MD200ULTRA, ¿cómo se conecta?"');
console.log('-'.repeat(60));
const md200 = obtenerInfoProducto('MD200ULTRA');
if (md200) {
  console.log(`✅ Producto encontrado: ${md200.nombre}`);
  console.log(`🔌 Conectividad: ${md200.conectividad}`);
  console.log(`💿 Drivers: ${md200.requiere_drivers}`);
  console.log(`📚 Manuales: ${md200.tiene_manuales ? 'Sí' : 'No'}`);
  if (md200.tiene_manuales) {
    console.log(`   Archivos: ${md200.manuales.map(m => m.archivo).join(', ')}`);
  }
} else {
  console.log('❌ Producto no encontrado');
}

// Ejemplo 2: Cliente pregunta por ED9 PRO
console.log('\n📝 Consulta: "¿Qué diferencia hay entre ED9 y ED8?"');
console.log('-'.repeat(60));
const ed9 = obtenerInfoProducto('ED9');
const ed8 = obtenerInfoProducto('ED8');

if (ed9 && ed8) {
  console.log(`✅ ED9 PRO encontrado: ${ed9.nombre}`);
  console.log(`✅ ED8 encontrado: ${ed8.nombre}`);
  console.log(`\n📊 Comparación:`);
  console.log(`   ED9 PRO: ${ed9.descripcion.substring(0, 150)}...`);
  console.log(`   ED8: ${ed8.descripcion.substring(0, 150)}...`);
} else {
  console.log('⚠️  No se encontraron ambos modelos');
}

// Ejemplo 3: Listar todas las baterías disponibles
console.log('\n📝 Consulta: "¿Qué baterías electrónicas tienen?"');
console.log('-'.repeat(60));
const baterias = listarBaterias();
console.log(`✅ Encontradas ${baterias.length} baterías:`);
baterias.forEach((b, i) => {
  const manualStatus = b.tiene_manuales ? '✓' : '✗';
  console.log(`   ${i + 1}. ${b.modelo || 'Sin modelo'} - ${b.nombre.substring(0, 40)}... [Manual:${manualStatus}]`);
});

// Ejemplo 4: Búsqueda flexible
console.log('\n📝 Consulta: "Batería Midiplus"');
console.log('-'.repeat(60));
const resultados = buscarProductoPorNombre('Midiplus');
console.log(`✅ Encontrados ${resultados.length} productos Midiplus:`);
resultados.slice(0, 5).forEach((p, i) => {
  console.log(`   ${i + 1}. ${p.tipo}: ${p.nombre.substring(0, 50)}`);
});

// Ejemplo 5: Formatear respuesta completa
console.log('\n📝 Respuesta formateada para el cliente:');
console.log('-'.repeat(60));
const respuesta = formatearRespuestaProducto('MD200ULTRA');
if (respuesta) {
  console.log(respuesta);
}

console.log('\n' + '='.repeat(60));
console.log('✅ Knowledge Base lista para usar en el bot');
console.log('💾 Total productos cargados: 590');
console.log('📚 Total manuales vinculados: 69');
