export const BRIEFING_PROMPT = `Objetivo:
Com base no documento de copy do último lançamento (incluindo TODAS as abas do Google Docs), extrair um resumo comercial objetivo.

Campos obrigatórios (Markdown):
- Nome do evento
- Promessa
- Oferta principal
- Preço (à vista e parcelado, se houver)
- Upsell
- Downsell
- Principiais bônus / bônus de urgência
- Headline principal
- CTA principal

Onde procurar (prioridade):
1. Aba PÁGINAS — valor da oferta principal (ex.: "1.997" / "12x ...")
2. Aba DOWNSELL — oferta de downsell (ex.: de R$797 por 12x de R$51,41 ou R$497 à vista)
3. Abas GRUPOS NORMAIS / SUPER INTERESSADOS / REABERTURA / EMAIL — preço, bônus e CTAs repetidos nas mensagens
4. LEGENDA DOS CRIATIVOS — promessa, headline e CTA de captação

Regras:
- Não invente. Se não achar um campo, escreva "Não informado".
- Diferencie claramente Oferta principal vs Downsell vs Upsell.
- Quando houver risco de confusão (vários preços), cite o valor e o contexto (ex.: "oferta principal na página de vendas" vs "downsell Especialista MCMV").
- Prefira valores explícitos com R$ / 12x / à vista.
- Responda só o resumo em Markdown, sem preâmbulo.

Conteúdo do documento de copy do último lançamento:

`;
