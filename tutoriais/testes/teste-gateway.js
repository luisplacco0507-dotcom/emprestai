// testes/teste-gateway.js — evidência da Parte 4 (cenas 6 e 7 do roteiro).
//
//   npm run teste-gateway                  200, 401, 403, 504, 429 e a rota agregada completa
//   (desligue a API REST com Ctrl+C)
//   npm run teste-gateway -- falha         502, 502, 502 e então 503 com Retry-After (disjuntor aberto)
//   (religue a API REST: npm run rest)
//   npm run teste-gateway -- recuperacao   espera o disjuntor e mostra o 200 de volta
//   (desligue o servidor GraphQL com Ctrl+C)
//   npm run teste-gateway -- parcial       rota agregada com "parcial": true (degradação graciosa)
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const CHAVES = {
  app: 'chave-app-emprestai-123',        // app-emprestai: 20 por minuto
  painel: 'chave-painel-moderacao-456',  // painel-moderacao: 120 por minuto
  parceiro: 'chave-parceiro-seguros-789', // parceiro-seguros: 5 por minuto, só GET /api/objetos
};
const cena = process.argv[2] ?? 'basico';
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function chamar(rotulo, caminho, { chave, metodo = 'GET', mostrarCorpo = false } = {}) {
  const inicio = performance.now();
  const r = await fetch(GATEWAY + caminho, { method: metodo, headers: chave ? { 'X-API-Key': chave } : {} });
  const ms = Math.round(performance.now() - inicio);
  const corpo = await r.json().catch(() => null);
  const extras = ['retry-after', 'x-ratelimit-remaining']
    .filter((h) => r.headers.has(h)).map((h) => `${h}=${r.headers.get(h)}`).join(' ');
  console.log(`${String(r.status).padEnd(4)} ${rotulo.padEnd(48)} ${String(ms).padStart(5)} ms  ${extras}`);
  if (r.status >= 400 && corpo?.detail) console.log(`     └ ${corpo.title}: ${corpo.detail}`);
  if (mostrarCorpo) console.dir(corpo, { depth: null });
  return { status: r.status, corpo, headers: r.headers };
}

if (cena === 'basico') {
  console.log('== Autenticação, autorização e roteamento ==');
  await chamar('GET /saude (sem chave, fora da /api)', '/saude');
  await chamar('GET /api/objetos com a chave do app', '/api/objetos?limite=2', { chave: CHAVES.app });
  await chamar('GET /api/objetos/1 (vira /objetos/1 na API)', '/api/objetos/1', { chave: CHAVES.app });
  await chamar('GET /api/objetos sem chave', '/api/objetos');
  await chamar('GET /api/objetos com chave inválida', '/api/objetos', { chave: 'chave-errada' });
  await chamar('GET /api/alugueis com a chave do parceiro', '/api/alugueis', { chave: CHAVES.parceiro });
  await chamar('GET /api/xyz (nenhuma rota)', '/api/xyz', { chave: CHAVES.painel });

  console.log('\n== Timeout: a API REST demora 5 s, o gateway desiste em 2 s ==');
  await chamar('GET /api/objetos?atraso=5000', '/api/objetos?atraso=5000', { chave: CHAVES.painel });
  await chamar('GET /api/objetos (de novo, normal)', '/api/objetos?limite=1', { chave: CHAVES.painel });

  console.log('\n== Limite de uso do plano do parceiro (5 por minuto) ==');
  for (let i = 1; i <= 7; i++) await chamar(`GET /api/objetos #${i} (parceiro)`, '/api/objetos?limite=1', { chave: CHAVES.parceiro });

  console.log('\n== Rota agregada: aluguel + objeto (REST) + reputação das partes (GraphQL) ==');
  await chamar('GET /api/painel/alugueis/2', '/api/painel/alugueis/2', { chave: CHAVES.app, mostrarCorpo: true });
  await chamar('GET /api/painel/alugueis/999', '/api/painel/alugueis/999', { chave: CHAVES.app });
} else if (cena === 'falha') {
  console.log('== API REST desligada: 502 até o disjuntor abrir, depois 503 imediato ==');
  for (let i = 1; i <= 4; i++) await chamar(`GET /api/objetos #${i}`, '/api/objetos', { chave: CHAVES.painel });
  await chamar('GET /api/painel/alugueis/2 (aluguel é indispensável)', '/api/painel/alugueis/2', { chave: CHAVES.painel });
  await chamar('GET /saude (estado dos disjuntores)', '/saude', { mostrarCorpo: true });
} else if (cena === 'recuperacao') {
  console.log('== API REST religada: o disjuntor deixa passar uma chamada de teste e fecha ==');
  for (let i = 1; i <= 15; i++) {
    const r = await chamar(`GET /api/objetos (tentativa ${i})`, '/api/objetos?limite=1', { chave: CHAVES.painel });
    if (r.status === 200) break;
    await esperar(Number(r.headers.get('retry-after') ?? 1) * 1000);
  }
} else if (cena === 'parcial') {
  console.log('== Servidor GraphQL desligado: a rota agregada responde 200 com "parcial": true ==');
  await chamar('GET /api/painel/alugueis/2', '/api/painel/alugueis/2', { chave: CHAVES.app, mostrarCorpo: true });
} else {
  console.log('Uso: node testes/teste-gateway.js [basico|falha|recuperacao|parcial]');
}
