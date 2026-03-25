#!/usr/bin/env node

/**
 * Script para actualizar automáticamente el playbook de soporte
 * Lee el catálogo de productos y genera/actualiza SoporteBot.xlsx
 * 
 * Uso: npm run update:playbook
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const config = require('../src/config');

console.log('🔄 Actualizando playbook de soporte...\n');

// Rutas de archivos
const catalogPath = config.catalog.filePath;
const playbookPath = config.playbook.filePath;

// Verificar que existen los archivos
if (!fs.existsSync(catalogPath)) {
  console.error(`❌ Error: No se encuentra el catálogo en ${catalogPath}`);
  process.exit(1);
}

if (!fs.existsSync(playbookPath)) {
  console.error(`❌ Error: No se encuentra el playbook en ${playbookPath}`);
  process.exit(1);
}

// Cargar catálogo
console.log(`📖 Cargando catálogo: ${catalogPath}`);
const catalogWb = XLSX.readFile(catalogPath);
const catalogWs = catalogWb.Sheets[catalogWb.SheetNames[0]];
const products = XLSX.utils.sheet_to_json(catalogWs);

console.log(`   Encontrados ${products.length} productos`);

// Cargar playbook existente
console.log(`\n📋 Cargando playbook: ${playbookPath}`);
const playbookWb = XLSX.readFile(playbookPath);

// Leer hojas existentes
const existingSpecs = XLSX.utils.sheet_to_json(playbookWb.Sheets['product_specs'] || []);
const existingFaqs = XLSX.utils.sheet_to_json(playbookWb.Sheets['faq_respuestas'] || []);
const existingTriage = XLSX.utils.sheet_to_json(playbookWb.Sheets['triage_humano'] || []);
const existingPolicies = XLSX.utils.sheet_to_json(playbookWb.Sheets['politicas_bot'] || []);

console.log(`   Specs existentes: ${existingSpecs.length}`);
console.log(`   FAQs existentes: ${existingFaqs.length}`);

// Función para detectar tipo de producto
function detectProductType(name) {
  const upper = name.toUpperCase();
  
  if (upper.includes('CONTROLADOR') || upper.includes('MINILAB') || upper.includes('KEYLAB') || upper.includes('KEYSTEP')) {
    return 'controlador_midi';
  }
  if (upper.includes('INTERFACE') || upper.includes('MINIFUSE') || upper.includes('AUDIOFUSE')) {
    return 'interface_audio';
  }
  if (upper.includes('SINTETIZADOR') || upper.includes('BRUTE') || upper.includes('FREAK') || upper.includes('ASTROLAB')) {
    return 'sintetizador';
  }
  if (upper.includes('BATERIA') || upper.includes('ED6') || upper.includes('ED8') || upper.includes('ED9')) {
    return 'bateria_electronica';
  }
  if (upper.includes('AURICULAR') || upper.includes('HEADPHONE')) {
    return 'auricular';
  }
  if (upper.includes('MICROFONO') || upper.includes('MICROPHONE')) {
    return 'microfono';
  }
  
  return 'otro';
}

// Función para detectar marca
function detectBrand(name) {
  const upper = name.toUpperCase();
  
  if (upper.includes('ARTURIA')) return 'Arturia';
  if (upper.includes('MIDIPLUS')) return 'Midiplus';
  if (upper.includes('ALCTRON')) return 'Alctron';
  if (upper.includes('BEHRINGER')) return 'Behringer';
  if (upper.includes('KORG')) return 'Korg';
  if (upper.includes('NOVATION')) return 'Novation';
  
  return 'Otra';
}

// Generar specs para productos nuevos
console.log('\n🔍 Analizando productos...');

const newSpecs = [];
let specId = existingSpecs.length + 1;
const processedProducts = new Set();

products.forEach(product => {
  const name = product.Nombre || '';
  const brand = detectBrand(name);
  const type = detectProductType(name);
  
  // Solo productos relevantes
  if (type === 'otro' || !brand) return;
  
  // Extraer modelo base
  const modelMatch = name.match(/(MINILAB|KEYLAB|KEYSTEP|MINIFUSE|AUDIOFUSE|ED6|ED8|ED9|AKM\d+)/i);
  if (!modelMatch) return;
  
  const model = modelMatch[1].toUpperCase();
  const familyKey = `${brand.toLowerCase()} ${model.toLowerCase()}`;
  
  // Evitar duplicados
  if (processedProducts.has(familyKey)) return;
  processedProducts.add(familyKey);
  
  // Verificar si ya existe
  const exists = existingSpecs.some(spec => 
    spec.family_key?.toLowerCase() === familyKey
  );
  
  if (!exists) {
    newSpecs.push({
      id: `spec_${String(specId).padStart(3, '0')}`,
      activo: true,
      marca: brand,
      producto: model,
      producto_aliases: `${model.toLowerCase()}|${brand.toLowerCase()} ${model.toLowerCase()}`,
      family_key: familyKey,
      variant_policy: 'cosmetic',
      is_primary_model: true,
      se_conecta_a_pc: type !== 'otro',
      es_controlador_midi: type === 'controlador_midi',
      envia_midi_por_usb: type === 'controlador_midi' || type === 'interface_audio',
      envia_audio_por_usb: type === 'interface_audio',
      requiere_driver: type === 'interface_audio',
      class_compliant: type === 'controlador_midi',
      tiene_parlantes: type === 'bateria_electronica',
      salida_audio: type === 'interface_audio' ? 'line' : 'none',
      salida_mono: false,
      notas_tecnicas: `${type}, ${brand} ${model}`,
      respuesta_pc: `Sí, el ${model} se conecta a PC.`,
      respuesta_midi: type === 'controlador_midi' ? `Sí, el ${model} envía MIDI por USB.` : 'No aplica',
      respuesta_audio_usb: type === 'interface_audio' ? `Sí, el ${model} transmite audio por USB.` : 'No, no transmite audio por USB.',
      respuesta_driver: type === 'interface_audio' ? `Sí, requiere drivers.` : 'No, es plug-and-play.',
      respuesta_parlantes: type === 'bateria_electronica' ? `Sí, tiene parlantes integrados.` : 'No, no tiene parlantes.',
      respuesta_salida_audio: type === 'interface_audio' ? `Tiene salidas de línea.` : 'No tiene salida de audio.',
      link_apoyo: '',
      observaciones: `Generado automáticamente desde catálogo el ${new Date().toISOString()}`,
    });
    specId++;
  }
});

console.log(`   Productos nuevos encontrados: ${newSpecs.length}`);

// Actualizar specs
if (newSpecs.length > 0) {
  console.log(`\n✨ Agregando ${newSpecs.length} nuevos product_specs...`);
  
  const allSpecs = [...existingSpecs, ...newSpecs];
  
  // Headers
  const headers = [
    'id', 'activo', 'marca', 'producto', 'producto_aliases', 'family_key',
    'variant_policy', 'is_primary_model', 'se_conecta_a_pc', 'es_controlador_midi',
    'envia_midi_por_usb', 'envia_audio_por_usb', 'requiere_driver', 'class_compliant',
    'tiene_parlantes', 'salida_audio', 'salida_mono', 'notas_tecnicas',
    'respuesta_pc', 'respuesta_midi', 'respuesta_audio_usb', 'respuesta_driver',
    'respuesta_parlantes', 'respuesta_salida_audio', 'link_apoyo', 'observaciones',
  ];
  
  const data = [headers];
  allSpecs.forEach(spec => {
    data.push([
      spec.id, spec.activo, spec.marca, spec.producto, spec.producto_aliases,
      spec.family_key, spec.variant_policy, spec.is_primary_model, spec.se_conecta_a_pc,
      spec.es_controlador_midi, spec.envia_midi_por_usb, spec.envia_audio_por_usb,
      spec.requiere_driver, spec.class_compliant, spec.tiene_parlantes, spec.salida_audio,
      spec.salida_mono, spec.notas_tecnicas, spec.respuesta_pc, spec.respuesta_midi,
      spec.respuesta_audio_usb, spec.respuesta_driver, spec.respuesta_parlantes,
      spec.respuesta_salida_audio, spec.link_apoyo, spec.observaciones,
    ]);
  });
  
  const ws = XLSX.utils.aoa_to_sheet(data);
  playbookWb.Sheets['product_specs'] = ws;
}

// Guardar playbook actualizado
console.log('\n💾 Guardando playbook actualizado...');
XLSX.writeFile(playbookWb, playbookPath);

console.log(`\n✅ Playbook actualizado exitosamente!`);
console.log(`   Total product_specs: ${existingSpecs.length + newSpecs.length}`);
console.log(`   Nuevos agregados: ${newSpecs.length}`);

if (newSpecs.length > 0) {
  console.log('\n📝 Nuevos productos:');
  newSpecs.forEach(spec => {
    console.log(`   - ${spec.marca} ${spec.producto}`);
  });
}

console.log('\n🎉 Listo! El playbook ha sido actualizado.');
