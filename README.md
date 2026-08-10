# Agente de Pré-Lançamento

Automação que monitora o Google Agenda, cria pastas no Drive (padrão por especialista), copia modelo Copy, gera resumo via IA e avisa no WhatsApp (Evolution API).

## Requisitos

- Node.js 20+
- Docker (opcional)
- Google Cloud: Service Account (Calendar + Drive + Docs)
- Evolution API com instância conectada
- OpenAI API key (ou compatível)

## Setup rápido

```bash
cp .env.example .env
# Edite .env com credenciais

# Service account JSON
cp credentials.example.json credentials.json

npm install
npm run build
npm start
```

Painel admin: `http://localhost:3000/admin`

## Google (Agenda + Drive)

1. Google Cloud: ativar Calendar, Drive e Docs API
2. Criar service account → `credentials.json`
3. **Compartilhar o calendário** de captações com o email da service account
4. **Compartilhar cada raiz Drive** de especialista como **Editor**
5. Configurar `GOOGLE_CALENDAR_ID` no `.env`
6. Cadastrar especialistas em **Admin → Especialistas**

Detalhes e teste de conexão: **Admin → Google**

## Especialistas (pastas Drive)

Cada especialista tem configuração própria no painel:

| Campo | Exemplo Eric | Exemplo Murilo |
|-------|--------------|----------------|
| Raiz Drive | ID de `ENG. ERIC SOUZA...` | ID raiz Murilo |
| Caminho até COPY | `1) FÁBRICA...` → `1) COPY` | caminho Murilo |
| Template nome | `01.{{n}}) Copy - FP{{n}}` | `FPRO{{n}}` |
| Regex | `^(\d{2})\.(\d{2})\) Copy - FP(\d{2})$` | `^FPRO(\d+)$` |

O sistema lista pastas existentes, incrementa o número e cria a próxima (ex.: `01.26) Copy - FP26` → `01.27) Copy - FP27`).

**Preview** no admin valida caminho e mostra próximo nome sem criar pasta.

Dentro da pasta do lançamento:

- Copia **só o modelo Copy**
- Salva `Resumo do Último Lançamento.md` (IA, baseado na pasta anterior)

## Evolution API

```env
EVOLUTION_API_URL=https://sua-evolution.com
EVOLUTION_API_KEY=sua-api-key
EVOLUTION_INSTANCE=nome-instancia
WHATSAPP_GROUP_ID=120363419104615012@g.us
```

Teste em **Admin → Evolution API**.

## Fluxo diário

1. Cron às 08:00
2. Busca eventos `CAPTAÇÃO` na janela de 15 dias
3. Match especialista via aliases no Agenda
4. Calcula próxima pasta (auto-incremento)
5. Cria pasta no COPY parent, copia modelo Copy, briefing IA, WhatsApp
6. Idempotência por `calendar_event_id` ou `especialista + data captação`

## Painel admin

| Rota | Função |
|------|--------|
| `/admin` | Dashboard |
| `/admin/specialists` | CRUD especialistas + preview Drive |
| `/admin/google` | Teste Calendar + setup |
| `/admin/integrations` | Evolution API |
| `/admin/trigger` | Disparo manual |
| `/admin/runs` | Histórico |

## Docker

```bash
docker compose up -d --build
```

Montar `credentials.json` e `.env` conforme `docker-compose.yml`.
