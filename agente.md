# agente.md

# Agente de Pré-Lançamento

## Objetivo

Criar um serviço executado na VPS que monitora o Google Agenda diariamente e, quando identificar uma captação entrando na janela de preparação (15 dias antes), prepare automaticamente toda a estrutura operacional do lançamento.

## Stack sugerida

- Node.js + TypeScript
- Google Calendar API
- Google Drive API
- Google Docs API
- OpenAI API (ou compatível)
- WhatsApp (Evolution API)
- Docker
- Banco SQLite (ou Postgres) para evitar execuções duplicadas

---

# Fluxo

Executar todos os dias às 08:00.

Consultar o Google Agenda.

Localizar eventos contendo:

- CAPTAÇÃO
- [CAPTACAO]

Exemplos:

CAPTAÇÃO - Murilo

CAPTAÇÃO - Eric

CAPTAÇÃO - Grazi

Calcular diferença entre a data atual e a data da captação.

Se faltar exatamente 15 dias:

- verificar no banco se o lançamento já foi preparado;
- caso não tenha sido, executar todas as etapas abaixo.

---

# ETAPA 1 — Criar estrutura no Google Drive

Criar automaticamente a pasta do lançamento.

Estrutura:

```
Especialista/
    Lançamento AAAA-MM/
        01 - Briefing
        02 - Copy
        03 - Criativos
        04 - Página
        05 - API
        06 - Emails
        07 - Videos
        08 - Grupo
        09 - Checkout
        10 - Relatórios
```

Caso exista, não duplicar.

---

# ETAPA 2 — Duplicar modelos

Copiar automaticamente para a nova pasta:

- Modelo Copy
- Modelo API
- Modelo Página
- Modelo Emails
- Modelo Criativos

Os IDs dos documentos modelo devem ficar em um arquivo de configuração (.env ou config.json).

---

# ETAPA 3 — Resumo do último lançamento

Localizar o lançamento anterior do mesmo especialista.

Abrir o documento principal de copy.

Enviar o conteúdo para a IA com o prompt:

Objetivo:
Extrair somente:

- Nome do evento
- Promessa
- Oferta principal
- Preço
- Upsell
- Downsell
- Principais bônus
- Headline principal
- CTA principal

Responder em Markdown.

Salvar o resultado em:

```
01 - Briefing/Resumo do Último Lançamento.md
```

Caso não exista lançamento anterior:

Registrar essa informação e seguir normalmente.

---

# ETAPA 7 — Aviso no WhatsApp

Enviar mensagem automaticamente no grupo do especialista.

Modelo:

```
🚀 Pré-lançamento iniciado automaticamente.

Captação prevista:
{{DATA}}

Já foram preparados:

✅ Estrutura do Drive
✅ Modelos de documentos
✅ Resumo do último lançamento

Agora falta apenas a reunião de definição da oferta.
```

Configurar integração usando Evolution API.

---

# Requisitos

- Idempotência (não executar duas vezes o mesmo lançamento)
- Logs completos
- Tratamento de erro
- Configuração via .env
- Dockerfile
- docker-compose.yml

---

# Estrutura sugerida

```
src/
    scheduler/
    calendar/
    drive/
    docs/
    ai/
    whatsapp/
    database/
    services/
```

Cada integração deve ser desacoplada.

---

# Critérios de sucesso

Ao cadastrar um evento "CAPTAÇÃO - Murilo" para daqui a 15 dias, o sistema deve:

1. Detectar automaticamente.
2. Criar a estrutura de pastas.
3. Duplicar os documentos modelo.
4. Gerar o resumo do último lançamento.
5. Enviar a mensagem no grupo do WhatsApp.
6. Registrar no banco que o lançamento já foi preparado.
