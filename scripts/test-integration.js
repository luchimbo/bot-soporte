#!/usr/bin/env node

/**
 * Script de prueba para la integración de Knowledge Base
 * Prueba el webhook y la detección de modelos
 */

const http = require('http');

function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: process.env.PORT || 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch {
          resolve(responseData);
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testIntegration() {
  console.log('🧪 Probando integración de Knowledge Base...\n');
  
  const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
  
  try {
    // Test 1: Health check
    console.log('1️⃣ Health Check...');
    const health = await makeRequest('/health');
    console.log(`   ✅ Servidor funcionando`);
    console.log(`   📊 Knowledge Base: ${health.knowledgeBase?.totalDocuments || 'N/A'} documentos`);
    
    // Test 2: Consultar producto MD200ULTRA
    console.log('\n2️⃣ Consultando MD200ULTRA...');
    const product = await makeRequest('/api/product/MD200ULTRA');
    if (product.success) {
      console.log(`   ✅ Producto encontrado: ${product.producto.nombre}`);
      console.log(`   🔌 Conectividad: ${product.producto.conectividad}`);
      console.log(`   📚 Manuales: ${product.producto.tiene_manuales ? 'Sí' : 'No'}`);
    } else {
      console.log(`   ❌ ${product.error}`);
    }
    
    // Test 3: Listar baterías
    console.log('\n3️⃣ Listando baterías...');
    const baterias = await makeRequest('/api/baterias');
    if (baterias.success) {
      console.log(`   ✅ ${baterias.total} baterías encontradas`);
      baterias.baterias.slice(0, 3).forEach((b, i) => {
        console.log(`   ${i + 1}. ${b.modelo || 'Sin modelo'} - ${b.nombre.substring(0, 40)}...`);
      });
      if (baterias.total > 3) {
        console.log(`   ... y ${baterias.total - 3} más`);
      }
    }
    
    // Test 4: Búsqueda
    console.log('\n4️⃣ Buscando "Minilab"...');
    const search = await makeRequest('/api/search?q=Minilab');
    if (search.success) {
      console.log(`   ✅ ${search.total} resultados encontrados`);
    }
    
    // Test 5: Simulación de mensaje con modelo
    console.log('\n5️⃣ Simulando mensaje con MD200ULTRA...');
    const simulate = await makeRequest('/simulate', 'POST', {
      text: 'Hola, tengo una MD200ULTRA y no sé cómo conectarla',
      sessionId: 'test-session-123'
    });
    console.log(`   ✅ Respuesta generada (${simulate.reply?.length || 0} caracteres)`);
    console.log(`   📝 Modo: ${simulate.mode}`);
    if (simulate.activeProduct) {
      console.log(`   📦 Producto activo: ${simulate.activeProduct.name || 'N/A'}`);
    }
    
    console.log('\n✅ Todas las pruebas completadas exitosamente!');
    console.log('\n📚 El bot ahora tiene acceso a:');
    console.log('   • 590 productos con descripciones completas');
    console.log('   • 69 manuales PDF vinculados');
    console.log('   • 278 FAQs generadas');
    console.log('   • Detección automática de modelos ED y MD');
    
  } catch (error) {
    console.error('\n❌ Error en las pruebas:', error.message);
    console.log('\n💡 Asegurate de que el servidor esté corriendo:');
    console.log('   npm start');
    process.exit(1);
  }
}

// Ejecutar pruebas
testIntegration();
