# Relatório técnico dos tutoriais — Emprestaí

**Disciplina:** Modelagem de Padrões de Projeto · **Grupo:** Isabella Mozzer, João Gabriel, Livia Ayumi, Luis Felipe e Mariana Melendez · **Data:** 16/11/2026

> Versão em Markdown. Para a entrega, exportar como `relatorio-tutoriais.pdf` (4 a 6 páginas) e colar as capturas de tela indicadas em **[Evidência]**.

## 1. Tema e núcleo implementado

O Emprestaí é um marketplace de economia compartilhada para empréstimo e aluguel temporário de objetos entre pessoas. O usuário anuncia objetos, procura itens, solicita um aluguel, combina retirada e devolução e, no fim, avalia a outra parte. A diferença em relação a um marketplace de venda é o **tempo**: o mesmo objeto é emprestado várias vezes, e o sistema precisa garantir que dois aluguéis não ocupem o mesmo período e que cada etapa (aprovação, retirada, devolução) seja feita por quem tem o direito de fazê-la.

O núcleo implementado é o **ciclo de vida do aluguel**, com quatro recursos: usuários, objetos (anúncios), aluguéis e avaliações. Ficaram fora do protótipo o chat, o pagamento e a localização. O serviço externo de notificações do C4 é simulado pelo consumidor de notificações.

**Regras de negócio próprias do tema** (todas na Camada de Domínio, `rest/dominio/regras.js`):

| # | Regra | Código |
|---|---|---|
| R1 | A retirada não pode ser em data passada | 422 `data-no-passado` |
| R2 | O período não pode passar do máximo de dias definido pelo dono (`maxDias`) | 422 `periodo-acima-do-limite` |
| R3 | Ninguém aluga o próprio objeto | 422 `aluguel-do-proprio-objeto` |
| R4 | Anúncio pausado não recebe solicitações | 422 `objeto-indisponivel` |
| R5 | O objeto não pode ter dois aluguéis ativos no mesmo período | 409 `periodo-ocupado` |
| R6 | O status só segue a máquina de estados (ex.: não se devolve o que não foi retirado) | 409 `transicao-invalida` |
| R7 | Só o dono aprova, recusa e registra retirada e devolução; só o locatário cancela uma solicitação | 403 `acao-nao-permitida` |
| R8 | Anúncio com aluguel em andamento não pode ser removido nem pausado | 409 `objeto-com-aluguel-ativo` |
| R9 | Avaliação só depois da devolução, só pelas partes e uma vez por pessoa | 422 / 403 / 409 |

## 2. Diagrama da arquitetura

```mermaid
flowchart TB
    subgraph Atores
      APP["Aplicativo móvel<br/>app-emprestai · 20/min"]
      PAINEL["Painel de moderação<br/>painel-moderacao · 120/min"]
      PARC["Seguradora parceira<br/>parceiro-seguros · 5/min, só GET /api/objetos"]
    end
    APP & PAINEL & PARC -- "HTTPS + X-API-Key" --> GW

    GW["API Gateway :3000 (única porta pública)<br/>X-Request-Id · autenticação · autorização 403 · limite 429<br/>timeout 504 · falha 502 · disjuntor 503<br/>rota agregada /api/painel/alugueis/:id"]

    subgraph Rede interna - 127.0.0.1
      REST["API REST :3001<br/>Apresentação → Aplicação → Domínio<br/>Infraestrutura: repositório em memória + outbox"]
      GQL["Servidor GraphQL :4000<br/>Apollo Server 5 + DataLoader"]
      MQ[("RabbitMQ<br/>exchange topic emprestai.eventos")]
      N["Consumidor notificações<br/>aluguel.*"]
      A["Consumidor auditoria<br/>#"]
      AV["Consumidor convites de avaliação<br/>aluguel.devolvido"]
      DLQ[("DLQs<br/>emprestai.*.dlq")]
    end

    GW -- "/api/objetos, /api/alugueis,<br/>/api/usuarios, /api/avaliacoes" --> REST
    GW -- "/api/graphql → /" --> GQL
    GQL -- "HTTP (busca os dados)" --> REST
    REST -. "publica evento (assíncrono,<br/>outbox + publisher confirms)" .-> MQ
    MQ -. "fila emprestai.notificacoes" .-> N
    MQ -. "fila emprestai.auditoria" .-> A
    MQ -. "fila emprestai.avaliacoes" .-> AV
    N & A & AV -. "3 tentativas, depois nack" .-> DLQ
```

Linhas cheias são chamadas síncronas (HTTP, o cliente espera). Linhas tracejadas são assíncronas: a API responde 201 antes de os consumidores agirem. **[Evidência]** captura dos terminais com os 6 processos e da aba *Queues* do painel do RabbitMQ.

## 3. Relação com a documentação do semestre

| Documento da oficina | O que foi projetado | Onde aparece no código | O que mudou e por quê |
|---|---|---|---|
| **C4 Nível 1** (Oficina 1) | Usuário; Emprestaí; sistemas externos de Pagamento, Localização e Notificações | Atores viraram **clientes do gateway**. As notificações viraram o **consumidor de notificações** com um serviço externo simulado (`mensageria/servico-notificacoes.js`) | Pagamento e Localização ficaram fora do núcleo. A notificação, que no C4 era uma chamada síncrona do backend, passou a ser **reação a um evento**: se o serviço de avisos cair, o aluguel não deixa de ser criado |
| **C4 Nível 2** (Oficina 1) | App React Native → API Node.js/Express (HTTPS/REST) → PostgreSQL; API → serviços externos | A API Node.js/Express é a `rest/` | Apareceram quatro contêineres que o C4 não tinha: **API Gateway**, **servidor GraphQL**, **RabbitMQ** e **consumidores**. O app não fala mais direto com a API: passa pelo gateway. O C4 Nível 2 deve ser atualizado com eles |
| **ADR-001: PostgreSQL** (Oficina 1) | Banco relacional pelas relações usuário–objeto–aluguel–avaliação | `rest/infraestrutura/repositorio-memoria.js` | No protótipo os dados ficam **em memória**, atrás da mesma interface de repositório. A decisão continua válida para produção: a regra de período ocupado (R5) e a outbox dependem de transação, que o PostgreSQL oferece. Status sugerido: *Aceito, implementação adiada* |
| **Pontos de acoplamento** (Oficina 2) | App ↔ API, API ↔ banco, API ↔ serviços externos | Gateway, repositório injetado e eventos | Os três acoplamentos foram reduzidos: o **gateway** isola o app das mudanças internas (reescrita de caminho e `Location`); o **repositório injetado** isola o banco; os **eventos** tiram os serviços externos do caminho síncrono |
| **Camadas** (Oficina 2) | Apresentação → Aplicação → Domínio → Infraestrutura | `rest/apresentacao`, `rest/aplicacao`, `rest/dominio`, `rest/infraestrutura` | A Camada de Apresentação do documento era o app React Native; no backend, ela virou as **rotas HTTP** (o app é um cliente externo) |
| **ADR-002: camadas fechadas** e **regra verificável** (Oficina 2) | "Apresentação não acessa o banco"; "Domínio não depende do PostgreSQL" | `testes/unitarios/arquitetura.test.js` | A regra virou **teste automatizado**: o `npm test` lê os `import` e falha se a Apresentação importar Domínio ou Infraestrutura, ou se o Domínio importar algum driver. Para o Domínio não depender da Infraestrutura, a Aplicação recebe o repositório e o publicador **por injeção** (montados em `rest/app.js`) |

## 4. Tabela de decisões

| Tecnologia | Por que está no Emprestaí | O que aconteceria sem ela | Alternativa considerada | O que se perde com a escolha |
|---|---|---|---|---|
| **API REST** | Recursos naturais do domínio (objetos, aluguéis) com operações CRUD, cache HTTP e contrato simples para o app e parceiros; dona única das regras R1–R9 | Cada cliente precisaria de um protocolo próprio e as regras ficariam espalhadas | RPC/gRPC (mais eficiente, porém pior no navegador e para parceiros) | Telas que juntam muitos recursos precisam de várias chamadas (resolvido pelo GraphQL e pela rota agregada); versionamento manual |
| **Mensageria (RabbitMQ)** | Um aluguel muda de status e várias partes precisam reagir (avisar a outra pessoa, auditar, abrir avaliações) sem atrasar a resposta | A API chamaria cada serviço de forma síncrona: se o serviço de notificações caísse, ninguém conseguiria solicitar aluguel; cada reação nova exigiria mudar a API | Chamadas HTTP diretas; Kafka (melhor para reprocessar histórico, mais pesado de operar) | **Consistência eventual** (o aviso chega segundos depois); complexidade operacional (broker, DLQ, idempotência); depuração mais difícil, o que exigiu o `X-Request-Id` no evento |
| **GraphQL** | A tela "Minha área" do app junta usuário, reputação, aluguéis, objetos e donos: com REST seriam 11 chamadas pela rede móvel | O app faria várias idas e voltas (lento em 4G) ou a API ganharia endpoints sob medida para cada tela | Endpoints BFF por tela; mais rotas agregadas no gateway | Cache HTTP por URL não funciona (tudo é POST); risco de consultas abusivas (sem limite de profundidade no protótipo); mais um serviço para operar |
| **API Gateway** | Três atores com planos diferentes (app, painel, parceiro) e serviços internos que não devem ser expostos | Cada serviço repetiria autenticação, limite e logs; o parceiro teria acesso a tudo; o app conheceria endereços internos | Autenticação em cada serviço; produto pronto (Kong, NGINX, AWS API Gateway) | **Ponto único de falha** e de gargalo; latência extra; risco de virar "lógica de negócio no gateway" (a rota agregada é o limite) |

## 5. Cenário ponta a ponta: "solicitar o aluguel da furadeira"

1. O app de Bruno envia `POST /api/alugueis` com `X-API-Key: chave-app-emprestai-123`. O **gateway** gera o `X-Request-Id` (ex.: `f3f7ec57-…`), autentica (`app-emprestai`), confere o limite (20/min) e encaminha para `http://127.0.0.1:3001/alugueis` com `x-request-id` e `x-cliente-id`. A chave do cliente não segue adiante.
   `[gateway] f3f7ec57-… POST /api/alugueis -> 201 (7 ms) cliente=app-emprestai`
2. A **API REST** valida o corpo, aplica R1 a R5, grava o aluguel e, no mesmo passo, registra `aluguel.solicitado` na outbox. Responde **201** com `Location: /alugueis/6`, que o gateway reescreve para `/api/alugueis/6`.
   `[rest] f3f7ec57-… evento aluguel.solicitado registrado na outbox` · `[rest] f3f7ec57-… POST /alugueis -> 201`
3. O laço da **outbox** publica na exchange `emprestai.eventos` com chave `aluguel.solicitado`, `messageId` igual ao id do evento e o cabeçalho `x-request-id`.
   `[outbox] f3f7ec57-… publicado aluguel.solicitado (evento 9c1e…)`
4. A exchange `topic` entrega uma cópia para `emprestai.notificacoes` (`aluguel.*`) e outra para `emprestai.auditoria` (`#`). `emprestai.avaliacoes` (`aluguel.devolvido`) não recebe.
   `[notificacoes] f3f7ec57-… aluguel.solicitado notificação enviada a Ana Souza …` · `[auditoria] f3f7ec57-… aluguel.solicitado registrado na trilha de auditoria`
5. Ana aprova (`PATCH /api/alugueis/6` com `{"status":"APROVADO","usuarioId":1}`), e o fluxo se repete com `aluguel.aprovado`. Se o locatário fosse o Diego (DDD 00), a notificação falharia 3 vezes e iria para `emprestai.notificacoes.dlq`, sem afetar a auditoria, que tem a própria fila.

**[Evidência]** respostas 201 e 422 (`npm run cliente`); painel do RabbitMQ com a DLQ (`npm run teste-falha` e `npm run dlq`); consulta GraphQL (`npm run teste-graphql`); 401, 429 e 503 do gateway (`npm run teste-gateway`, `-- falha`); o mesmo `X-Request-Id` nos terminais do gateway, da API e de um consumidor.

## 6. Riscos e limitações do protótipo

| # | Risco ou limitação | Efeito | O que seria feito em produção |
|---|---|---|---|
| 1 | **Dados em memória** (API, outbox, limite de uso, disjuntor) | Reiniciar perde tudo; não dá para ter duas cópias de nenhum serviço | PostgreSQL (ADR-001) com a outbox numa tabela da mesma transação; Redis para os contadores de limite compartilhados entre cópias do gateway |
| 2 | **Gateway como ponto único de falha** | Se o processo cair, nada funciona | Várias cópias atrás de um balanceador, com verificação de saúde (`/saude`) e um produto pronto (Kong, NGINX) |
| 3 | **Identidade sem verificação**: o serviço confia no `X-Cliente-Id`, e o `usuarioId` vai no corpo | Quem alcançar a rede interna pode se passar por outro cliente ou usuário | Login com JWT/OpenID Connect validado no gateway; o usuário vem do token, nunca do corpo; mTLS entre gateway e serviços |
| 4 | **Consistência eventual** | O aviso chega depois do 201; o app pode mostrar um status desatualizado por alguns segundos | Assumido pelo negócio; o app consulta o status pela API, que é a fonte da verdade |
| 5 | **Idempotência em arquivo local** e outbox em memória | Duas réplicas de um consumidor não compartilham o registro de processadas | Tabela `mensagens_processadas` com chave única no `messageId` |
| 6 | **Corrida na regra R5** | Com várias cópias da API, dois pedidos simultâneos poderiam reservar o mesmo período | Restrição de exclusão no PostgreSQL (`EXCLUDE USING gist` sobre o intervalo de datas) ou bloqueio pessimista |
| 7 | **Dados pessoais no evento** (telefone e e-mail viajam para os consumidores) | Exposição desnecessária (LGPD) | Evento só com ids; o consumidor de notificações busca o contato num serviço próprio |
| 8 | **GraphQL sem limite de profundidade/custo** | Consultas aninhadas podem sobrecarregar a API REST | `graphql-depth-limit`, análise de custo e *persisted queries* |

## 7. Divisão do trabalho

_(Preencher com a mesma tabela do README: responsável principal e apoio de cada parte.)_

## 8. Uso de IA

Ferramenta: Claude (Anthropic), usado como assistente de programação para gerar o rascunho do código das quatro partes a partir dos tutoriais da disciplina e dos documentos das oficinas, os scripts de demonstração e o primeiro rascunho deste relatório e do README. O grupo revisou, executou e testou o código, e responde por ele na arguição. _(Ajustar para refletir o uso real.)_

## 9. Referências

FIELDING, R. T. **Architectural Styles and the Design of Network-based Software Architectures**. 2000. Tese (Doutorado em Ciência da Informação e Computação) – University of California, Irvine, 2000.

HOHPE, G.; WOOLF, B. **Enterprise Integration Patterns**: designing, building, and deploying messaging solutions. Boston: Addison-Wesley, 2003.

NOTTINGHAM, M.; WILDE, E.; DALAL, S. **RFC 9457**: Problem Details for HTTP APIs. [S. l.]: IETF, 2023. Disponível em: https://www.rfc-editor.org/rfc/rfc9457. Acesso em: 15 nov. 2026.

NYGARD, M. T. **Release It!**: design and deploy production-ready software. 2. ed. Raleigh: Pragmatic Bookshelf, 2018.

RICHARDSON, C. **Microservices Patterns**: with examples in Java. Shelter Island: Manning, 2018.

BROWN, S. **The C4 model for visualising software architecture**. [S. l.], 2024. Disponível em: https://c4model.com. Acesso em: 15 nov. 2026.

RABBITMQ. **RabbitMQ Documentation**. [S. l.], 2026. Disponível em: https://www.rabbitmq.com/docs. Acesso em: 15 nov. 2026.

APOLLO GRAPHQL. **Apollo Server Documentation**. [S. l.], 2026. Disponível em: https://www.apollographql.com/docs/apollo-server. Acesso em: 15 nov. 2026.

OWASP FOUNDATION. **OWASP API Security Top 10**. [S. l.], 2023. Disponível em: https://owasp.org/API-Security/. Acesso em: 15 nov. 2026.
