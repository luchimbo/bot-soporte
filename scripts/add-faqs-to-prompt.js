const fs = require('fs');

// Leer FAQs generadas
const faqs = JSON.parse(fs.readFileSync('data/faqs-reales.json', 'utf8'));

// Agrupar por tipo
const porTipo = {};
faqs.forEach(f => {
  if (!porTipo[f.tipo]) porTipo[f.tipo] = [];
  porTipo[f.tipo].push(f);
});

// Crear contenido para el system prompt
let output = '\n────────────────────────────────────────\n';
output += 'BASE DE CONOCIMIENTO - FAQs POR PRODUCTO (Basadas en descripciones reales)\n';
output += '────────────────────────────────────────\n';
output += 'Usá esta información EXCLUSIVAMENTE cuando el cliente confirme el modelo exacto.\n';
output += 'NO uses esta info si el cliente dice "mi batería" sin especificar el modelo.\n\n';

Object.entries(porTipo).forEach(([tipo, lista]) => {
  output += `\\n### ${tipo.toUpperCase()} (${lista.length} FAQs)\\n\\n`;
  
  // Agrupar por producto para no repetir
  const porProducto = {};
  lista.forEach(f => {
    if (!porProducto[f.producto]) porProducto[f.producto] = [];
    porProducto[f.producto].push(f);
  });
  
  Object.entries(porProducto).forEach(([producto, faqsProducto]) => {
    output += `**${producto}**\\n`;
    faqsProducto.slice(0, 3).forEach(f => { // Max 3 FAQs por producto para no saturar
      output += `- ${f.pregunta}\\n`;
      output += `  ${f.respuesta.substring(0, 200)}${f.respuesta.length > 200 ? '...' : ''}\\n`;
    });
    if (faqsProducto.length > 3) {
      output += `  (y ${faqsProducto.length - 3} preguntas más sobre este producto)\\n`;
    }
    output += '\\n';
  });
});

output += `\\n────────────────────────────────────────\\n`;
output += `TOTAL: ${faqs.length} FAQs basadas en descripciones reales de productos\\n`;
output += `────────────────────────────────────────\\n`;

// Agregar al final del system prompt
const systemPrompt = fs.readFileSync('docs/KAPSO-SYSTEM-PROMPT-FINAL.txt', 'utf8');

// Verificar si ya tiene la sección de FAQs
if (!systemPrompt.includes('BASE DE CONOCIMIENTO - FAQs')) {
  fs.writeFileSync('docs/KAPSO-SYSTEM-PROMPT-FINAL.txt', systemPrompt + output);
  console.log('✅ FAQs agregadas al system prompt');
  console.log(`📊 Total FAQs incluidas: ${faqs.length}`);
  console.log(`📁 Archivo actualizado: docs/KAPSO-SYSTEM-PROMPT-FINAL.txt`);
} else {
  console.log('⚠️  El system prompt ya tiene FAQs. No se agregaron duplicados.');
  console.log('📝 Para actualizar, primero eliminá la sección anterior manualmente.');
}
