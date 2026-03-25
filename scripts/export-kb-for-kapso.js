#!/usr/bin/env node

/**
 * Script para exportar knowledge base a formato Kapso
 * Kapso acepta generalmente CSV o JSON con formato específico
 */

const fs = require('fs');
const path = require('path');

console.log('📚 Exportando Knowledge Base para Kapso...\n');

// Cargar knowledge base
const kbPath = path.join(__dirname, '..', 'data', 'knowledge-base.json');
const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));

console.log('Total documentos:', kb.documents?.length || 0);

// Función para limpiar texto
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 2000); // Límite de caracteres
}

// Exportar en formato JSON para Kapso (estructura limpia)
const kapsoFormat = kb.documents
  ?.filter(doc => doc.text || doc.answer || doc.content) // Solo docs con contenido
  ?.map((doc, index) => ({
    id: doc.id || `doc_${index}`,
    question: cleanText(doc.question || doc.title || doc.query || 'Consulta técnica'),
    answer: cleanText(doc.text || doc.answer || doc.content),
    category: doc.category || (doc.source?.includes('manual') ? 'Documentación Técnica' : 'Soporte Histórico'),
    source: doc.source,
    product: doc.product || doc.brand || doc.metadata?.product || '',
    tags: [
      doc.source,
      doc.product,
      doc.category
    ].filter(Boolean)
  })) || [];

console.log('Documentos procesados:', kapsoFormat.length);

// Guardar archivo para Kapso
const outputPath = path.join(__dirname, '..', 'data', 'kapso-knowledge-base.json');
fs.writeFileSync(outputPath, JSON.stringify({
  name: 'PC MIDI Center - Knowledge Base',
  description: 'Base de conocimiento de soporte técnico con manuales y casos históricos',
  documents: kapsoFormat,
  metadata: {
    totalDocuments: kapsoFormat.length,
    sources: [...new Set(kapsoFormat.map(d => d.source))],
    exportedAt: new Date().toISOString()
  }
}, null, 2));

console.log('✅ Exportado a:', outputPath);
console.log('\n📊 Resumen:');
console.log('  - Total documentos:', kapsoFormat.length);
console.log('  - Manuales:', kapsoFormat.filter(d => d.source?.includes('manual')).length);
console.log('  - Casos históricos:', kapsoFormat.filter(d => !d.source?.includes('manual')).length);

// También exportar en CSV (muchas plataformas lo prefieren)
const csvHeader = 'id,question,answer,category,source,product,tags\n';
const csvRows = kapsoFormat.map(doc => {
  const tags = doc.tags?.join(';') || '';
  return `"${doc.id}","${doc.question.replace(/"/g, '""')}","${doc.answer.replace(/"/g, '""')}","${doc.category}","${doc.source}","${doc.product}","${tags}"`;
});

const csvPath = path.join(__dirname, '..', 'data', 'kapso-knowledge-base.csv');
fs.writeFileSync(csvPath, csvHeader + csvRows.join('\n'));

console.log('✅ CSV exportado a:', csvPath);
console.log('\n💡 Siguientes pasos:');
console.log('  1. Revisá los archivos en /data/');
console.log('  2. Si Kapso tiene Knowledge Base: subí el CSV o JSON');
console.log('  3. Si usás API: copiá la estructura para tus endpoints');
