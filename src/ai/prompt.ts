export const BRIEFING_PROMPT = `Objetivo:
Com base no documento de copy do último lançamento, extrair somente:

- Nome do evento
- Promessa
- Oferta principal
- Preço
- Upsell
- Downsell
- Principais bônus
- Headline principal
- CTA principal

Regras:
- Responder em Markdown.
- Se um campo não estiver no texto, escrever "Não informado" (não invente e não use placeholders como [Preço]).
- Priorize informações concretas (valores, nomes, ofertas) quando existirem.

Conteúdo do documento de copy do último lançamento:

`;
