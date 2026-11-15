// Servidor GraphQL do Emprestaí — rode com: npm run graphql
// Ouve só em 127.0.0.1:4000; de fora, é acessado pelo gateway em /api/graphql.
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { randomUUID } from 'node:crypto';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers.js';
import { criarClienteRest, URL_REST } from './rest-cliente.js';

// Plugin: ao final de cada operação, registra no log e devolve em "extensions" quantas
// chamadas REST ela precisou (com e sem o agrupamento do DataLoader)
const contagemDeChamadas = {
  async requestDidStart() {
    return {
      async willSendResponse({ contextValue, response, operationName }) {
        const { http, semDataLoader } = contextValue.rest.contagem;
        console.log(`[graphql] ${contextValue.requestId} operação ${operationName ?? '(anônima)'} -> ` +
          `${http} chamada(s) REST (seriam ${semDataLoader} sem DataLoader) cliente=${contextValue.clienteId ?? '-'}`);
        response.http.headers.set('x-request-id', contextValue.requestId);
        if (response.body.kind === 'single') {
          response.body.singleResult.extensions = {
            ...response.body.singleResult.extensions,
            requestId: contextValue.requestId,
            chamadasRest: { realizadas: http, semDataLoader },
          };
        }
      },
    };
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [contagemDeChamadas],
  includeStacktraceInErrorResponses: false, // pilha de chamadas só no log, nunca para o cliente
});

const HOST = '127.0.0.1';
const PORTA = Number(process.env.PORTA_GRAPHQL ?? 4000);

const { url } = await startStandaloneServer(server, {
  listen: { port: PORTA, host: HOST },
  // Um contexto NOVO por requisição: lê os cabeçalhos repassados pelo gateway e cria os DataLoaders
  // (o cache de um cliente nunca vaza para outro)
  context: async ({ req }) => {
    const requestId = req.headers['x-request-id'] ?? randomUUID();
    const clienteId = req.headers['x-cliente-id'];
    return { requestId, clienteId, rest: criarClienteRest({ requestId, clienteId }) };
  },
});

console.log(`[graphql] Servidor GraphQL do Emprestaí em ${url} (dados vindos de ${URL_REST})`);
