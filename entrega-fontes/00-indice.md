# Índice da entrega final — Emprestaí

**Disciplina:** Modelagem de Padrões de Projeto · **Projeto Fio-condutor:** Emprestaí, marketplace de empréstimo e aluguel temporário de objetos entre pessoas · **Apresentação:** 16/11/2026

**Integrantes:** Isabella Mozzer · João Gabriel · Livia Ayumi · Luis Felipe · Mariana Melendez

## Documentação do semestre (`documentacao/`)

| # | Documento | Arquivo | Oficina / checkpoint | Entregue em | Produzido por |
|---|---|---|---|---|---|
| 1 | Descrição do Emprestaí; C4 Nível 1 (Contexto); C4 Nível 2 (Contêiner); ADR-001: PostgreSQL como banco principal | `oficina-01-c4-e-adr-001/emprestai-oficina-c4-adr001.pdf` | Oficina do projeto: C4 e primeiro ADR | ___/___/2026 | Todos os integrantes |
| 2 | Três pontos de maior acoplamento; proposta de camadas; ADR-002: camadas fechadas; regra arquitetural verificável | `oficina-02-camadas-e-adr-002/emprestai-trilha-camadas-adr002.pdf` | Oficina do projeto: camadas e ADR-002 | ___/___/2026 | Todos os integrantes |

Versões: as duas são as versões entregues nas oficinas, sem alteração depois da devolutiva. As diferenças entre o que foi projetado e o que foi construído estão no relatório (seção 3): ADR-001 ficou com implementação adiada (dados em memória), e o C4 Nível 2 ganhou API Gateway, servidor GraphQL, RabbitMQ e consumidores.

## Tutoriais aplicados ao tema (`tutoriais/`)

| # | Item | Caminho | Responsável principal |
|---|---|---|---|
| 3 | README: execução, chaves de teste e roteiro das 8 cenas | `tutoriais/README.md` | Todos |
| 4 | Parte 1: API REST em camadas + OpenAPI + testes | `tutoriais/rest/`, `tutoriais/openapi.yaml` | Luis Felipe |
| 5 | Parte 2: mensageria (RabbitMQ, consumidores, DLQ) | `tutoriais/mensageria/`, `tutoriais/compose.yaml` | Isabella Mozzer |
| 6 | Parte 3: GraphQL sobre a API REST | `tutoriais/graphql/` | Luis Felipe |
| 7 | Parte 4: API Gateway | `tutoriais/gateway/` | Isabella Mozzer |
| 8 | Scripts de demonstração e testes automatizados | `tutoriais/testes/` | Todos |

## Relatório e apresentação

| # | Documento | Arquivo | Responsável principal |
|---|---|---|---|
| 9 | Relatório técnico dos tutoriais (Parte 5) | `relatorio-tutoriais.pdf` | João Gabriel |
| 10 | Slides da apresentação oral | `apresentacao.pdf` | Mariana Melendez |
| 11 | Este índice | `00-indice.pdf` | Livia Ayumi |

**Repositório Git:** https://github.com/luisplacco0507-dotcom/emprestai (tags `etapa-1-rest`, `etapa-2-mensageria`, `etapa-3-graphql`, `etapa-4-gateway`, `entrega-final`).
