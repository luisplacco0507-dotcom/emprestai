// rest-cliente.js — como o servidor GraphQL obtém os dados: chamando a API REST por HTTP.
// O GraphQL não tem cópia própria dos dados; as regras de negócio continuam todas na API REST.
import DataLoader from 'dataloader';
import { GraphQLError } from 'graphql';

export const URL_REST = process.env.URL_REST ?? 'http://127.0.0.1:3001';

// Problem Details da API REST → GraphQLError com um "code" que o cliente consegue tratar
const CODIGOS = { 400: 'BAD_USER_INPUT', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'BAD_USER_INPUT' };

/**
 * Um cliente por requisição GraphQL: repassa o X-Request-Id e a identidade do cliente,
 * e conta quantas chamadas REST a consulta precisou.
 */
export function criarClienteRest({ requestId, clienteId }) {
  const contagem = { http: 0, semDataLoader: 0 };
  const cabecalhos = {
    'x-request-id': requestId,
    ...(clienteId ? { 'x-cliente-id': clienteId } : {}),
  };

  async function chamar(metodo, caminho, corpo) {
    contagem.http++;
    let resposta;
    try {
      resposta = await fetch(URL_REST + caminho, {
        method: metodo,
        headers: { ...cabecalhos, ...(corpo ? { 'content-type': 'application/json' } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      throw new GraphQLError('A API REST do Emprestaí não respondeu.', { extensions: { code: 'SERVICO_INDISPONIVEL' } });
    }
    if (resposta.status === 204) return null;
    const dados = await resposta.json();
    if (!resposta.ok) {
      throw new GraphQLError(dados.detail ?? `Erro ${resposta.status} na API REST`, {
        extensions: {
          code: CODIGOS[resposta.status] ?? 'SERVICO_INDISPONIVEL',
          status: resposta.status,
          problema: dados.type, // o "type" do Problem Details (ex.: .../periodo-ocupado)
          ...(dados.erros ? { erros: dados.erros } : {}),
        },
      });
    }
    return dados;
  }

  const get = (caminho) => { contagem.semDataLoader++; return chamar('GET', caminho); };

  // Lista paginada inteira (segue as páginas, até 10 de 50 itens)
  async function listarTudo(caminho) {
    const separador = caminho.includes('?') ? '&' : '?';
    const itens = [];
    for (let pagina = 1; pagina <= 10; pagina++) {
      const r = await chamar('GET', `${caminho}${separador}limite=50&pagina=${pagina}`);
      itens.push(...r.dados);
      if (pagina >= r.paginacao.totalPaginas) break;
    }
    return itens;
  }

  // ---------- DataLoader: junta os pedidos do mesmo ciclo em 1 chamada (resolve o N+1) ----------
  // Recebe uma lista de ids e devolve os registros NA MESMA ORDEM
  const porIds = (recurso) => new DataLoader(async (ids) => {
    const encontrados = await listarTudo(`/${recurso}?ids=${ids.join(',')}`);
    return ids.map((id) => encontrados.find((r) => String(r.id) === String(id)) ?? null);
  });

  const avaliacoesRecebidas = new DataLoader(async (usuarioIds) => {
    const todas = await listarTudo(`/avaliacoes?usuarioIds=${usuarioIds.join(',')}`);
    return usuarioIds.map((id) => todas.filter((a) => String(a.avaliadoId) === String(id)));
  });

  const loaders = { usuarios: porIds('usuarios'), objetos: porIds('objetos'), avaliacoes: avaliacoesRecebidas };
  const carregar = (nome, id) => { contagem.semDataLoader++; return loaders[nome].load(String(id)); };

  return {
    contagem,
    get,
    listar: (caminho) => { contagem.semDataLoader++; return listarTudo(caminho); },
    post: (caminho, corpo) => { contagem.semDataLoader++; return chamar('POST', caminho, corpo); },
    patch: (caminho, corpo) => { contagem.semDataLoader++; return chamar('PATCH', caminho, corpo); },
    usuario: (id) => carregar('usuarios', id),
    objeto: (id) => carregar('objetos', id),
    avaliacoesRecebidas: (id) => carregar('avaliacoes', id),
  };
}
