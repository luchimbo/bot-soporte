const { parse } = require('csv-parse/sync');
const fs = require('fs');

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
  return null;
}

const csvContent = fs.readFileSync('archivos/tiendanube-78394-17742912284600117320926671510 (1).csv', 'latin1');
const tnData = parse(csvContent, { delimiter: ';', columns: true, skip_empty_lines: true });

const baterias = tnData.filter(p => {
  const nombre = p.Nombre || '';
  const tipo = detectarTipo(nombre);
  return tipo === 'Batería Electrónica';
});

console.log('Total baterías encontradas:', baterias.length);
console.log('\nPrimeras 20:');
baterias.slice(0, 20).forEach((p, i) => {
  const key = p.Nombre.split(' ').slice(0, 3).join(' ').toLowerCase();
  console.log((i+1) + '. ' + p.Nombre);
  console.log('   Key (para deduplicar): ' + key);
});

// Ver cuántas keys únicas hay
const keys = baterias.map(p => p.Nombre.split(' ').slice(0, 3).join(' ').toLowerCase());
const uniqueKeys = [...new Set(keys)];
console.log('\nTotal keys únicas:', uniqueKeys.length);
console.log('\nTodas las baterías MD:');
baterias.filter(p => p.Nombre.toUpperCase().includes('MD')).forEach((p, i) => {
  console.log((i+1) + '. ' + p.Nombre);
});
