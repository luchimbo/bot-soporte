const fs = require('fs');

// Leer FAQs generadas
const faqs = JSON.parse(fs.readFileSync('data/faqs-reales.json', 'utf8'));

// Leer el system prompt base (líneas 1-87)
const systemPromptLines = fs.readFileSync('docs/KAPSO-SYSTEM-PROMPT-FINAL.txt', 'utf8').split('\n');
const basePrompt = systemPromptLines.slice(0, 87).join('\n');

// Crear contenido de FAQs
let faqsContent = '\n────────────────────────────────────────\n';
faqsContent += 'BASE DE CONOCIMIENTO - FAQs POR PRODUCTO (Basadas en descripciones reales de Tiendanube)\n';
faqsContent += '────────────────────────────────────────\n';
faqsContent += 'Usá esta información EXCLUSIVAMENTE cuando el cliente confirme el modelo exacto.\n';
faqsContent += 'NO uses esta info si el cliente dice "mi batería" sin especificar el modelo.\n';
faqsContent += 'Todas estas FAQs fueron generadas a partir de las descripciones reales de los productos.\n\n';

// Agrupar por tipo
const porTipo = {};
faqs.forEach(f => {
  if (!porTipo[f.tipo]) porTipo[f.tipo] = [];
  porTipo[f.tipo].push(f);
});

Object.entries(porTipo).forEach(([tipo, lista]) => {
  faqsContent += `\n### ${tipo.toUpperCase()} (${lista.length} FAQs)\n\n`;
  
  // Agrupar por producto
  const porProducto = {};
  lista.forEach(f => {
    if (!porProducto[f.producto]) porProducto[f.producto] = [];
    porProducto[f.producto].push(f);
  });
  
  Object.entries(porProducto).forEach(([producto, faqsProducto]) => {
    faqsContent += `**${producto}**\n`;
    faqsProducto.forEach(f => {
      faqsContent += `Q: ${f.pregunta}\n`;
      faqsContent += `A: ${f.respuesta}\n\n`;
    });
  });
});

faqsContent += `\n────────────────────────────────────────\n`;
faqsContent += `TOTAL: ${faqs.length} FAQs basadas en descripciones reales de productos de Tiendanube\n`;
faqsContent += `Fecha de generación: ${new Date().toLocaleDateString('es-AR')}\n`;
faqsContent += `────────────────────────────────────────\n`;

// Combinar y guardar
const newPrompt = basePrompt + faqsContent;
fs.writeFileSync('docs/KAPSO-SYSTEM-PROMPT-FINAL.txt', newPrompt);

console.log('✅ System prompt actualizado con FAQs basadas en descripciones reales');
console.log(`📊 Total FAQs incluidas: ${faqs.length}`);
console.log(`📁 Archivo actualizado: docs/KAPSO-SYSTEM-PROMPT-FINAL.txt`);
console.log('\nResumen por categoría:');
Object.entries(porTipo).forEach(([tipo, lista]) => {
  console.log(`  ${tipo}: ${lista.length} FAQs`);
});
