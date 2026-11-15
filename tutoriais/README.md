# Emprestaí — tutoriais aplicados ao projeto Fio-condutor

**Disciplina:** Modelagem de Padrões de Projeto · **Grupo:** Isabella Mozzer, João Gabriel, Livia Ayumi, Luis Felipe e Mariana Melendez

API REST, mensageria com RabbitMQ, GraphQL e API Gateway aplicados ao Emprestaí.

## 1. Tema e núcleo implementado

O **Emprestaí** é um marketplace de economia compartilhada para empréstimo e aluguel temporário de objetos entre pessoas: quem tem uma furadeira, uma barraca ou um projetor parado anuncia o objeto, e quem precisa solicita o aluguel por um período, combina a retirada e a devolução e, no fim, as duas partes se avaliam. Diferente de um marketplace de venda (a OLX é a referência da oficina), o Emprestaí precisa controlar a **disponibilidade do objeto no tempo**, o **período do aluguel** e as **etapas de retirada e devolução**.

O tema é amplo (chat, pagamento, localização, notificações), então o núcleo escolhido é o **ciclo de vida do aluguel**: **usuários**, **objetos anunciados**, **aluguéis** (solicitado → aprovado → retirado → devolvido, ou recusado/cancelado) e **avaliações** depois da devolução. É nesse ciclo que estão as regras de negócio que diferenciam o Emprestaí (período ocupado, prazo máximo definido pelo dono, quem pode aprovar ou cancelar) e os eventos que interessam a outros serviços (notificar a outra parte, registrar a trilha de auditoria, abrir os convites de avaliação). Chat, pagamento e localização ficaram de fora; o serviço de notificações do C4 é **simulado** pelo consumidor de notificações.

## 2. Pré-requisitos

- **Node.js 22 ou superior** (`node --version`)
- **Docker Desktop em execução** (para o RabbitMQ). Confira com `docker info`: deve aparecer a seção *Server*.
- Portas livres: 3000, 3001, 4000, 5672 e 15672.

## 3. Como executar

Todos os comandos rodam **dentro da pasta `tutoriais/`**. No PowerShell, use `curl.exe` em vez de `curl`.

**Passo 1. Instalar as dependências (uma vez só)**

```bash
npm install
```

**Passo 2. Subir o RabbitMQ**

```bash
docker compose up -d
```

Painel: <http://localhost:15672> (usuário `guest`, senha `guest`).

**Passo 3. Abrir um terminal para cada processo, nesta ordem**

| # | Processo | Comando | Porta | Quem acessa |
|---|---|---|---|---|
| 1 | RabbitMQ (Docker) | `docker compose up -d` | 5672 (AMQP), 15672 (painel) | esta máquina |
| 2 | API REST | `npm run rest` | 3001 | **só 127.0.0.1** |
| 3 | Servidor GraphQL | `npm run graphql` | 4000 | **só 127.0.0.1** |
| 4 | Consumidores (3 processos) | `npm run consumidores` | — | — |
| 5 | API Gateway | `npm run gateway` | 3000 | **única porta pública** |
| 6 | Scripts de demonstração | `npm run cliente`, `npm run teste-gateway`… | — | — |

Os consumidores também podem subir um por terminal: `npm run notificacoes`, `npm run auditoria`, `npm run avaliacoes`.

**Passo 4. Conferir**

```bash
curl -i http://localhost:3000/saude
```

```bash
npm test
```

O `npm test` roda os testes automatizados (`node --test`): rotas da API REST, regra arquitetural do ADR-002 e lógica dos consumidores (ack, nova tentativa, DLQ e idempotência). Não precisa de nenhum serviço no ar.

**Variáveis de ambiente (opcionais).** Todas têm valor padrão; veja `.env.example`. Exemplo: `RABBITMQ_URL` se o broker estiver em outro endereço.

## 4. Chaves e usuários de teste (todos fictícios)

**Clientes do gateway (cabeçalho `X-API-Key`)**

| Cliente | Chave | Plano | Pode acessar |
|---|---|---|---|
| `app-emprestai`: aplicativo móvel | `chave-app-emprestai-123` | 20 req/min | tudo em `/api` |
| `painel-moderacao`: painel interno | `chave-painel-moderacao-456` | 120 req/min | tudo em `/api` |
| `parceiro-seguros`: seguradora parceira | `chave-parceiro-seguros-789` | 5 req/min | só `GET /api/objetos` (o resto é 403) |

**Usuários (dados em memória, recriados a cada `npm run rest`)**

| id | Nome | Observação |
|---|---|---|
| 1 | Ana Souza | dona da furadeira (1) e da bicicleta (4) |
| 2 | Bruno Lima | dono da barraca (2) e da escada (6, anúncio pausado) |
| 3 | Carla Dias | dona do projetor (3) e do kit de festa (5) |
| 4 | Diego Rocha | telefone com DDD 00: as notificações para ele falham e vão para a DLQ |

Aluguéis iniciais: 1 DEVOLVIDO (com avaliações), 2 APROVADO, 3 SOLICITADO, 4 RETIRADO, 5 SOLICITADO. As datas são calculadas a partir do dia em que a API sobe.

## 5. Roteiro da demonstração (8 cenas)

Antes de começar: Docker Desktop aberto, `docker compose up -d`, `npm install` feito e os processos 2 a 5 já rodando, um por terminal.

**Cena 1. Ambiente no ar.** Mostre a tabela de portas acima e os terminais. Só o gateway responde de fora:

```bash
netstat -ano | findstr LISTENING | findstr ":3000 :3001 :4000"
```

A 3000 aparece em `0.0.0.0` (ou `[::]`); a 3001 e a 4000, só em `127.0.0.1`.

**Cena 2. API REST pelo gateway.** Cria um anúncio (201 + `Location: /api/objetos/7`), lê, altera, solicita aluguel e provoca de propósito as regras de negócio: 409 período ocupado, 422 data no passado, 422 acima do limite, 422 próprio objeto, 403 papel errado, 409 transição inválida e 404 no fim.

```bash
npm run cliente
```

Ou passo a passo com curl:

```bash
curl.exe -i -X POST http://localhost:3000/api/alugueis -H "X-API-Key: chave-app-emprestai-123" -H "Content-Type: application/json" -d @testes/corpos/novo-aluguel.json
```

```bash
curl.exe -i -X POST http://localhost:3000/api/alugueis -H "X-API-Key: chave-app-emprestai-123" -H "Content-Type: application/json" -d @testes/corpos/aluguel-no-passado.json
```

Rodando o primeiro comando duas vezes, a segunda resposta é **409 `periodo-ocupado`**.

**Cena 3. Evento.** Com os consumidores rodando:

```bash
npm run teste-evento
```

A API responde 201 na hora; o terminal dos consumidores mostra `[notificacoes]` avisando a Ana e `[auditoria]` registrando `aluguel.solicitado`. Depois o script aprova, registra a retirada e a devolução, e só na devolução o `[avaliacoes]` reage, porque ele só recebe `aluguel.devolvido`. No painel do RabbitMQ (aba *Exchanges* → `emprestai.eventos` → *Bindings*) aparecem as ligações de cada fila.

**Cena 4. Falha e duplicidade.**

```bash
npm run teste-falha
```

O aviso de aprovação para o Diego (DDD 00) falha nas tentativas 1, 2 e 3, com espera crescente, e vai para a DLQ. Para ver o que está na DLQ (ou use a aba *Queues*, `emprestai.notificacoes.dlq`):

```bash
npm run dlq
```

Agora a mesma mensagem enviada duas vezes:

```bash
npm run teste-duplicado
```

A primeira cópia notifica a Carla e é auditada; a segunda aparece como `já processado, ignorando`.

**Cena 5. GraphQL.** A tela "Minha área" do aplicativo (dados da Ana, aluguéis dela com objeto e dono, e os pedidos recebidos com a reputação de quem pediu) em **uma** chamada:

```bash
npm run teste-graphql
```

O script mostra quantas chamadas REST o app faria sem GraphQL (11 com os dados iniciais) e quantas o servidor fez por dentro (9, graças ao DataLoader). Também roda a busca com filtro e uma mutation que devolve `CONFLICT`. Para explorar no Apollo Sandbox, abra <http://127.0.0.1:4000> (só na própria máquina).

**Cena 6. Proteções do gateway.**

```bash
npm run teste-gateway
```

Mostra 200, 401 (sem chave e chave errada), 403 (parceiro fora da rota permitida), 404, **504** (`?atraso=5000` com timeout de 2 s) e **429** com `Retry-After` (parceiro passando de 5/min). Depois **desligue a API REST** (Ctrl+C no terminal dela):

```bash
npm run teste-gateway -- falha
```

Saem três 502 e, em seguida, 503 imediato, porque o disjuntor abriu. Religue com `npm run rest` e rode:

```bash
npm run teste-gateway -- recuperacao
```

O 200 volta quando o disjuntor fecha.

**Cena 7. Rota agregada.** `GET /api/painel/alugueis/:id` (tela "Detalhe do aluguel") junta o aluguel e o objeto, que vêm da API REST, com a reputação das duas partes, que vem do GraphQL. A resposta completa já aparece na cena 6. **Desligue o servidor GraphQL** e rode:

```bash
npm run teste-gateway -- parcial
```

A resposta continua 200, com `"parcial": true` e `"indisponivel": ["reputação das partes (GraphQL)"]`. Com a API REST desligada a resposta é 502/503, porque o aluguel é indispensável.

**Cena 8. Fechamento.** Diagrama em `../relatorio-tutoriais.md`. Pegue o `X-Request-Id` de qualquer resposta da cena 3 e procure-o nos terminais: ele aparece no `[gateway]`, no `[rest]`, no `[outbox]` e em cada consumidor (`[notificacoes] <id> aluguel.solicitado ...`). Também fica gravado em `mensageria/dados/auditoria.jsonl`.

## 6. Decisões e limitações (resumo)

- **REST** é o contrato principal e o dono das regras de negócio. Ela segue as **camadas fechadas do ADR-002** (`apresentacao → aplicacao → dominio`, com a infraestrutura injetada), e um teste automatizado verifica as dependências.
- **Mensageria**: a API registra o evento numa **outbox** no mesmo passo da gravação e responde sem esperar; um laço publica no RabbitMQ com *publisher confirms*. Exchange `topic` `emprestai.eventos` com chaves `aluguel.solicitado|aprovado|recusado|cancelado|retirado|devolvido`, `objeto.anunciado|atualizado|removido` e `avaliacao.registrada`.
- **GraphQL** fica sobre a API REST: não guarda dados e não repete regras. Usa DataLoader por requisição contra o N+1.
- **Gateway**: entrada única, chave de API por ator, autorização por rota, limite por plano, timeout, nova tentativa com espera crescente em leituras, disjuntor por serviço e rota agregada com degradação graciosa.
- **Limitações**: dados em memória (o ADR-001 prevê PostgreSQL); outbox em memória; chaves de API no código; limite de uso e disjuntor em memória de um só processo; `X-Cliente-Id` e `usuarioId` confiados sem verificação criptográfica; idempotência em arquivo local. O detalhe está no relatório.

## 7. Divisão de responsabilidades

Todos participaram de todas as partes e sabem explicar o conjunto; a tabela indica o responsável principal.

| Parte | Responsável principal | Apoio |
|---|---|---|
| 1. API REST (`rest/`, `openapi.yaml`, `testes/cliente.js`, testes automatizados) | Luis Felipe | Isabella Mozzer |
| 2. Mensageria (`mensageria/`, `compose.yaml`, `testes/teste-mensageria.js`) | Isabella Mozzer | Luis Felipe |
| 3. GraphQL (`graphql/`, `testes/teste-graphql.js`) | Luis Felipe | João Gabriel |
| 4. API Gateway (`gateway/`, `testes/teste-gateway.js`) | Isabella Mozzer | Mariana Melendez |
| 5. Integração e decisões (diagrama, relatório, tabela de decisões e riscos) | João Gabriel | Livia Ayumi |
| Documentação do semestre e índice (`documentacao/`, `00-indice.pdf`) | Livia Ayumi | Mariana Melendez |
| Slides, roteiro e vídeo de reserva (`apresentacao.pdf`) | Mariana Melendez | João Gabriel |

## 8. Uso de ferramentas de IA

Ferramenta usada: Claude (Anthropic), como assistente de programação. Finalidade: gerar um rascunho do código das quatro partes a partir dos tutoriais da disciplina e da documentação das oficinas, sugerir os scripts de demonstração e redigir o primeiro rascunho deste README, do relatório e dos slides. O grupo revisou, executou e testou o código, ajustou as regras de negócio ao tema e responde por todo o conteúdo na arguição.

## 9. Repositório e vídeo de reserva

- Repositório Git: _(link do GitHub/GitLab)_. Tags: `etapa-1-rest`, `etapa-2-mensageria`, `etapa-3-graphql`, `etapa-4-gateway`, `entrega-final`.
- Vídeo de reserva (até 9 minutos): _(link)_

## 10. Estrutura

```
tutoriais/
├── README.md, package.json, compose.yaml, openapi.yaml, .env.example
├── rest/                 Parte 1: API REST em camadas (ADR-002)
│   ├── apresentacao/     rotas HTTP e Problem Details
│   ├── aplicacao/        casos de uso, filtros e paginação
│   ├── dominio/          enums, validações e regras de negócio (puro)
│   ├── infraestrutura/   repositório em memória e outbox → RabbitMQ
│   ├── app.js            montagem das camadas
│   └── index.js          servidor (127.0.0.1:3001)
├── mensageria/           Parte 2: consumidores, DLQ, idempotência
├── graphql/              Parte 3: schema, resolvers, cliente REST com DataLoader
├── gateway/              Parte 4: gateway.js
└── testes/               scripts de demonstração, corpos JSON e testes automatizados
```

## 11. Referências

- FIELDING, R. T. *Architectural Styles and the Design of Network-based Software Architectures*. Tese (Doutorado), University of California, Irvine, 2000.
- NOTTINGHAM, M.; WILDE, E.; DALAL, S. *RFC 9457: Problem Details for HTTP APIs*. IETF, 2023.
- HOHPE, G.; WOOLF, B. *Enterprise Integration Patterns*. Boston: Addison-Wesley, 2003.
- RICHARDSON, C. *Microservices Patterns*. Shelter Island: Manning, 2018. (padrões Outbox, API Gateway e Circuit Breaker)
- NYGARD, M. T. *Release It!* 2. ed. Raleigh: Pragmatic Bookshelf, 2018.
- BROWN, S. *The C4 model for visualising software architecture*. Disponível em: <https://c4model.com>.
- RABBITMQ. *Documentation: Consumer Acknowledgements and Publisher Confirms; Dead Letter Exchanges*. Disponível em: <https://www.rabbitmq.com/docs>.
- APOLLO GRAPHQL. *Apollo Server 5 Documentation*. Disponível em: <https://www.apollographql.com/docs/apollo-server>.
- OWASP. *API Security Top 10*, 2023. Disponível em: <https://owasp.org/API-Security/>.
- Tutoriais da disciplina: API REST, Mensageria, GraphQL e API Gateway (Aula 12).
