// testes/teste-graphql.js — evidência da Parte 3 (cena 5 do roteiro).
// Executa a consulta da tela "Minha área" do app e mostra quantas chamadas REST ela substituiu.
//
// Pelo gateway (padrão):  npm run teste-graphql
// Direto (só dev):        GRAPHQL_URL=http://127.0.0.1:4000/ npm run teste-graphql
const URL_GRAPHQL = process.env.GRAPHQL_URL ?? 'http://localhost:3000/api/graphql';
const CHAVE = process.env.API_KEY ?? 'chave-app-emprestai-123';

async function graphql(query, variables = {}) {
  const resposta = await fetch(URL_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': CHAVE },
    body: JSON.stringify({ query, variables }),
  });
  if (resposta.headers.get('content-type')?.includes('problem+json')) {
    throw new Error(`gateway respondeu ${resposta.status}: ${(await resposta.json()).detail}`);
  }
  // Em GraphQL, erro de negócio chega com HTTP 200: é preciso conferir "errors"
  return { ...(await resposta.json()), requestId: resposta.headers.get('x-request-id') };
}

const MINHA_AREA = `
  query MinhaArea($id: ID!) {
    usuario(id: $id) {
      nome
      cidade
      reputacao { media totalAvaliacoes }
      alugueisComoLocatario {
        id status dataInicio dataFim valorTotal
        objeto { titulo proprietario { nome reputacao { media } } }
      }
      objetos {
        titulo valorDiaria disponivel
        alugueis(status: SOLICITADO) {
          id dataInicio dataFim
          locatario { nome reputacao { media totalAvaliacoes } }
        }
      }
    }
  }
`;

console.log('== Tela "Minha área" da Ana (usuária 1): 1 chamada GraphQL ==');
const tela = await graphql(MINHA_AREA, { id: '1' });
console.dir(tela.data, { depth: null });
const u = tela.data.usuario;
// O que o app faria sem GraphQL (uma chamada REST por informação da tela):
const semGraphql = 2 /* usuário + avaliações */ + 1 /* aluguéis como locatária */ +
  u.alugueisComoLocatario.length * 3 /* objeto, dono e avaliações do dono */ +
  1 /* objetos da Ana */ + u.objetos.length /* solicitações de cada objeto */ +
  u.objetos.flatMap((o) => o.alugueis).length * 2; /* locatário e avaliações dele */
console.log(`\nX-Request-Id: ${tela.requestId}`);
console.log(`O app fez 1 chamada. Sem GraphQL, faria ${semGraphql} chamadas REST pela internet.`);
console.log(`Do lado do servidor, na rede interna: ${tela.extensions.chamadasRest.realizadas} chamadas REST ` +
  `com DataLoader (seriam ${tela.extensions.chamadasRest.semDataLoader} sem ele).`);

console.log('\n== Consulta com argumentos (filtro) ==');
const busca = await graphql(`
  query Busca($filtro: FiltroObjetos) {
    objetos(filtro: $filtro) { titulo categoria valorDiaria proprietario { nome } }
  }`, { filtro: { categoria: 'FERRAMENTAS', disponivel: true } });
console.dir(busca.data, { depth: null });

console.log('\n== Mutation com input e erro tratado (período ocupado → CONFLICT) ==');
const conflito = await graphql(`
  mutation Solicitar($dados: SolicitarAluguelInput!) {
    solicitarAluguel(dados: $dados) { id status }
  }`, { dados: { objetoId: '4', locatarioId: '2', dataInicio: new Date().toISOString().slice(0, 10), dataFim: new Date().toISOString().slice(0, 10) } });
console.dir(conflito.errors, { depth: null });
