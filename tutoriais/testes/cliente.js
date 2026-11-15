// testes/cliente.js — evidência da Parte 1 (API REST).
// Cria, lê, altera, substitui e remove um anúncio; solicita um aluguel e provoca de propósito
// as regras de negócio (422 e 409) e um 404.
//
// Pelo gateway (padrão):   npm run cliente
// Direto na API (só dev):   API_BASE=http://127.0.0.1:3001 npm run cliente   (PowerShell: $env:API_BASE="http://127.0.0.1:3001"; npm run cliente)
const BASE = process.env.API_BASE ?? 'http://localhost:3000/api';
const CHAVE = process.env.API_KEY ?? 'chave-painel-moderacao-456'; // fictícia (ver README)

const dia = (deslocamento) => {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'X-API-Key': CHAVE, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const requestId = resposta.headers.get('x-request-id');
  const local = resposta.headers.get('location');
  console.log(`\n${metodo} ${caminho} -> ${resposta.status}${local ? `  Location: ${local}` : ''}  (X-Request-Id ${requestId})`);
  if (resposta.status === 204) return null; // sucesso sem corpo

  const dados = await resposta.json();
  if (!resposta.ok) {
    // Aqui "dados" é um Problem Details (RFC 9457)
    const erro = new Error(`${resposta.status} ${dados.title}: ${dados.detail}`);
    erro.problema = dados;
    throw erro;
  }
  return dados;
}

async function esperandoErro(promessa) {
  try {
    await promessa;
    console.log('   !!! era esperado um erro, mas a chamada deu certo');
  } catch (erro) {
    if (!erro.problema) throw erro;
    console.log(`   Erro esperado -> ${erro.message}`);
    console.log(`   type: ${erro.problema.type}`);
  }
}

// 1. Anunciar um objeto (Carla, usuária 3)
const objeto = await api('POST', '/objetos', {
  proprietarioId: 3, titulo: 'Caixa de som Bluetooth 40W', descricao: 'Bateria para 8 horas.',
  categoria: 'ELETRONICOS', estado: 'SEMINOVO', valorDiaria: 20, maxDias: 4, cidade: 'Contagem',
});
console.log('   Criado:', objeto);

// 2. Ler
console.log('   Lido:', await api('GET', `/objetos/${objeto.id}`));

// 3. Alterar parcialmente (PATCH) e substituir (PUT)
console.log('   Alterado:', await api('PATCH', `/objetos/${objeto.id}`, { valorDiaria: 18 }));
console.log('   Substituído:', await api('PUT', `/objetos/${objeto.id}`, {
  titulo: 'Caixa de som Bluetooth 40W (com microfone)', descricao: 'Bateria para 8 horas.',
  categoria: 'ELETRONICOS', estado: 'SEMINOVO', valorDiaria: 18, maxDias: 4, cidade: 'Contagem',
}));

// 4. Filtro, ordenação e paginação
const pagina = await api('GET', '/objetos?disponivel=true&precoMax=30&ordenar=valorDiaria&ordem=desc&limite=3');
for (const o of pagina.dados) console.log(`   R$ ${o.valorDiaria}/dia - ${o.titulo}`);
console.log('  ', pagina.paginacao);

// 5. Solicitar o aluguel (Bruno, usuário 2): 201 e evento aluguel.solicitado na outbox
const aluguel = await api('POST', '/alugueis', {
  objetoId: objeto.id, locatarioId: 2, dataInicio: dia(3), dataFim: dia(4),
});
console.log(`   Aluguel ${aluguel.id}: ${aluguel.dias} dia(s), R$ ${aluguel.valorTotal}, ${aluguel.status}`);

// 6. Regras de negócio provocadas de propósito
await esperandoErro(api('POST', '/alugueis', { objetoId: objeto.id, locatarioId: 1, dataInicio: dia(4), dataFim: dia(5) })); // 409 período ocupado
await esperandoErro(api('POST', '/alugueis', { objetoId: objeto.id, locatarioId: 1, dataInicio: dia(-2), dataFim: dia(-1) })); // 422 data no passado
await esperandoErro(api('POST', '/alugueis', { objetoId: objeto.id, locatarioId: 1, dataInicio: dia(10), dataFim: dia(20) })); // 422 acima do limite
await esperandoErro(api('POST', '/alugueis', { objetoId: objeto.id, locatarioId: 3, dataInicio: dia(10), dataFim: dia(11) })); // 422 próprio objeto
await esperandoErro(api('PATCH', `/alugueis/${aluguel.id}`, { status: 'APROVADO', usuarioId: 2 })); // 403 só o dono aprova
await esperandoErro(api('PATCH', `/alugueis/${aluguel.id}`, { status: 'DEVOLVIDO', usuarioId: 3 })); // 409 transição inválida
await esperandoErro(api('DELETE', `/objetos/${objeto.id}`)); // 409 anúncio com aluguel ativo
await esperandoErro(api('POST', '/objetos', { titulo: 'X', valorDiaria: -1, categoria: 'CARRO' })); // 422 validação

// 7. O locatário cancela, e então o anúncio pode ser removido
console.log('   Cancelado:', (await api('PATCH', `/alugueis/${aluguel.id}`, { status: 'CANCELADO', usuarioId: 2 })).status);
await api('DELETE', `/objetos/${objeto.id}`);
console.log('   Removido.');

// 8. Erro de propósito: o anúncio não existe mais
await esperandoErro(api('GET', `/objetos/${objeto.id}`));
