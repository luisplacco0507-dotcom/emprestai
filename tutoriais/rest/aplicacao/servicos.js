// Camada de Aplicação — casos de uso do Emprestaí.
// Recebe as solicitações da Apresentação, aplica as regras do Domínio e usa a Infraestrutura
// (repositório e publicador de eventos) que lhe é ENTREGUE pelo ponto de montagem (rest/app.js).
// Assim esta camada não importa nenhum arquivo de infraestrutura (ADR-002, camadas fechadas).
import { ErroDominio, naoEncontrado } from '../dominio/erros.js';
import * as regras from '../dominio/regras.js';
import { exigirId, lerConsulta, ordenarEPaginar } from './consultas.js';

const CAMPOS_USUARIO = ['nome', 'email', 'telefone', 'cidade'];
const CAMPOS_OBJETO = ['titulo', 'descricao', 'categoria', 'estado', 'valorDiaria', 'maxDias', 'cidade', 'disponivel'];

// Copia só os campos permitidos (evita mass assignment: ninguém troca id, dono ou status pelo corpo)
const somenteCampos = (dados, campos) =>
  Object.fromEntries(campos.filter((c) => dados[c] !== undefined).map((c) => [c, dados[c]]));

const corpo = (dados) => (dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {});

/**
 * @param {{ repositorio: object, publicador: { registrar: Function }, relogio?: () => Date }} dependencias
 */
export function criarServicos({ repositorio, publicador, relogio = () => new Date() }) {
  const { usuarios, objetos, alugueis, avaliacoes } = repositorio;

  const acharUsuario = (id) => usuarios.buscar(id) ?? (() => { throw naoEncontrado('usuario', id); })();
  const acharObjeto = (id) => objetos.buscar(id) ?? (() => { throw naoEncontrado('objeto', id); })();
  const acharAluguel = (id) => alugueis.buscar(id) ?? (() => { throw naoEncontrado('aluguel', id); })();
  // Id citado no CORPO que não existe: o recurso chamado existe, o conteúdo é que é inválido (422)
  const referencia = (achar, campo, id) => {
    try { return achar(id); } catch (erro) {
      if (erro.natureza !== 'nao-encontrado') throw erro;
      throw new ErroDominio('validacao', 'referencia-invalida', 'Referência inválida', erro.message,
        { erros: [{ campo, mensagem: `não existe registro com id ${id}` }] });
    }
  };
  const alugueisDoObjeto = (objetoId) => alugueis.listar().filter((a) => a.objetoId === objetoId);

  // Dados que vão no evento: o consumidor não precisa chamar a API de volta (event-carried state)
  const contato = (u) => ({ id: u.id, nome: u.nome, email: u.email, telefone: u.telefone });
  function retratoDoAluguel(aluguel) {
    const objeto = objetos.buscar(aluguel.objetoId);
    const { historico, ...resumo } = aluguel;
    return {
      ...resumo,
      objeto: objeto ? { id: objeto.id, titulo: objeto.titulo, categoria: objeto.categoria } : null,
      proprietario: contato(usuarios.buscar(aluguel.proprietarioId)),
      locatario: contato(usuarios.buscar(aluguel.locatarioId)),
    };
  }

  return {
    // ---------------- Usuários ----------------
    listarUsuarios(query) {
      const c = lerConsulta(query, {
        filtros: { ids: 'ids', cidade: 'texto', busca: 'texto' },
        ordenaveis: ['id', 'nome', 'criadoEm'],
      });
      let lista = usuarios.listar();
      if (c.filtros.ids) lista = lista.filter((u) => c.filtros.ids.includes(u.id));
      if (c.filtros.cidade) lista = lista.filter((u) => u.cidade.toLowerCase() === c.filtros.cidade);
      if (c.filtros.busca) lista = lista.filter((u) => u.nome.toLowerCase().includes(c.filtros.busca));
      return ordenarEPaginar(lista, c);
    },

    obterUsuario: (id) => acharUsuario(exigirId(id)),

    criarUsuario(dados) {
      dados = corpo(dados);
      regras.validarUsuario(dados);
      const email = dados.email.toLowerCase();
      if (usuarios.listar().some((u) => u.email === email)) {
        throw new ErroDominio('conflito', 'email-ja-cadastrado', 'E-mail já cadastrado',
          `Já existe um usuário com o e-mail ${email}.`);
      }
      return usuarios.inserir({ ...somenteCampos(dados, CAMPOS_USUARIO), email, criadoEm: relogio().toISOString() });
    },

    // ---------------- Objetos (anúncios) — CRUD completo ----------------
    listarObjetos(query) {
      const c = lerConsulta(query, {
        filtros: {
          ids: 'ids', categoria: regras.CATEGORIAS, estado: regras.ESTADOS_CONSERVACAO, cidade: 'texto',
          busca: 'texto', disponivel: 'booleano', proprietarioId: 'inteiro', precoMax: 'numero',
        },
        ordenaveis: ['id', 'titulo', 'valorDiaria', 'maxDias', 'criadoEm'],
      });
      const f = c.filtros;
      let lista = objetos.listar();
      if (f.ids) lista = lista.filter((o) => f.ids.includes(o.id));
      if (f.categoria) lista = lista.filter((o) => o.categoria === f.categoria);
      if (f.estado) lista = lista.filter((o) => o.estado === f.estado);
      if (f.cidade) lista = lista.filter((o) => o.cidade.toLowerCase() === f.cidade);
      if (f.busca) {
        lista = lista.filter((o) => `${o.titulo} ${o.descricao ?? ''}`.toLowerCase().includes(f.busca));
      }
      if (f.disponivel !== undefined) lista = lista.filter((o) => o.disponivel === f.disponivel);
      if (f.proprietarioId) lista = lista.filter((o) => o.proprietarioId === f.proprietarioId);
      if (f.precoMax !== undefined) lista = lista.filter((o) => o.valorDiaria <= f.precoMax);
      return ordenarEPaginar(lista, c);
    },

    obterObjeto: (id) => acharObjeto(exigirId(id)),

    anunciarObjeto(dados, { requestId } = {}) {
      dados = corpo(dados);
      const erros = [];
      if (!Number.isInteger(dados.proprietarioId) || dados.proprietarioId < 1) {
        erros.push({ campo: 'proprietarioId', mensagem: 'obrigatório: inteiro positivo' });
      }
      try { regras.validarObjeto(dados); } catch (e) { erros.push(...e.extras.erros); }
      if (erros.length) {
        throw new ErroDominio('validacao', 'dados-invalidos', 'Dados inválidos', 'Um ou mais campos são inválidos.', { erros });
      }
      const dono = referencia(acharUsuario, 'proprietarioId', dados.proprietarioId);
      const novo = objetos.inserir({
        proprietarioId: dono.id,
        descricao: '',
        disponivel: true,
        ...somenteCampos(dados, CAMPOS_OBJETO),
        criadoEm: relogio().toISOString(),
      });
      publicador.registrar('objeto.anunciado', { ...novo, proprietario: contato(dono) }, requestId);
      return novo;
    },

    substituirObjeto(id, dados, { requestId } = {}) {
      const objeto = acharObjeto(exigirId(id));
      dados = corpo(dados);
      regras.validarObjeto(dados);
      if (dados.disponivel === false && objeto.disponivel) {
        regras.exigirSemAluguelAtivo(objeto, alugueisDoObjeto(objeto.id), 'pausar o anúncio');
      }
      const atualizado = objetos.substituir(objeto.id, {
        proprietarioId: objeto.proprietarioId,
        criadoEm: objeto.criadoEm,
        descricao: '',
        disponivel: true,
        ...somenteCampos(dados, CAMPOS_OBJETO),
      });
      publicador.registrar('objeto.atualizado', atualizado, requestId);
      return atualizado;
    },

    alterarObjeto(id, dados, { requestId } = {}) {
      const objeto = acharObjeto(exigirId(id));
      dados = corpo(dados);
      regras.validarObjeto(dados, { parcial: true });
      if (dados.disponivel === false && objeto.disponivel) {
        regras.exigirSemAluguelAtivo(objeto, alugueisDoObjeto(objeto.id), 'pausar o anúncio');
      }
      Object.assign(objeto, somenteCampos(dados, CAMPOS_OBJETO)); // seguro: só os campos listados
      publicador.registrar('objeto.atualizado', objeto, requestId);
      return objeto;
    },

    removerObjeto(id, { requestId } = {}) {
      const objeto = acharObjeto(exigirId(id));
      regras.exigirSemAluguelAtivo(objeto, alugueisDoObjeto(objeto.id), 'remover o anúncio');
      objetos.remover(objeto.id);
      publicador.registrar('objeto.removido', { id: objeto.id, titulo: objeto.titulo }, requestId);
    },

    // ---------------- Aluguéis ----------------
    listarAlugueis(query) {
      const c = lerConsulta(query, {
        filtros: {
          ids: 'ids', status: regras.STATUS_ALUGUEL, objetoId: 'inteiro', locatarioId: 'inteiro',
          proprietarioId: 'inteiro', usuarioId: 'inteiro',
        },
        ordenaveis: ['id', 'dataInicio', 'dataFim', 'valorTotal', 'criadoEm'],
      });
      const f = c.filtros;
      let lista = alugueis.listar();
      if (f.ids) lista = lista.filter((a) => f.ids.includes(a.id));
      if (f.status) lista = lista.filter((a) => a.status === f.status);
      if (f.objetoId) lista = lista.filter((a) => a.objetoId === f.objetoId);
      if (f.locatarioId) lista = lista.filter((a) => a.locatarioId === f.locatarioId);
      if (f.proprietarioId) lista = lista.filter((a) => a.proprietarioId === f.proprietarioId);
      // usuarioId: aluguéis em que a pessoa participa, de qualquer lado
      if (f.usuarioId) lista = lista.filter((a) => a.locatarioId === f.usuarioId || a.proprietarioId === f.usuarioId);
      return ordenarEPaginar(lista, c);
    },

    obterAluguel: (id) => acharAluguel(exigirId(id)),

    solicitarAluguel(dados, { requestId } = {}) {
      dados = corpo(dados);
      regras.validarSolicitacao(dados);
      const objeto = referencia(acharObjeto, 'objetoId', dados.objetoId);
      const locatario = referencia(acharUsuario, 'locatarioId', dados.locatarioId);

      regras.exigirInicioNaoPassado(dados.dataInicio, regras.hoje(relogio()));           // R1 — 422
      const { dias, valorTotal } = regras.calcularPeriodo(objeto, dados.dataInicio, dados.dataFim); // R2 — 422
      regras.exigirLocatarioDiferenteDoDono(objeto, locatario.id);                      // R3 — 422
      regras.exigirObjetoDisponivel(objeto);                                            // R4 — 422
      regras.exigirPeriodoLivre(alugueisDoObjeto(objeto.id), dados.dataInicio, dados.dataFim); // R5 — 409

      const agora = relogio().toISOString();
      const novo = alugueis.inserir({
        objetoId: objeto.id,
        proprietarioId: objeto.proprietarioId,
        locatarioId: locatario.id,
        dataInicio: dados.dataInicio,
        dataFim: dados.dataFim,
        dias,
        valorTotal,
        status: 'SOLICITADO',
        historico: [{ status: 'SOLICITADO', porUsuarioId: locatario.id, em: agora }],
        criadoEm: agora,
      });
      // Mesmo passo da gravação: o evento entra na outbox e a resposta sai sem esperar o broker
      publicador.registrar('aluguel.solicitado', retratoDoAluguel(novo), requestId);
      return novo;
    },

    mudarStatusAluguel(id, dados, { requestId } = {}) {
      const aluguel = acharAluguel(exigirId(id));
      dados = corpo(dados);
      regras.validarMudancaStatus(dados);
      referencia(acharUsuario, 'usuarioId', dados.usuarioId);
      regras.exigirTransicaoPermitida(aluguel, dados.status, dados.usuarioId); // R6 — 409, R7 — 403
      if (dados.status === 'APROVADO') {
        // ao aprovar, confere de novo se outro aluguel não ocupou o período nesse meio-tempo
        const outros = alugueisDoObjeto(aluguel.objetoId).filter((a) => a.status !== 'SOLICITADO');
        regras.exigirPeriodoLivre(outros, aluguel.dataInicio, aluguel.dataFim, aluguel.id);
      }
      aluguel.status = dados.status;
      aluguel.historico.push({ status: dados.status, porUsuarioId: dados.usuarioId, em: relogio().toISOString() });
      // chave hierárquica: aluguel.aprovado, aluguel.retirado, aluguel.devolvido...
      publicador.registrar(`aluguel.${dados.status.toLowerCase()}`, retratoDoAluguel(aluguel), requestId);
      return aluguel;
    },

    // ---------------- Avaliações ----------------
    listarAvaliacoes(query) {
      const c = lerConsulta(query, {
        filtros: { aluguelId: 'inteiro', avaliadoId: 'inteiro', avaliadorId: 'inteiro', usuarioIds: 'ids' },
        ordenaveis: ['id', 'nota', 'criadoEm'],
      });
      const f = c.filtros;
      let lista = avaliacoes.listar();
      if (f.aluguelId) lista = lista.filter((a) => a.aluguelId === f.aluguelId);
      if (f.avaliadoId) lista = lista.filter((a) => a.avaliadoId === f.avaliadoId);
      if (f.avaliadorId) lista = lista.filter((a) => a.avaliadorId === f.avaliadorId);
      if (f.usuarioIds) lista = lista.filter((a) => f.usuarioIds.includes(a.avaliadoId));
      return ordenarEPaginar(lista, c);
    },

    obterAvaliacao(id) {
      const n = exigirId(id);
      return avaliacoes.buscar(n) ?? (() => { throw naoEncontrado('avaliacao', n); })();
    },

    registrarAvaliacao(dados, { requestId } = {}) {
      dados = corpo(dados);
      regras.validarAvaliacao(dados);
      const aluguel = referencia(acharAluguel, 'aluguelId', dados.aluguelId);
      const avaliadoId = regras.definirAvaliado(aluguel, dados.avaliadorId, avaliacoes.listar());
      const nova = avaliacoes.inserir({
        aluguelId: aluguel.id,
        avaliadorId: dados.avaliadorId,
        avaliadoId,
        nota: dados.nota,
        comentario: dados.comentario ?? '',
        criadoEm: relogio().toISOString(),
      });
      publicador.registrar('avaliacao.registrada', nova, requestId);
      return nova;
    },
  };
}
